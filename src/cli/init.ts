import { existsSync } from "node:fs";
import path from "node:path";
import { detectFramework } from "../analyzer/index.js";
import { generateManifest, saveManifest, MANIFEST_FILENAME } from "../manifest/index.js";
import { renderTable } from "./table.js";

export async function runInit(targetPath: string): Promise<void> {
  const rootDir = path.resolve(targetPath);

  const { analyzer, details } = await detectFramework(rootDir);
  if (!analyzer) {
    console.error(`Could not detect a supported framework in ${rootDir}.\n`);
    for (const { name, result } of details) {
      console.error(`  ${name}: ${result.reason}`);
    }
    console.error(
      [
        "",
        "ahaft's MVP supports Express apps (routes registered via app.get/post/put/patch/delete",
        "or express.Router, in JavaScript or TypeScript).",
        "",
        "If this is an Express app, check that:",
        "  - you pointed ahaft at the app's root (the directory with its package.json), and",
        "  - express appears in package.json dependencies, or source files import it.",
        "",
        "Support for Next.js, Django and FastAPI is planned but not implemented yet.",
      ].join("\n"),
    );
    process.exitCode = 1;
    return;
  }

  console.log(`Detected framework: ${analyzer.name} (${details.find((d) => d.name === analyzer.name)?.result.reason})`);

  const { routes, warnings } = await analyzer.analyze(rootDir);
  for (const warning of warnings) console.error(`warning: ${warning}`);
  if (routes.length === 0) {
    console.error("No routes found. Nothing to do — is this the app's root directory?");
    process.exitCode = 1;
    return;
  }

  const manifest = generateManifest(routes, analyzer.name);
  const manifestPath = path.join(rootDir, MANIFEST_FILENAME);
  const existed = existsSync(manifestPath);
  // TODO(re-sync): when a manifest already exists, merge newly discovered
  // routes into it instead of overwriting, preserving the developer's
  // enabled flags and edited descriptions. For now init always regenerates.
  await saveManifest(manifestPath, manifest);

  const rows = manifest.tools.map((t) => [
    t.name,
    t.method,
    t.path,
    t.access,
    t.enabled ? "yes" : "NO — review",
  ]);
  console.log("");
  console.log(renderTable(["TOOL", "METHOD", "PATH", "ACCESS", "ENABLED"], rows));

  const counts = { read: 0, write: 0, destructive: 0 };
  for (const t of manifest.tools) counts[t.access]++;
  const disabled = manifest.tools.filter((t) => !t.enabled).length;

  console.log("");
  console.log(
    `${existed ? "Rewrote" : "Wrote"} ${manifestPath}: ${manifest.tools.length} tools ` +
      `(${counts.read} read, ${counts.write} write, ${counts.destructive} destructive).`,
  );
  if (disabled > 0) {
    console.log("");
    console.log(`Next: review the ${disabled} disabled write/destructive tool(s) in ${MANIFEST_FILENAME}.`);
    console.log("Each one stays off until you set `enabled: true` — that review is the safety step.");
    console.log("Then start the tool layer with: ahaft serve");
  } else {
    console.log("\nStart the tool layer with: ahaft serve");
  }
}
