import { readFile, writeFile } from "node:fs/promises";
import YAML, { YAMLSeq, YAMLMap } from "yaml";
import { manifestSchema, type Manifest } from "./schema.js";

const HEADER = `
ahaft manifest — the handle AI agents grip your app by.

Each tool below maps one HTTP endpoint of your app to an MCP tool.
\`ahaft serve\` exposes ONLY tools with \`enabled: true\`.

Access levels:
  read        — GET/HEAD, safe to expose by default
  write       — POST/PUT/PATCH, creates or changes data
  destructive — DELETE, or writes that look like deletion/payment/email

Curation is the point: every write and destructive tool starts with
\`enabled: false\`. Review each one — check the description, path, and
params — and flip it to true only when you are comfortable letting an
agent call it. Edit names, descriptions and params freely; this file is
yours. Re-run \`ahaft init\` to regenerate from source (it overwrites
this file, so commit your edits first).
`.trim();

/**
 * Serialize a manifest to YAML with the explanatory comments that make the
 * review step self-documenting.
 */
export function manifestToYaml(manifest: Manifest): string {
  const doc = new YAML.Document(manifest);
  doc.commentBefore = `\n${HEADER.split("\n").map((l) => (l ? ` ${l}` : "")).join("\n")}\n`;
  const tools = doc.get("tools", true);
  if (tools instanceof YAMLSeq) {
    tools.items.forEach((item, i) => {
      const tool = manifest.tools[i];
      if (!tool || tool.enabled || !(item instanceof YAMLMap)) return;
      item.commentBefore =
        tool.access === "destructive"
          ? " DESTRUCTIVE — review carefully before setting enabled: true"
          : " write — review before setting enabled: true";
    });
  }
  return doc.toString({ lineWidth: 100 });
}

export function parseManifest(yamlText: string, sourcePath: string): Manifest {
  let raw: unknown;
  try {
    raw = YAML.parse(yamlText);
  } catch (err) {
    throw new Error(`${sourcePath} is not valid YAML: ${err instanceof Error ? err.message : String(err)}`);
  }
  const result = manifestSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`${sourcePath} is not a valid ahaft manifest:\n${issues}`);
  }
  return result.data;
}

export async function loadManifest(manifestPath: string): Promise<Manifest> {
  let text: string;
  try {
    text = await readFile(manifestPath, "utf8");
  } catch {
    throw new Error(`no manifest found at ${manifestPath} — run \`ahaft init\` first`);
  }
  return parseManifest(text, manifestPath);
}

export async function saveManifest(manifestPath: string, manifest: Manifest): Promise<void> {
  await writeFile(manifestPath, manifestToYaml(manifest), "utf8");
}
