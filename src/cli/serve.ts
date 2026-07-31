import path from "node:path";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadManifest } from "../manifest/index.js";
import { AuditLog, buildMcpServer } from "../server/index.js";

export interface ServeCliOptions {
  manifest: string;
  baseUrl: string;
  header: string[];
}

export function parseHeaderFlags(flags: string[]): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const flag of flags) {
    const colon = flag.indexOf(":");
    if (colon <= 0) throw new Error(`invalid --header "${flag}" — expected "Name: value"`);
    headers[flag.slice(0, colon).trim()] = flag.slice(colon + 1).trim();
  }
  return headers;
}

export async function runServe(options: ServeCliOptions): Promise<void> {
  const manifestPath = path.resolve(options.manifest);
  const manifest = await loadManifest(manifestPath);
  // Headers come exclusively from explicit --header flags. ahaft never
  // reads .env files or ambient credentials on the app's behalf.
  const headers = parseHeaderFlags(options.header);

  const enabled = manifest.tools.filter((t) => t.enabled);
  const disabled = manifest.tools.length - enabled.length;
  const audit = new AuditLog(path.dirname(manifestPath));
  const server = buildMcpServer(manifest, { baseUrl: options.baseUrl, headers, audit });

  // stdout belongs to the stdio MCP transport — all logging goes to stderr.
  console.error(
    `ahaft: serving ${enabled.length} enabled tool(s) over stdio` +
      (disabled > 0 ? ` (${disabled} disabled in the manifest)` : ""),
  );
  console.error(`ahaft: proxying to ${options.baseUrl}`);
  console.error(`ahaft: audit log at ${audit.path}`);
  if (enabled.length === 0) {
    console.error("ahaft: warning — no tools are enabled; edit ahaft.yaml and set `enabled: true` on reviewed tools");
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
