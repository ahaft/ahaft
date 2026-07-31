import { describe, expect, it } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { detectFramework } from "../src/analyzer/index.js";
import { expressAnalyzer, joinPaths, pathParams } from "../src/analyzer/express/index.js";
import type { RouteInfo } from "../src/analyzer/types.js";

const fixturesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");
const fixture = (name: string) => path.join(fixturesDir, name);

const byMethodPath = (routes: RouteInfo[], method: string, routePath: string) =>
  routes.find((r) => r.method === method && r.path === routePath);

describe("framework detection", () => {
  it("detects an express app via package.json", async () => {
    const { analyzer } = await detectFramework(fixture("js-app"));
    expect(analyzer?.name).toBe("express");
  });

  it("refuses to guess for a non-express app, with a reason", async () => {
    const { analyzer, details } = await detectFramework(fixture("not-express"));
    expect(analyzer).toBeUndefined();
    expect(details[0]?.result.reason).toMatch(/no express/);
  });

  it("detects express via source imports when package.json lacks it", async () => {
    const result = await expressAnalyzer.detect(fixture("ts-app"));
    expect(result.detected).toBe(true);
  });
});

describe("express route extraction (JS, app.<method>)", () => {
  it("finds all real routes and skips config getters", async () => {
    const { routes } = await expressAnalyzer.analyze(fixture("js-app"));
    const signatures = routes.map((r) => `${r.method} ${r.path}`).sort();
    expect(signatures).toEqual([
      "DELETE /widgets/:id",
      "GET /widgets",
      "GET /widgets/:id",
      "POST /widgets",
      "POST /widgets/:id/notify",
      "PUT /widgets/:id",
    ]);
  });

  it("captures JSDoc descriptions", async () => {
    const { routes } = await expressAnalyzer.analyze(fixture("js-app"));
    expect(byMethodPath(routes, "GET", "/widgets")?.doc).toBe("List all widgets in the catalog.");
    expect(byMethodPath(routes, "GET", "/widgets/:id")?.doc).toBe("Fetch a single widget by id.");
  });

  it("infers path, query and body params with types from defaults", async () => {
    const { routes } = await expressAnalyzer.analyze(fixture("js-app"));
    const list = byMethodPath(routes, "GET", "/widgets");
    expect(list?.params).toContainEqual({ name: "limit", in: "query", type: "number", required: false });

    const create = byMethodPath(routes, "POST", "/widgets");
    expect(create?.params).toContainEqual({ name: "name", in: "body", type: "unknown", required: false });
    expect(create?.params).toContainEqual({ name: "price", in: "body", type: "number", required: false });

    const get = byMethodPath(routes, "GET", "/widgets/:id");
    expect(get?.params).toContainEqual({ name: "id", in: "path", type: "string", required: true });
  });

  it("resolves named handler functions: params, name and JSDoc", async () => {
    const { routes } = await expressAnalyzer.analyze(fixture("js-app"));
    const put = byMethodPath(routes, "PUT", "/widgets/:id");
    expect(put?.handlerName).toBe("updateWidget");
    expect(put?.doc).toBe("Replace every field of a widget.");
    expect(put?.params).toContainEqual({ name: "active", in: "body", type: "unknown", required: false });
  });
});

describe("express route extraction (TS, Router + mounts)", () => {
  it("applies mount prefixes to routes from imported routers", async () => {
    const { routes } = await expressAnalyzer.analyze(fixture("ts-app"));
    const signatures = routes.map((r) => `${r.method} ${r.path}`).sort();
    expect(signatures).toEqual([
      "GET /api/orders",
      "GET /api/orders/:orderId",
      "GET /health",
      "POST /api/orders/:orderId/charge",
    ]);
  });

  it("keeps docs and params through the mount", async () => {
    const { routes } = await expressAnalyzer.analyze(fixture("ts-app"));
    const list = byMethodPath(routes, "GET", "/api/orders");
    expect(list?.doc).toBe("List orders, optionally filtered by status.");
    expect(list?.params).toContainEqual({ name: "status", in: "query", type: "string", required: false });
    const get = byMethodPath(routes, "GET", "/api/orders/:orderId");
    expect(get?.params).toContainEqual({ name: "orderId", in: "path", type: "string", required: true });
  });
});

describe("path helpers", () => {
  it("joins mount prefixes cleanly", () => {
    expect(joinPaths("/api", "/products")).toBe("/api/products");
    expect(joinPaths("", "/products")).toBe("/products");
    expect(joinPaths("/api/", "/")).toBe("/api");
    expect(joinPaths("/", "/")).toBe("/");
  });

  it("extracts path params including optional ones", () => {
    expect(pathParams("/a/:id/b/:rest?")).toEqual([
      { name: "id", in: "path", type: "string", required: true },
      { name: "rest", in: "path", type: "string", required: false },
    ]);
  });
});
