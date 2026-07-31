import { readdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import type { Analyzer, AnalyzeResult, DetectResult, RouteInfo, RouteParam } from "../types.js";
import { extractFileFacts, type FileFacts, type RawRoute } from "./extract.js";

const SOURCE_EXTENSIONS = [".js", ".mjs", ".cjs", ".ts", ".mts", ".jsx", ".tsx"];
const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build", "out", "coverage", ".next", ".ahaft"]);
const MAX_FILES = 2000;

async function findSourceFiles(rootDir: string): Promise<string[]> {
  const files: string[] = [];
  const queue = [rootDir];
  while (queue.length > 0 && files.length < MAX_FILES) {
    const dir = queue.shift()!;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue; // also skips .env — never read
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) queue.push(full);
      } else if (
        SOURCE_EXTENSIONS.some((ext) => entry.name.endsWith(ext)) &&
        !entry.name.endsWith(".d.ts")
      ) {
        files.push(full);
      }
    }
  }
  files.sort();
  return files;
}

/** Join a mount prefix and a route path into a normalized URL path. */
export function joinPaths(prefix: string, routePath: string): string {
  const joined = `${prefix}/${routePath}`.replace(/\/+/g, "/");
  const trimmed = joined.length > 1 ? joined.replace(/\/$/, "") : joined;
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

/** Extract `:param` tokens (express 4/5 syntax, incl. optional `:id?`). */
export function pathParams(routePath: string): RouteParam[] {
  const params: RouteParam[] = [];
  for (const match of routePath.matchAll(/:([A-Za-z0-9_]+)(\?)?/g)) {
    params.push({ name: match[1]!, in: "path", type: "string", required: match[2] === undefined });
  }
  return params;
}

interface ResolvedTarget {
  facts: FileFacts;
  varName: string;
}

function resolveModule(fromFile: string, specifier: string, byFile: Map<string, FileFacts>): FileFacts | undefined {
  if (!specifier.startsWith(".")) return undefined; // package imports are not app code
  const base = path.resolve(path.dirname(fromFile), specifier);
  const candidates = [base, ...SOURCE_EXTENSIONS.map((e) => base + e), ...SOURCE_EXTENSIONS.map((e) => path.join(base, `index${e}`))];
  // TS ESM convention: `import x from "./mod.js"` refers to ./mod.ts on disk.
  const jsToTs: Record<string, string[]> = { ".js": [".ts", ".tsx"], ".mjs": [".mts"], ".cjs": [".cts"] };
  for (const [jsExt, tsExts] of Object.entries(jsToTs)) {
    if (base.endsWith(jsExt)) {
      candidates.push(...tsExts.map((tsExt) => base.slice(0, -jsExt.length) + tsExt));
    }
  }
  for (const candidate of candidates) {
    const facts = byFile.get(candidate);
    if (facts) return facts;
  }
  return undefined;
}

const expressAnalyzerImpl = {
  name: "express",

  async detect(rootDir: string): Promise<DetectResult> {
    if (!existsSync(rootDir)) {
      return { detected: false, reason: `path does not exist: ${rootDir}` };
    }
    const pkgPath = path.join(rootDir, "package.json");
    let inPackageJson = false;
    if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(await readFile(pkgPath, "utf8")) as {
          dependencies?: Record<string, string>;
          devDependencies?: Record<string, string>;
        };
        inPackageJson = Boolean(pkg.dependencies?.express ?? pkg.devDependencies?.express);
      } catch {
        // unreadable package.json — fall through to source scan
      }
    }
    if (inPackageJson) {
      return { detected: true, reason: "express found in package.json dependencies" };
    }
    // Fallback: any source file importing express.
    const files = await findSourceFiles(rootDir);
    for (const file of files) {
      const source = await readFile(file, "utf8").catch(() => "");
      if (!/['"]express['"]/.test(source)) continue;
      if (extractFileFacts(file, source).usesExpressImport) {
        return { detected: true, reason: `express import found in ${path.relative(rootDir, file)}` };
      }
    }
    return {
      detected: false,
      reason: existsSync(pkgPath)
        ? "no express dependency in package.json and no express imports in source files"
        : "no package.json and no express imports in source files",
    };
  },

  async analyze(rootDir: string): Promise<AnalyzeResult> {
    const warnings: string[] = [];
    const files = await findSourceFiles(rootDir);
    const byFile = new Map<string, FileFacts>();
    for (const file of files) {
      try {
        const source = await readFile(file, "utf8");
        byFile.set(file, extractFileFacts(file, source));
      } catch (err) {
        warnings.push(`skipped ${path.relative(rootDir, file)}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    const routes: RouteInfo[] = [];
    const mountedElsewhere = new Set<string>(); // "file::var" reached via a mount

    const collect = (facts: FileFacts, varName: string, prefix: string, seen: Set<string>): void => {
      const key = `${facts.file}::${varName}`;
      if (seen.has(key)) return; // cycle guard
      const nextSeen = new Set(seen).add(key);

      for (const raw of facts.routes) {
        if (raw.owner !== varName) continue;
        routes.push(finalizeRoute(raw, prefix, path.relative(rootDir, facts.file)));
      }
      for (const mount of facts.mounts) {
        if (mount.owner !== varName) continue;
        let target: ResolvedTarget | undefined;
        if (mount.targetVar !== undefined) {
          if (facts.routerVars.has(mount.targetVar) || facts.appVars.has(mount.targetVar)) {
            target = { facts, varName: mount.targetVar };
          } else {
            const specifier = facts.imports.get(mount.targetVar);
            const resolved = specifier ? resolveModule(facts.file, specifier, byFile) : undefined;
            if (resolved?.defaultExport) target = { facts: resolved, varName: resolved.defaultExport };
          }
        } else if (mount.targetSource !== undefined) {
          const resolved = resolveModule(facts.file, mount.targetSource, byFile);
          if (resolved?.defaultExport) target = { facts: resolved, varName: resolved.defaultExport };
        }
        if (target) {
          mountedElsewhere.add(`${target.facts.file}::${target.varName}`);
          collect(target.facts, target.varName, joinPaths(prefix, mount.prefix), nextSeen);
        }
      }
    };

    // First pass just to mark which routers get mounted (so we don't
    // double-report them), then collect from every entry point.
    for (const facts of byFile.values()) {
      for (const app of facts.appVars) collect(facts, app, "", new Set());
    }
    const appRouteCount = routes.length;

    // Routers never mounted under an app (e.g. exported but unused, or the
    // project is a routes-only package): report them at their own paths so
    // the developer still sees them in the manifest.
    for (const facts of byFile.values()) {
      for (const routerVar of facts.routerVars) {
        if (!mountedElsewhere.has(`${facts.file}::${routerVar}`)) {
          collect(facts, routerVar, "", new Set());
        }
      }
    }
    if (routes.length > appRouteCount) {
      warnings.push(
        `${routes.length - appRouteCount} route(s) belong to routers that are never mounted on an app; their paths may be missing a mount prefix`,
      );
    }

    return { routes, warnings };
  },
} satisfies Analyzer;

function finalizeRoute(raw: RawRoute, prefix: string, sourceFile: string): RouteInfo {
  const fullPath = joinPaths(prefix, raw.path);
  const params = [...pathParams(fullPath), ...raw.params];
  const route: RouteInfo = { method: raw.method, path: fullPath, params, sourceFile };
  if (raw.handlerName !== undefined) route.handlerName = raw.handlerName;
  if (raw.doc !== undefined) route.doc = raw.doc;
  return route;
}

export const expressAnalyzer: Analyzer = expressAnalyzerImpl;
