#!/usr/bin/env node
import { Command } from "commander";
import { MANIFEST_FILENAME } from "../manifest/schema.js";
import { runInit } from "./init.js";
import { runServe } from "./serve.js";
import { runList } from "./list.js";

const program = new Command();

program
  .name("ahaft")
  .description("Give your software a handle AI agents can grip: a curated, permission-scoped MCP tool layer.")
  .version("0.1.0");

program
  .command("init")
  .argument("[path]", "root directory of the app to analyze", ".")
  .description(`analyze an app and write a reviewable ${MANIFEST_FILENAME} manifest`)
  .action(async (targetPath: string) => {
    await runInit(targetPath);
  });

program
  .command("serve")
  .description("start an MCP server (stdio) exposing the manifest's enabled tools")
  .option("-m, --manifest <file>", "manifest file", MANIFEST_FILENAME)
  .option("-b, --base-url <url>", "base URL of the running app", "http://localhost:3000")
  .option(
    "-H, --header <header...>",
    'extra header for proxied requests, e.g. -H "Authorization: Bearer ..." (never sourced from .env)',
    (value: string, previous: string[]) => [...previous, value],
    [] as string[],
  )
  .action(async (options: { manifest: string; baseUrl: string; header: string[] }) => {
    await runServe(options);
  });

program
  .command("list")
  .description("list the manifest's tools with access level and enabled status")
  .option("-m, --manifest <file>", "manifest file", MANIFEST_FILENAME)
  .action(async (options: { manifest: string }) => {
    await runList(options.manifest);
  });

program.parseAsync().catch((err: unknown) => {
  console.error(`ahaft: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
