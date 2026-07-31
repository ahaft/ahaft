import { z } from "zod";

export const MANIFEST_VERSION = 1;
export const MANIFEST_FILENAME = "ahaft.yaml";

export const accessLevelSchema = z.enum(["read", "write", "destructive"]);
export type AccessLevel = z.infer<typeof accessLevelSchema>;

export const toolParamSchema = z.object({
  name: z.string().min(1),
  in: z.enum(["path", "query", "body"]),
  type: z.enum(["string", "number", "boolean", "object", "unknown"]),
  required: z.boolean(),
});
export type ToolParam = z.infer<typeof toolParamSchema>;

export const toolSchema = z.object({
  name: z.string().regex(/^[a-z][a-z0-9_]*$/, "tool names must be snake_case"),
  description: z.string(),
  method: z.enum(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"]),
  path: z.string().startsWith("/"),
  access: accessLevelSchema,
  enabled: z.boolean(),
  params: z.array(toolParamSchema),
});
export type ManifestTool = z.infer<typeof toolSchema>;

export const manifestSchema = z.object({
  version: z.literal(MANIFEST_VERSION),
  framework: z.string(),
  tools: z.array(toolSchema),
});
export type Manifest = z.infer<typeof manifestSchema>;
