/**
 * End-to-end proof: demo app -> `ahaft init` -> review/enable -> `ahaft serve`
 * -> MCP client drives a real state change over stdio.
 *
 * Runs against the compiled CLI in dist/ — `npm test` builds first.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { promisify } from "node:util";
import { cp, mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { parseManifest, manifestToYaml } from "../src/manifest/index.js";

const execFileAsync = promisify(execFile);
const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const cliPath = path.join(repoRoot, "dist", "cli", "index.js");
const demoDir = path.join(repoRoot, "examples", "demo-store");

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, () => {
      const address = server.address();
      if (address === null || typeof address === "string") return reject(new Error("no port"));
      server.close(() => resolve(address.port));
    });
  });
}

async function waitForHttp(url: string, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`server at ${url} did not come up in ${timeoutMs}ms`);
}

describe("end to end: init -> review -> serve -> MCP client", () => {
  let appDir: string;
  let demo: ChildProcess;
  let port: number;
  let baseUrl: string;
  let client: Client | undefined;

  beforeAll(async () => {
    // Analyze a copy so `ahaft init` never dirties the repo's example dir.
    appDir = await mkdtemp(path.join(tmpdir(), "ahaft-e2e-"));
    await cp(demoDir, appDir, { recursive: true });

    port = await freePort();
    baseUrl = `http://localhost:${port}`;
    demo = spawn(process.execPath, ["server.js"], {
      cwd: demoDir, // resolves express from the repo's node_modules
      env: { ...process.env, PORT: String(port) },
      stdio: "ignore",
    });
    await waitForHttp(`${baseUrl}/products`);
  }, 30_000);

  afterAll(async () => {
    await client?.close();
    demo?.kill();
    if (appDir) await rm(appDir, { recursive: true, force: true });
  });

  it("ahaft init proposes the five expected tools with safe defaults", async () => {
    const { stdout } = await execFileAsync(process.execPath, [cliPath, "init", appDir]);
    expect(stdout).toContain("Detected framework: express");
    expect(stdout).toContain("review");

    const manifest = parseManifest(await readFile(path.join(appDir, "ahaft.yaml"), "utf8"), "ahaft.yaml");
    const byName = Object.fromEntries(manifest.tools.map((t) => [t.name, t]));

    expect(Object.keys(byName).sort()).toEqual([
      "create_product",
      "delete_product",
      "get_product",
      "list_products",
      "update_product",
    ]);
    expect(byName.list_products).toMatchObject({ method: "GET", path: "/products", access: "read", enabled: true });
    expect(byName.get_product).toMatchObject({ method: "GET", path: "/products/:id", access: "read", enabled: true });
    expect(byName.create_product).toMatchObject({ method: "POST", access: "write", enabled: false });
    expect(byName.update_product).toMatchObject({ method: "PATCH", access: "write", enabled: false });
    expect(byName.delete_product).toMatchObject({ method: "DELETE", access: "destructive", enabled: false });

    // Docs and params made it through static analysis.
    expect(byName.list_products?.description).toMatch(/Hidden products are excluded/);
    expect(byName.list_products?.params).toContainEqual({
      name: "includeHidden",
      in: "query",
      type: "string",
      required: false,
    });
    expect(byName.update_product?.params).toContainEqual({
      name: "hidden",
      in: "body",
      type: "unknown",
      required: false,
    });
  }, 30_000);

  it("re-running init is deterministic", async () => {
    const before = await readFile(path.join(appDir, "ahaft.yaml"), "utf8");
    await execFileAsync(process.execPath, [cliPath, "init", appDir]);
    const after = await readFile(path.join(appDir, "ahaft.yaml"), "utf8");
    expect(after).toBe(before);
  }, 30_000);

  it("serves enabled tools over MCP and drives a real state change", async () => {
    // The developer's review step: deliberately enable one write tool.
    const manifestPath = path.join(appDir, "ahaft.yaml");
    const manifest = parseManifest(await readFile(manifestPath, "utf8"), "ahaft.yaml");
    const update = manifest.tools.find((t) => t.name === "update_product");
    expect(update).toBeDefined();
    update!.enabled = true;
    await import("node:fs/promises").then((fs) => fs.writeFile(manifestPath, manifestToYaml(manifest)));

    client = new Client({ name: "ahaft-e2e", version: "0.0.0" });
    await client.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: [cliPath, "serve", "--manifest", manifestPath, "--base-url", baseUrl],
        stderr: "ignore",
      }),
    );

    // Only enabled tools are exposed, with correct annotations.
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual(["get_product", "list_products", "update_product"]);
    const listTool = tools.find((t) => t.name === "list_products");
    expect(listTool?.annotations?.readOnlyHint).toBe(true);
    const updateTool = tools.find((t) => t.name === "update_product");
    expect(updateTool?.annotations?.readOnlyHint).toBe(false);
    expect(updateTool?.annotations?.destructiveHint).toBe(false);

    // Read tool works.
    const listResult = await client.callTool({ name: "list_products", arguments: {} });
    const listPayload = JSON.parse((listResult.content as Array<{ text: string }>)[0]!.text);
    expect(listPayload.status).toBe(200);
    expect(listPayload.body).toHaveLength(3);

    // Write tool causes a real, externally observable state change:
    // hide the cheapest product (Screwdriver, id 2).
    const updateResult = await client.callTool({
      name: "update_product",
      arguments: { id: "2", hidden: true },
    });
    const updatePayload = JSON.parse((updateResult.content as Array<{ text: string }>)[0]!.text);
    expect(updatePayload.status).toBe(200);
    expect(updatePayload.body.hidden).toBe(true);

    const remaining = (await (await fetch(`${baseUrl}/products`)).json()) as Array<{ name: string }>;
    expect(remaining.map((p) => p.name).sort()).toEqual(["Hammer", "Wrench"]);
    const hiddenProduct = (await (await fetch(`${baseUrl}/products/2`)).json()) as { hidden: boolean };
    expect(hiddenProduct.hidden).toBe(true);

    // Audit log recorded the calls next to the manifest.
    const auditLines = (await readFile(path.join(appDir, ".ahaft", "audit.log"), "utf8")).trim().split("\n");
    expect(auditLines.length).toBeGreaterThanOrEqual(2);
    const entries = auditLines.map((l) => JSON.parse(l));
    expect(entries.some((e) => e.tool === "list_products" && e.status === 200)).toBe(true);
    expect(entries.some((e) => e.tool === "update_product" && e.status === 200)).toBe(true);
  }, 30_000);
});
