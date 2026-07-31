import { describe, expect, it } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expressAnalyzer } from "../src/analyzer/express/index.js";
import { classifyAccess, generateManifest, manifestToYaml, parseManifest } from "../src/manifest/index.js";
import type { RouteInfo } from "../src/analyzer/types.js";

const fixturesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");

const route = (method: RouteInfo["method"], p: string, handlerName?: string): RouteInfo => ({
  method,
  path: p,
  params: [],
  sourceFile: "server.js",
  ...(handlerName !== undefined ? { handlerName } : {}),
});

describe("access classification", () => {
  it("maps methods to access levels", () => {
    expect(classifyAccess("GET", "/products")).toBe("read");
    expect(classifyAccess("HEAD", "/products")).toBe("read");
    expect(classifyAccess("POST", "/products")).toBe("write");
    expect(classifyAccess("PUT", "/products/:id")).toBe("write");
    expect(classifyAccess("PATCH", "/products/:id")).toBe("write");
    expect(classifyAccess("DELETE", "/products/:id")).toBe("destructive");
  });

  it("escalates writes that look like deletion, payment or email", () => {
    expect(classifyAccess("POST", "/products/:id/remove")).toBe("destructive");
    expect(classifyAccess("POST", "/orders/:id/charge")).toBe("destructive");
    expect(classifyAccess("POST", "/contact", "sendEmail")).toBe("destructive");
    expect(classifyAccess("POST", "/payments")).toBe("destructive");
    expect(classifyAccess("POST", "/users/:id/mailingAddress")).toBe("write"); // token match, not substring
    expect(classifyAccess("POST", "/dropdowns")).toBe("write");
  });
});

describe("manifest generation", () => {
  it("names tools verb_noun and disables writes by default", () => {
    const manifest = generateManifest(
      [
        route("GET", "/products"),
        route("GET", "/products/:id"),
        route("POST", "/products"),
        route("PATCH", "/products/:id"),
        route("DELETE", "/products/:id"),
      ],
      "express",
    );
    // Sorted by path, then method order: collection ops first, then item ops.
    expect(manifest.tools.map((t) => [t.name, t.access, t.enabled])).toEqual([
      ["list_products", "read", true],
      ["create_product", "write", false],
      ["get_product", "read", true],
      ["update_product", "write", false],
      ["delete_product", "destructive", false],
    ]);
  });

  it("qualifies names on collision", () => {
    const manifest = generateManifest(
      [route("GET", "/orders"), route("GET", "/users/:id/orders")],
      "express",
    );
    expect(manifest.tools.map((t) => t.name)).toEqual(["list_orders", "list_users_orders"]);
  });

  it("is deterministic regardless of input order", () => {
    const routes = [
      route("DELETE", "/products/:id"),
      route("GET", "/products"),
      route("POST", "/products"),
    ];
    const a = manifestToYaml(generateManifest(routes, "express"));
    const b = manifestToYaml(generateManifest([...routes].reverse(), "express"));
    expect(a).toBe(b);
  });
});

describe("manifest yaml", () => {
  it("round-trips through YAML with comments and validates", () => {
    const manifest = generateManifest(
      [route("GET", "/products"), route("DELETE", "/products/:id")],
      "express",
    );
    const yamlText = manifestToYaml(manifest);
    expect(yamlText).toContain("Curation is the point");
    expect(yamlText).toContain("DESTRUCTIVE — review carefully");
    expect(parseManifest(yamlText, "ahaft.yaml")).toEqual(manifest);
  });

  it("rejects invalid manifests with a helpful error", () => {
    expect(() => parseManifest("version: 2\nframework: express\ntools: []", "ahaft.yaml")).toThrow(
      /not a valid ahaft manifest/,
    );
  });
});

describe("end-to-end over fixtures", () => {
  it("js fixture: email-ish write is destructive, all writes disabled", async () => {
    const { routes } = await expressAnalyzer.analyze(path.join(fixturesDir, "js-app"));
    const manifest = generateManifest(routes, "express");
    const notify = manifest.tools.find((t) => t.path === "/widgets/:id/notify");
    expect(notify?.access).toBe("destructive");
    for (const tool of manifest.tools) {
      expect(tool.enabled).toBe(tool.access === "read");
    }
  });
});
