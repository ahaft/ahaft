import { describe, expect, it } from "vitest";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildRequest } from "../src/server/proxy.js";
import { AuditLog, redact } from "../src/server/audit.js";
import { parseHeaderFlags } from "../src/cli/serve.js";
import type { ManifestTool } from "../src/manifest/schema.js";

const tool = (overrides: Partial<ManifestTool>): ManifestTool => ({
  name: "t",
  description: "",
  method: "GET",
  path: "/things",
  access: "read",
  enabled: true,
  params: [],
  ...overrides,
});

describe("proxy request building", () => {
  it("substitutes path params with URI encoding", () => {
    const t = tool({
      path: "/products/:id",
      params: [{ name: "id", in: "path", type: "string", required: true }],
    });
    expect(buildRequest(t, { id: "a/b c" }, "http://localhost:3000").url).toBe(
      "http://localhost:3000/products/a%2Fb%20c",
    );
  });

  it("throws on missing required path params", () => {
    const t = tool({
      path: "/products/:id",
      params: [{ name: "id", in: "path", type: "string", required: true }],
    });
    expect(() => buildRequest(t, {}, "http://x")).toThrow(/missing required path parameter "id"/);
  });

  it("maps query params and skips absent ones", () => {
    const t = tool({
      params: [
        { name: "limit", in: "query", type: "number", required: false },
        { name: "q", in: "query", type: "string", required: false },
      ],
    });
    expect(buildRequest(t, { limit: 5 }, "http://x").url).toBe("http://x/things?limit=5");
  });

  it("collects body props into a JSON body for writes only", () => {
    const t = tool({
      method: "PATCH",
      path: "/products/:id",
      params: [
        { name: "id", in: "path", type: "string", required: true },
        { name: "hidden", in: "body", type: "unknown", required: false },
      ],
    });
    const { body } = buildRequest(t, { id: "1", hidden: true }, "http://x");
    expect(JSON.parse(body!)).toEqual({ hidden: true });

    const readTool = tool({ params: [{ name: "x", in: "body", type: "unknown", required: false }] });
    expect(buildRequest(readTool, { x: 1 }, "http://x").body).toBeUndefined();
  });

  it("passes a whole-object `body` param through as the request body", () => {
    const t = tool({
      method: "POST",
      params: [{ name: "body", in: "body", type: "object", required: false }],
    });
    const { body } = buildRequest(t, { body: { a: 1, b: [2] } }, "http://x");
    expect(JSON.parse(body!)).toEqual({ a: 1, b: [2] });
  });
});

describe("audit log", () => {
  it("redacts sensitive keys recursively", () => {
    expect(
      redact({
        apiKey: "abc",
        nested: { Authorization: "Bearer x", ok: 1 },
        list: [{ password: "p" }],
        SECRET_TOKEN: "s",
        fine: "visible",
      }),
    ).toEqual({
      apiKey: "[REDACTED]",
      nested: { Authorization: "[REDACTED]", ok: 1 },
      list: [{ password: "[REDACTED]" }],
      SECRET_TOKEN: "[REDACTED]",
      fine: "visible",
    });
  });

  it("writes JSONL entries with redacted args", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "ahaft-audit-"));
    const audit = new AuditLog(dir);
    await audit.record({ tool: "create_product", args: { name: "x", token: "nope" }, status: 201, durationMs: 12 });
    await audit.record({ tool: "list_products", args: {}, error: "boom" });

    const lines = (await readFile(path.join(dir, ".ahaft", "audit.log"), "utf8")).trim().split("\n");
    expect(lines).toHaveLength(2);
    const first = JSON.parse(lines[0]!);
    expect(first.tool).toBe("create_product");
    expect(first.args).toEqual({ name: "x", token: "[REDACTED]" });
    expect(first.status).toBe(201);
    expect(typeof first.ts).toBe("string");
    expect(JSON.parse(lines[1]!).error).toBe("boom");
  });
});

describe("header flags", () => {
  it("parses Name: value pairs and rejects malformed input", () => {
    expect(parseHeaderFlags(["Authorization: Bearer abc", "X-Team:ops"])).toEqual({
      Authorization: "Bearer abc",
      "X-Team": "ops",
    });
    expect(() => parseHeaderFlags(["nope"])).toThrow(/expected "Name: value"/);
  });
});
