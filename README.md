# ahaft

**ahaft** ("agent haft") gives existing software a handle AI agents can grip.

A *haft* is the handle of a tool — the part made for a hand. Your app already has the blade: routes, logic, data. ahaft points at your codebase, discovers what the app can do, and generates a curated, **permission-scoped, MCP-compatible tool layer** so agents can operate the app safely — with you deciding, endpoint by endpoint, what an agent is allowed to touch.

- **`ahaft init`** — statically analyzes your app (no code execution, no LLM, no network) and writes `ahaft.yaml`: one proposed tool per endpoint, classified as `read`, `write`, or `destructive`.
- **You review** — every write and destructive tool starts `enabled: false`. Flipping one on is a deliberate act, not a default. This review step is the whole safety story.
- **`ahaft serve`** — starts an MCP server (stdio) exposing only the enabled tools, proxying calls to your running app and writing a JSONL audit log of every invocation.
- **`ahaft list`** — shows the manifest: every tool, its access level, and whether it's enabled.

The MVP supports **Express** apps (JavaScript or TypeScript, `app.get/post/...` and `express.Router`). The analyzer sits behind an interface so Next.js, Django, and FastAPI can be added without touching the rest.

## Quickstart

Walk the whole loop with the bundled demo app — an in-memory Express store.

```bash
git clone https://github.com/ahaft/ahaft.git
cd ahaft
npm install
npm run build
```

**1. Start the demo app** (keep it running in its own terminal):

```bash
npm run demo
# demo-store listening on http://localhost:3000
```

**2. Generate the manifest:**

```bash
npx ahaft init examples/demo-store
```

```
TOOL            METHOD  PATH           ACCESS       ENABLED
--------------  ------  -------------  -----------  -----------
list_products   GET     /products      read         yes
create_product  POST    /products      write        NO — review
get_product     GET     /products/:id  read         yes
update_product  PATCH   /products/:id  write        NO — review
delete_product  DELETE  /products/:id  destructive  NO — review
```

**3. Review and enable.** Open `examples/demo-store/ahaft.yaml`. Reads are on; writes are off. Decide what an agent may do — for this demo, allow product updates by finding `update_product` and setting:

```yaml
    enabled: true
```

**4. Serve it** (this is what an MCP client launches; try it directly with `npx ahaft serve --manifest examples/demo-store/ahaft.yaml`, or just go to step 5).

**5. Add it to Claude Code** from the repo root:

```bash
claude mcp add demo-store -- npx ahaft serve --manifest "$PWD/examples/demo-store/ahaft.yaml" --base-url http://localhost:3000
```

**6. Ask the agent things:**

> list the products

> hide the cheapest product

The first uses `list_products` (read, enabled by default). The second needs `update_product` — which works because *you* enabled it. Ask it to *delete* a product and it can't: `delete_product` is destructive and still off. Every call it did make is in `examples/demo-store/.ahaft/audit.log`.

## The manifest

`ahaft.yaml` is a human-editable contract between your app and any agent:

```yaml
version: 1
framework: express
tools:
  # write — review before setting enabled: true
  - name: update_product
    description: "Update a product's fields. Supports { hidden: true } to hide it..."
    method: PATCH
    path: /products/:id
    access: write
    enabled: false
    params:
      - name: id
        in: path
        type: string
        required: true
      - name: hidden
        in: body
        type: unknown
        required: false
```

Access rules:

| access | meaning | default |
|---|---|---|
| `read` | GET/HEAD | enabled |
| `write` | POST/PUT/PATCH | **disabled** |
| `destructive` | DELETE — or any write whose path/handler suggests deletion, payment, or email sending | **disabled** |

Names, descriptions, and params come from static analysis of routes, handler names, inferred `req.query`/`req.body` usage, and JSDoc. Edit them freely — the file is yours. Re-running `ahaft init` regenerates deterministically (clean git diffs), but overwrites your edits, so commit first.

## Safety model

- **Curation by default.** Nothing that changes state is exposed until a human enables it.
- **Static analysis only.** `ahaft init` never executes your app, never calls an LLM, never touches the network.
- **No ambient credentials.** ahaft never reads `.env` and never attaches auth headers unless you pass explicit `--header "Name: value"` flags to `serve`.
- **Audit trail.** Every tool call is appended to `.ahaft/audit.log` (JSONL: timestamp, tool, args, status, duration) with values of sensitive-looking keys (`token`, `secret`, `password`, `key`, `authorization`) redacted.
- **Honest annotations.** Tools carry MCP `readOnlyHint` / `destructiveHint` annotations so well-behaved clients can apply their own guardrails too.

## CLI reference

```
ahaft init [path]                 analyze an app, write ahaft.yaml (default: .)
ahaft list  [-m ahaft.yaml]       show tools, access levels, enabled status
ahaft serve [-m ahaft.yaml]       MCP server over stdio, only enabled tools
            [-b http://localhost:3000]   base URL of the running app
            [-H "Name: value"]...        explicit extra headers
```

## Development

```bash
npm test           # builds, then runs unit + end-to-end tests (vitest)
npm run typecheck
```

Framework analyzers implement one interface (`src/analyzer/types.ts`) and register in `src/analyzer/index.ts`. Planned but deliberately out of the MVP: Next.js/Django/FastAPI analyzers, LLM-enriched tool descriptions, and manifest re-sync (merging regenerated routes into an edited manifest) — each has a marked TODO seam.

## License

Apache-2.0

---

A blade without a haft cuts the hand that holds it. **Give your software a handle.**
