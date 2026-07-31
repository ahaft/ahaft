import type { RouteInfo } from "../analyzer/types.js";
import { classifyAccess, defaultEnabled, tokenize } from "./access.js";
import { MANIFEST_VERSION, type Manifest, type ManifestTool } from "./schema.js";

const METHOD_ORDER = ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"] as const;

function singularize(word: string): string {
  if (word.endsWith("ies") && word.length > 3) return `${word.slice(0, -3)}y`;
  if (word.endsWith("s") && !word.endsWith("ss") && word.length > 1) return word.slice(0, -1);
  return word;
}

/** Static (non-`:param`) path segments, snake_cased. */
function staticSegments(routePath: string): string[] {
  return routePath
    .split("/")
    .filter((seg) => seg.length > 0 && !seg.startsWith(":"))
    .map((seg) => tokenize(seg).join("_"))
    .filter(Boolean);
}

function verbFor(route: RouteInfo, resource: string): { verb: string; noun: string } {
  const targetsSingle = /:[A-Za-z0-9_]+\??$/.test(route.path);
  switch (route.method) {
    case "GET":
      return targetsSingle ? { verb: "get", noun: singularize(resource) } : { verb: "list", noun: resource };
    case "HEAD":
      return { verb: "check", noun: targetsSingle ? singularize(resource) : resource };
    case "POST":
      return { verb: "create", noun: singularize(resource) };
    case "PUT":
    case "PATCH":
      return { verb: "update", noun: singularize(resource) };
    case "DELETE":
      return { verb: "delete", noun: singularize(resource) };
  }
}

function baseName(route: RouteInfo): { primary: string; qualified: string } {
  const segments = staticSegments(route.path);
  const resource = segments[segments.length - 1] ?? "root";
  const { verb, noun } = verbFor(route, resource);
  const qualifier = segments.slice(0, -1).join("_");
  return {
    primary: `${verb}_${noun}`,
    qualified: qualifier ? `${verb}_${qualifier}_${noun}` : `${verb}_${noun}`,
  };
}

function humanize(handlerName: string): string {
  return tokenize(handlerName).join(" ");
}

// TODO(llm-enrich): optional opt-in pass that rewrites these best-effort
// descriptions with an LLM. Must stay out of `init`'s default path — analysis
// is offline by contract.
function describe(route: RouteInfo): string {
  if (route.doc) return route.doc;
  if (route.handlerName) return `${humanize(route.handlerName)} (${route.method} ${route.path})`;
  return `${route.method} ${route.path}`;
}

/**
 * Turn discovered routes into a manifest. Deterministic: routes are sorted
 * by path then method, and name collisions are resolved the same way every
 * run, so re-running `ahaft init` produces clean git diffs.
 */
export function generateManifest(routes: RouteInfo[], framework: string): Manifest {
  const sorted = [...routes].sort(
    (a, b) =>
      a.path.localeCompare(b.path) ||
      METHOD_ORDER.indexOf(a.method) - METHOD_ORDER.indexOf(b.method) ||
      a.sourceFile.localeCompare(b.sourceFile),
  );

  // Name assignment: prefer verb_noun; on collision fall back to the fully
  // qualified path-based name; if even that collides, add a numeric suffix.
  const counts = new Map<string, number>();
  for (const route of sorted) {
    const { primary } = baseName(route);
    counts.set(primary, (counts.get(primary) ?? 0) + 1);
  }
  const used = new Set<string>();
  const tools: ManifestTool[] = sorted.map((route) => {
    const { primary, qualified } = baseName(route);
    let name = (counts.get(primary) ?? 0) > 1 ? qualified : primary;
    if (used.has(name)) {
      let i = 2;
      while (used.has(`${name}_${i}`)) i++;
      name = `${name}_${i}`;
    }
    used.add(name);

    const access = classifyAccess(route.method, route.path, route.handlerName);
    return {
      name,
      description: describe(route),
      method: route.method,
      path: route.path,
      access,
      enabled: defaultEnabled(access),
      params: route.params,
    };
  });

  return { version: MANIFEST_VERSION, framework, tools };
}
