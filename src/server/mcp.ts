import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z, type ZodTypeAny } from "zod";
import type { Manifest, ManifestTool, ToolParam } from "../manifest/schema.js";
import { proxyCall, type ProxyOptions } from "./proxy.js";
import type { AuditLog } from "./audit.js";

function zodForParam(param: ToolParam): ZodTypeAny {
  let type: ZodTypeAny;
  switch (param.type) {
    case "string":
      type = z.string();
      break;
    case "number":
      type = z.number();
      break;
    case "boolean":
      type = z.boolean();
      break;
    case "object":
      type = z.record(z.unknown());
      break;
    case "unknown":
      type = z.union([z.string(), z.number(), z.boolean(), z.record(z.unknown()), z.null()]);
      break;
  }
  type = type.describe(`${param.in} parameter`);
  return param.required ? type : type.optional();
}

function inputSchema(tool: ManifestTool): Record<string, ZodTypeAny> {
  const shape: Record<string, ZodTypeAny> = {};
  for (const param of tool.params) shape[param.name] = zodForParam(param);
  return shape;
}

function annotationsFor(tool: ManifestTool) {
  return {
    readOnlyHint: tool.access === "read",
    destructiveHint: tool.access === "destructive",
    idempotentHint: tool.method === "PUT" || tool.method === "DELETE" || tool.access === "read",
    openWorldHint: false,
  };
}

export interface ServeOptions extends ProxyOptions {
  audit: AuditLog;
}

/**
 * Build an MCP server exposing only the manifest's enabled tools, each
 * proxying to the running app over HTTP.
 */
export function buildMcpServer(manifest: Manifest, options: ServeOptions): McpServer {
  const server = new McpServer({ name: "ahaft", version: "0.1.0" });

  for (const tool of manifest.tools) {
    if (!tool.enabled) continue;
    server.registerTool(
      tool.name,
      {
        description: `${tool.description} [${tool.access}] (${tool.method} ${tool.path})`,
        inputSchema: inputSchema(tool),
        annotations: annotationsFor(tool),
      },
      async (args: Record<string, unknown>) => {
        try {
          const result = await proxyCall(tool, args, options);
          await options.audit.record({
            tool: tool.name,
            args,
            status: result.status,
            durationMs: result.durationMs,
          });
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({ status: result.status, body: result.body }, null, 2),
              },
            ],
            isError: result.status >= 400,
          };
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          await options.audit.record({ tool: tool.name, args, error: message });
          return {
            content: [{ type: "text" as const, text: `request failed: ${message}` }],
            isError: true,
          };
        }
      },
    );
  }
  return server;
}
