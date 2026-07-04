---
name: mcp-openapi-typescript-stack
description: >-
  Documents a portable TypeScript MCP server pattern: OpenAPI-generated Ky client
  + Zod request schemas, dual transports (stdio and streamable HTTP), optional
  multi-tenant credentials via AsyncLocalStorage, library-first public API with
  optional CLI, and authentication modeling (e.g. HTTP Basic from two-part
  secrets, Bearer/OAuth tokens, APIs that accept both). Use when scaffolding or
  refactoring any MCP server that wraps a REST API with @hey-api/openapi-ts (or
  similar codegen), when comparing this layout to FastMCP or other stacks, or
  after mcp-builder when the stack is TypeScript + generated SDK + MCP SDK, or
  when configuring or debugging @hey-api/openapi-ts (plugins, CLI, Zod
  validators, Ky client), or when adding opt-in env-gated debug logs for HTTP
  credential / tenant resolution.
---

# MCP + OpenAPI TypeScript stack (library-first)

This skill describes a **reusable architecture pattern**: a single package that
can be an **npm library**, a **CLI MCP process**, and a thin **MCP tool layer**
over a **generated HTTP client**. Reference implementations may use different
file and function names; the **roles** stay the same.

Use it **together with**:

- [mcp-builder](https://skills.sh/anthropics/skills/mcp-builder) — protocol
  framing, tool design, MCP SDK usage, evaluation.
- [mcp-workflow-design](../mcp-workflow-design/SKILL.md) — composite workflow
  tools on top of atomic 1:1 API tools.

**Do not duplicate those skills here.** This document answers: *how is the code
organized, why, and what to decide before adopting the pattern on a greenfield or
existing MCP server.*

---

## Recommended starting point: mcp-template

For **greenfield** servers, start from the
[mcp-template](https://github.com/atomicpages/mcp-template) GitHub template
repo — **optional but recommended**. It concretizes this skill's architecture
into a runnable scaffold with placeholder tokens you rename once via `setup.ts`.

**Quick start:**

```bash
gh repo create --template atomicpages/mcp-template --clone my-service-mcp
cd my-service-mcp
bun setup.ts \
  --kebab my-service \
  --pascal MyService \
  --upper MY_SERVICE \
  --title "My Service"

bun install
bun run build
```

**What the template provides:**

- Dual transport (stdio + streamable HTTP) wired to a single tool registry
- Multi-tenant credential mode via AsyncLocalStorage + interceptor
- Atomic tool registrar (Zod → inputSchema, BigInt sanitization, error mapping)
- Workflow helpers (`callApi`, `callApiAll`, response builders)
- `env.ts` (envalid schema with debug-logging flag)
- Build script (dual bundle + `.d.ts`)
- CLI entry with `--http` / `--multi-tenant` flags

**What you implement:**

- Real SDK (OpenAPI codegen or hand-written client)
- Auth scheme in `configure*Client`
- Domain tool modules (replace `example.ts`)
- Workflow modules (replace `example-workflow.ts`)

**When NOT to use the template:**

- Retrofitting an **existing** repo — apply this skill's patterns directly.
- **Edge-only** deployment (Workers) with no stdio need — the template targets
  long-lived Node/Bun processes; add a `src/worker.ts` per the edge-runtime
  guidance below.
- You need a **different bundler** or runtime (Deno, esbuild-only) — use the
  repository map and flows from this skill as a blueprint.

The rest of this skill remains the authoritative reference for architecture
decisions, auth modeling, and edge-runtime patterns regardless of whether you
start from the template. See `TEMPLATE.md` in the cloned repo for the detailed
implementation guide.

---

## HTTP client: use Ky, not axios

For the generated REST client and any hand-written fetch layer in this pattern,
use **[ky](https://github.com/sindresorhus/ky)** via **`@hey-api/client-ky`**.
**Do not use axios** — avoid `@hey-api/client-axios`, axios interceptors, or
axios examples when implementing or regenerating clients for MCP servers in this
stack.

**Why Ky over axios for MCP:**

- Ky fits the Web **`Request`/`Response`** APIs (built on `fetch`) — same types
  edge workers and streamable HTTP hosts use.
- Ky has a **small surface area** — fewer methods and config knobs than axios,
  which keeps generated clients and interceptors easy to reason about.
- Ky matches the **interceptor style** this stack uses for per-request /
  multi-tenant auth (`options.headers`, not axios config merging).

---

## @hey-api/openapi-ts (essentials)

**What it is:** `@hey-api/openapi-ts` is the CLI and `defineConfig()` entrypoint
that generates **`client.gen.ts`** (Ky), **`sdk.gen.ts`** (per-operation
functions), **types**, and optional **Zod** request schemas (**`zod.gen.ts`**) from
OpenAPI 3.x.

**Run codegen** from the repo root (after `input` spec is valid):

```bash
bunx openapi-ts
# or: npx @hey-api/openapi-ts
```

**Typical `openapi-ts.config.ts` plugin chain for this stack:** `@hey-api/client-ky`
(with `baseUrl`) → `@hey-api/schemas` → `@hey-api/transformers` →
`@hey-api/typescript` → `@hey-api/sdk` with `validator: { request: "zod" }` so MCP
atomic tools can reuse generated Zod for tool `inputSchema`. Plugin **order**
matters; the legacy plugin name **`@hey-api/services`** is now **`@hey-api/sdk`**.

**Output:** `sdk.gen.ts` (not the legacy `services.gen.ts`), `client.gen.ts`,
`types.gen.ts`, `zod.gen.ts`.

**Authoritative detail** (CLI flags, all plugins, migrations, Valibot): see
[references/openapi-ts.md](references/openapi-ts.md) and the upstream
[hey-api/openapi-ts](https://github.com/hey-api/openapi-ts) docs.

---

## Discovery questions (ask before planning or implementing)

**STOP. When a user says "plan" or "implement" an MCP server, your FIRST
response must ASK these questions — do not skip ahead to architecture or code.
Present them as a numbered list the user must answer.**

> **Shortcut:** If answers are "both transports, library + CLI, long-lived
> Node/Bun process" — use
> [mcp-template](https://github.com/atomicpages/mcp-template) and skip straight
> to implementation. The template already embodies those defaults.

Answer these for **any** MCP server so the layout stays appropriate:

1. **Tenancy / credentials**
   - **Single-tenant only** (one API key or token per process)?
   - **Multi-tenant HTTP** (per-request key, token, or async resolver)?
   - **Both** (e.g. stdio + shared secret for local dev; HTTP + per-tenant for
     hosted)?

2. **Transports**
   - **stdio** only (local MCP clients)?
   - **Streamable HTTP** only (remote gateway)?
   - **Both** (same tool registration; different `connect` paths)?

3. **Deployment target**
   - **Long-lived process** (Node / Bun on a VM or container)?
   - **Edge runtime** (Cloudflare Workers, Deno Deploy, Vercel Edge)?
     Plan for **deferred module loading** if targeting edge (see below).

4. **Distribution shape**
   - **CLI-only** binary (users run a command)?
   - **Library-only** (embed `create*McpServer` in another app)?
   - **Both** (recommended: `package.json` `exports` + `bin`)?

5. **API surface**
   - Is there a **machine-readable OpenAPI** spec (or can you maintain one)?
   - If not, you can still use the **same folder ideas** (hand-written client +
     Zod), but you lose **one spec as source of truth** for request shapes.

6. **Workflow vs atomic tools**
   - Start **1:1 with endpoints** (mcp-builder bias), then add **workflows**
     (mcp-workflow-design). A common split: **atomic** tools under
     `src/tools/<domain>.ts` (or similar) and **composite** tools under
     `src/tools/workflows/`.

7. **Upstream authentication schemes**
   - Does the API support **HTTP Basic** (including “two-part” secrets encoded as
     `Basic` per vendor docs), **Bearer** (OAuth or PAT), **both**, or other
     schemes (API-key headers, mTLS)?
   - For **OAuth**: who obtains and refreshes tokens — the MCP process, a
     gateway in front of MCP, or an external secret/token service the resolver
     calls?

Optional follow-ups: Node vs Bun for the default HTTP entrypoint, rate limits,
and whether tenant secrets may appear in process memory (TLS, resolver to
KMS/DB, etc.).

---

## Authentication

Upstream REST APIs often document **multiple** valid ways to authenticate. The
MCP layer should model **which modes you support in this package** (documented in
README / env), and map each mode to **one outbound `Authorization` (or custom)
header** on the shared HTTP client — via default config, per-request ALS +
interceptor, or both.

### Scheme families to plan for

**1. HTTP Basic with a derived token (two-part secrets)**
Some vendors issue an **access key** (or ID) and a **separate secret**. The wire
format is still RFC 7617 Basic: concatenate with a colon, Base64-encode the
UTF-8 string, send:

`Authorization: Basic <Base64(accessKey + ":" + accessKeySecret)>`

Read **two separate environment variables** — one for the access key, one for
the access key secret. Do not confuse this with “username only” Basic (some APIs
use empty password).

**`.env.example`:**

```bash
# Two-part HTTP Basic credentials (RFC 7617)
SERVICE_ACCESS_KEY=
SERVICE_ACCESS_KEY_SECRET=
```

**Single-tenant startup** (read both vars, set global client header once):

```typescript
const accessKey = process.env.SERVICE_ACCESS_KEY!;
const accessKeySecret = process.env.SERVICE_ACCESS_KEY_SECRET!;
const authorization = `Basic ${btoa(`${accessKey}:${accessKeySecret}`)}`;
client.setConfig({ headers: { authorization } });
```

Operators may also pre-compute the header once in a shell; the CLI pattern above
is the usual approach for MCP servers.

**2. Bearer token (OAuth or non-OAuth PAT)**
After the user or system obtains a token (OAuth flow, developer portal, etc.),
send:

`Authorization: Bearer <token>`

The MCP server usually **does not** re-run the full OAuth authorization-code
flow on every tool call. Typical patterns: token in env for stdio; inbound
`Authorization` forwarded under ALS for HTTP; or a **resolver** that reads a
refreshed token from a store or sidecar.

**3. APIs that accept Basic *or* Bearer**
The same OpenAPI/SDK can call the same paths; only the **credential shape**
changes. Implement **one** outbound path (interceptor or default headers) that
can set either a full `Authorization` string or a small set of variants your
resolver returns. Avoid branching every tool; keep auth in
client config + interceptor.

A resolver that returns **`{ authorization: string }`** (full header value)
is the most portable escape hatch — works for Basic, Bearer, or future schemes.

For OAuth: keep refresh logic out of hot tool paths. stdio users paste tokens;
hosted HTTP MCP gets tokens from a gateway or resolver. Document whether your
package implements OAuth endpoints or expects tokens **already issued**.

### Security notes

- Do not log `Authorization` headers or raw secrets.
- Use **TLS** for streamable HTTP MCP; treat header-based credentials as
  sensitive on the wire.
- In multi-tenant mode, ensure ALS scope is **per MCP HTTP request** so tenants
  cannot bleed credentials across concurrent requests.

For interceptor placement and context flow, see
[references/structure-and-flows.md](references/structure-and-flows.md).

### `@hey-api/client-ky` interceptor pitfall (critical)

The generated `@hey-api/client-ky` client has a two-stage request pipeline:
first `setAuthParams` sets `Authorization` on `opts.headers` from the global
config, then interceptors run on the `Request` object. But Ky receives **both**
the `Request` and `kyOptions` (which references `opts.headers`), and
**`kyOptions.headers` overwrites Request headers**.

If an interceptor only modifies the `Request` (e.g. `new Request(request, {
headers })`) without also updating `options.headers`, the global config's
`Authorization` silently overwrites the per-request auth. This is especially
dangerous in multi-tenant mode where the global key is empty — outbound requests
carry `Authorization: Basic Og==` (empty key) instead of the tenant's key,
causing 401s that look like missing credentials.

**Always modify `options.headers`** (the second interceptor parameter):

```typescript
client.interceptors.request.use(async (request, options) => {
  const optsHeaders = options?.headers as Headers | undefined;
  optsHeaders?.set("Authorization", resolvedAuthValue);
  return request;
});
```

See [references/openapi-ts.md § PITFALL](references/openapi-ts.md#pitfall-interceptor-must-modify-optionsheaders-not-just-the-request)
for the full generated-code walkthrough.

### Opt-in debug logging (env-gated)

For **multi-tenant HTTP** and **Docker** / gateway debugging, add **optional**
`console.error` (or your logger) behind a **boolean env var** so operators can
turn diagnostics on without noisy production defaults or leaking secrets.

**All debug output must go to `stderr` with a stable, grep-able prefix (e.g.
`[service-mcp] http-auth`) so operators can filter logs in noisy containers.**

**Pattern:**

- Declare a flag in your validated env schema (e.g. `envalid` `bool({ default:
  false })`), e.g. `SERVICE_MCP_DEBUG_HTTP_AUTH` or `SERVICE_DEBUG_TENANT_AUTH`.
  Include it in **strict** `cleanEnv` so deployments that set the var do not
  fail validation.
- When enabled, log a **stable prefix** (e.g. `[service-mcp] http-auth`) to
  **stderr** so logs are easy to grep.
- Log only **safe metadata**: HTTP method, URL **pathname** (not full URL if it
  may contain query secrets), **booleans** for whether configured API-key /
  `Authorization: Basic` / session headers are **present** (non-empty), names
  of keys in the resolved **context object** (not values), whether context is
  empty, and explicit **decisions** (e.g. `401` + `reason: empty_tenant_context`).
- **NEVER log:** header values, tokens, Base64 payloads, or secrets — including
  “redacted” snippets or auth-type prefixes derived from credential material.
- **Per-request logs** at the `wrap*HttpHandleRequest` boundary are especially
  useful: streamable HTTP uses **multiple** HTTP requests (POST, GET/SSE,
  DELETE). If one leg omits tenant headers, you will see **which method/path**
  lacked credentials without guessing from the client UI.

**`.env.example`:**

```bash
# NEVER log header values, tokens, Base64 payloads, or secrets — metadata only.
SERVICE_MCP_DEBUG_HTTP_AUTH=false
```

---

### Dual transport wiring

Register tools **once** in `create*McpServer()`. Expose **one entrypoint** that
accepts a `mode` parameter — the CLI passes `stdio` or `http` here. Do **not**
split into separate `startStdio()` / `startHttp()` functions as the primary API.

```typescript
export async function startMcpTransport(opts: {
  mode: "stdio" | "http";
  port?: number;
}) {
  const server = createMcpServer(); // tools registered once

  if (opts.mode === "stdio") {
    await server.connect(new StdioServerTransport());
    return;
  }

  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });
  await server.connect(transport);
  return {
    handleRequest: (req: Request) => transport.handleRequest(req),
  };
}
```

- **stdio** mode: blocks until the MCP client disconnects.
- **http** mode: returns `handleRequest` for any Web `Request`/`Response` host
  (Bun.serve, Hono, Cloudflare Workers, etc.) — keep the library agnostic of
  the Web runtime.
- Optional `connect*McpHttpTransport()` helper is fine for embedders; `start*McpTransport({ mode })` is the dispatch surface the CLI should call.

**CLI** (thin wrapper — passes mode to the single entrypoint):

```typescript
const mode = (process.argv[2] ?? "stdio") as "stdio" | "http";

if (mode === "http") {
  const { handleRequest } = await startMcpTransport({ mode: "http" });
  Bun.serve({ port: Number(process.env.PORT ?? 3000), fetch: handleRequest });
} else {
  await startMcpTransport({ mode: "stdio" });
}
```

---

## Repository map (roles, not fixed names)

| Role | Typical location (adjust to your repo) |
| ---- | ---------------------------------------- |
| **Library public API** | e.g. `src/<service>-mcp.ts` — client config, `register*Tools`, server factory, stdio/HTTP wiring, optional re-exports for HTTP/credential helpers. |
| **Per-request HTTP context** | e.g. `src/request-context.ts` — ALS, credential resolver, header/token bridge, wrapper around the transport’s `handleRequest`. |
| **CLI / dev entry** | `src/cli.ts`, `src/index.ts` — parse flags and env, configure client, create server, start transport. |
| **Edge worker entry** | e.g. `src/worker.ts` — Cloudflare Workers / edge runtime `fetch` handler. Dynamic-imports the library entry to defer heavy module evaluation past startup. Creates per-request server + stateless transport. |
| **Atomic tool registrar** | e.g. `src/tools/register.ts` — `registerAtomicTool`: Zod → MCP `inputSchema`, map params → SDK call shape, map errors → MCP text. |
| **Domain atomic modules** | e.g. `src/tools/<domain>.ts` — import `sdkFn` + generated schemas, call the atomic registrar. |
| **Workflow module** | e.g. `src/tools/workflows/` — `registerWorkflowTool` + shared `callSdk` / `callSdkAll`-style helpers. |
| **Generated output** | e.g. `src/generated/` — Ky client, SDK functions, Zod (from OpenAPI or your generator). |
| **Codegen config** | e.g. `openapi-ts.config.ts` — see [references/openapi-ts.md](references/openapi-ts.md). |
| **Package surface** | `package.json` — `exports` → library bundle; `bin` → CLI when you ship one. |

For ALS/credential flows, BigInt vs JSON Schema, and end-to-end diagrams, see
[references/structure-and-flows.md](references/structure-and-flows.md). For
`@hey-api/openapi-ts` plugins, CLI, and generated filenames, see
[references/openapi-ts.md](references/openapi-ts.md).

---

## Library-first package shape

The package is **both** an importable npm library and a CLI tool via
`package.json` fields:

- **`exports`** (library entry) — exposes the server factory
  (`create*McpServer`), client config (`configure*Client`), tool registration
  (`register*Tools`), and transport helpers (`start*McpTransport`,
  `connect*McpHttpTransport`). Consumers `import` these to embed the MCP server
  in their own app or test harness.
- **`bin`** (CLI entry) — a thin argv/env wrapper that parses flags (e.g.
  `--http`, `--multi-tenant`), reads environment variables, configures the
  client, and delegates to the library's server factory and transport helpers.
  The CLI should **never** contain tool definitions or business logic.

---

## How the pieces connect

**Atomic tool path:** MCP params → Zod-validated object → SDK call (often
`sdkFn({ body: params })`) → HTTP client → upstream API. The registrar projects
the agent-facing slice (often `body`) into MCP `inputSchema`.

**Workflow tool path:** Hand-crafted `inputSchema` → handler calls SDK functions
via helpers (unwrap, normalize errors) → aggregate → MCP content.

**HTTP multi-tenant path:** `Request` → `buildRequestContext` → ALS wraps
`handleRequest` → interceptor reads ALS + resolver → sets auth on
**`options.headers`**. Empty context → **401 before MCP**.

**Edge worker path:** Module-level: interceptor + base URL only. Per request:
dynamic `import()` → `create*McpServer()` → stateless transport → multi-tenant
`handleRequest` → `Response`. See
[references/structure-and-flows.md § Edge runtimes](references/structure-and-flows.md#6-edge-runtimes-cloudflare-workers-deno-deploy-etc).

---

## Tool annotations: `readOnlyHint` safety

MCP clients use `readOnlyHint` to gate user confirmation. **Defaulting to
`true` in the registrar is a security anti-pattern** — it suppresses prompts
for every write tool whose author omits the flag.
**Rules:** (1) Registrar defaults `readOnly` to **`false`** when unspecified
(matches MCP protocol default). Never `config.readOnly ?? true`. (2) When
`httpMethod` is available (OpenAPI), infer: GET/HEAD/OPTIONS = `true`, else
`false`; explicit `readOnly` overrides. (3) Add a **verification test** —
snapshot map and/or write-verb heuristic on `server.registeredTools`.
Resolution: explicit config > method inference > fail-safe `false`. For code,
see [references/structure-and-flows.md § readOnlyHint](references/structure-and-flows.md#readonlyhint-resolution-and-verification).

---

## Dependency versioning rule (mandatory)

**Always run `npm view <pkg>@latest version` before pinning any dep.** Never rely on recalled versions. Stack packages most likely to have major bumps: `zod`, `@modelcontextprotocol/sdk`, `@cloudflare/workers-types`, `@hey-api/openapi-ts`, `ky`, `wrangler`, etc.

---

## Checklist when adopting the pattern

- [ ] OpenAPI (or equivalent) drives generated client/schemas; regen is a
      documented command (`bunx openapi-ts` / `npx @hey-api/openapi-ts`).
- [ ] Codegen uses **`@hey-api/client-ky`** (not axios / not `@hey-api/client-axios`).
- [ ] One atomic registrar maps **generated Zod (or types) for the tool-facing
      slice** → MCP tools.
- [ ] Registrar defaults `readOnly` to `false` when unspecified (never `?? true`); verified by test.
- [ ] Workflows use a **separate** registrar with hand-written Zod (or validated
      input objects).
- [ ] Library entry exports server factory + transport helpers; CLI only
      parses argv/env when you ship a binary.
- [ ] Multi-tenant mode documented (headers, TLS, resolver hooks, 401 behavior).
- [ ] Per-request auth interceptor modifies **`options.headers`** (not just the
      `Request` object) to survive `@hey-api/client-ky`'s `kyOptions` merge.
- [ ] Optional **env-gated** debug logging for HTTP tenant/credential resolution
      (safe metadata only; default off); documented in `.env.example`.
- [ ] Supported auth modes documented (Basic two-part, Bearer, forwarded
      `Authorization`, OAuth expectations) and mapped to env / HTTP / resolver.
- [ ] If targeting an **edge runtime** (Workers, Deno Deploy): worker entry uses
      dynamic `import()` for the library entry (tools + generated schemas) to
      defer heavy evaluation past startup. Module-level code is limited to
      interceptor setup and base URL config.
- [ ] Edge worker creates a **fresh `McpServer` + stateless transport per
      request** (`Protocol.connect()` is one-shot; stateless transport is
      single-use).
- [ ] `nodejs_compat` (or equivalent) enabled for `node:crypto` and
      `node:async_hooks` (AsyncLocalStorage). Eager env readers (like `envalid`)
      have defaults for all fields so they don't crash at import time.
