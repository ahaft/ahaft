/**
 * Framework-agnostic route model. Analyzers for other frameworks
 * (Next.js, Django, FastAPI, ...) produce the same shape, so everything
 * downstream (manifest generation, MCP server) stays framework-neutral.
 */

export type HttpMethod = "GET" | "HEAD" | "POST" | "PUT" | "PATCH" | "DELETE";

export type ParamLocation = "path" | "query" | "body";

export type ParamType = "string" | "number" | "boolean" | "object" | "unknown";

export interface RouteParam {
  name: string;
  in: ParamLocation;
  type: ParamType;
  required: boolean;
}

export interface RouteInfo {
  method: HttpMethod;
  /** Full mounted path, e.g. /api/products/:id */
  path: string;
  params: RouteParam[];
  /** Name of the handler function, if it has one. */
  handlerName?: string;
  /** JSDoc / leading comment text found next to the route registration. */
  doc?: string;
  /** Source file the route was found in (relative to the app root). */
  sourceFile: string;
}

export interface DetectResult {
  detected: boolean;
  /** Why detection succeeded or failed — always shown to the user. */
  reason: string;
}

export interface AnalyzeResult {
  routes: RouteInfo[];
  /** Non-fatal notes (e.g. files that failed to parse). */
  warnings: string[];
}

/**
 * One analyzer per framework. Analysis must be fully static: no code
 * execution, no network access, no reading of .env or other secrets.
 */
export interface Analyzer {
  /** Framework id stored in the manifest, e.g. "express". */
  name: string;
  detect(rootDir: string): Promise<DetectResult>;
  analyze(rootDir: string): Promise<AnalyzeResult>;
}
