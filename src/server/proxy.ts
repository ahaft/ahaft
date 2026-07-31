import type { ManifestTool } from "../manifest/schema.js";

export interface ProxyOptions {
  baseUrl: string;
  /**
   * Extra headers, only ever populated from explicit --header flags.
   * ahaft never reads .env files and never invents auth headers.
   */
  headers: Record<string, string>;
  timeoutMs?: number;
}

export interface ProxyResult {
  status: number;
  body: unknown;
  durationMs: number;
}

const BODY_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** Split tool arguments into URL path, query string and JSON body. */
export function buildRequest(
  tool: ManifestTool,
  args: Record<string, unknown>,
  baseUrl: string,
): { url: string; body: string | undefined } {
  let urlPath = tool.path;
  const query = new URLSearchParams();
  const bodyProps: Record<string, unknown> = {};
  let wholeBody: unknown;

  for (const param of tool.params) {
    const value = args[param.name];
    if (param.in === "path") {
      if (value === undefined || value === null) {
        if (param.required) throw new Error(`missing required path parameter "${param.name}"`);
        // optional path param (:id?) — drop the segment
        urlPath = urlPath.replace(new RegExp(`/:${param.name}\\?`), "");
        continue;
      }
      urlPath = urlPath.replace(new RegExp(`:${param.name}\\??`), encodeURIComponent(String(value)));
    } else if (param.in === "query") {
      if (value !== undefined && value !== null) query.set(param.name, String(value));
    } else {
      if (value === undefined) continue;
      // A single object param named "body" is the whole request body.
      if (param.name === "body" && param.type === "object") wholeBody = value;
      else bodyProps[param.name] = value;
    }
  }

  const base = baseUrl.replace(/\/$/, "");
  const qs = query.size > 0 ? `?${query.toString()}` : "";
  const url = `${base}${urlPath}${qs}`;

  let body: string | undefined;
  if (BODY_METHODS.has(tool.method)) {
    const payload = wholeBody !== undefined ? wholeBody : Object.keys(bodyProps).length > 0 ? bodyProps : undefined;
    if (payload !== undefined) body = JSON.stringify(payload);
  }
  return { url, body };
}

/** Call the target app over HTTP and return status + parsed body. */
export async function proxyCall(
  tool: ManifestTool,
  args: Record<string, unknown>,
  options: ProxyOptions,
): Promise<ProxyResult> {
  const { url, body } = buildRequest(tool, args, options.baseUrl);
  const headers: Record<string, string> = { accept: "application/json", ...options.headers };
  if (body !== undefined) headers["content-type"] = "application/json";

  const started = performance.now();
  const response = await fetch(url, {
    method: tool.method,
    headers,
    body,
    signal: AbortSignal.timeout(options.timeoutMs ?? 30_000),
  });
  const text = await response.text();
  const durationMs = Math.round(performance.now() - started);

  let parsed: unknown = text;
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("json") && text.length > 0) {
    try {
      parsed = JSON.parse(text);
    } catch {
      // keep raw text
    }
  }
  return { status: response.status, body: parsed, durationMs };
}
