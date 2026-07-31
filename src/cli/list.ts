import path from "node:path";
import { loadManifest } from "../manifest/index.js";
import { renderTable } from "./table.js";

export async function runList(manifestFlag: string): Promise<void> {
  const manifestPath = path.resolve(manifestFlag);
  const manifest = await loadManifest(manifestPath);

  const rows = manifest.tools.map((t) => [
    t.name,
    t.method,
    t.path,
    t.access,
    t.enabled ? "yes" : "no",
  ]);
  console.log(renderTable(["TOOL", "METHOD", "PATH", "ACCESS", "ENABLED"], rows));

  const enabled = manifest.tools.filter((t) => t.enabled).length;
  console.log("");
  console.log(`${manifest.tools.length} tool(s), ${enabled} enabled. \`ahaft serve\` exposes only enabled tools.`);
}
