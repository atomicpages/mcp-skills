# Structure and data flows (deep dive)

This reference expands on [../SKILL.md](../SKILL.md). **Names below are
illustrative** — swap in your service prefix, paths, and env vars when
implementing.

---

## 1. Package surface: library vs CLI

**Library** (`package.json` `exports["."]`):

- Consumers import client configuration, `create*McpServer`, `register*Tools`,
  transport starters, and optional HTTP/credential helpers from your **library
  entry** (bundled JS + types).

**CLI** (`package.json` `bin` → e.g. `dist/cli.js`):

- Loads env, requires a global API secret when using stdio or HTTP **without**
  multi-tenant mode, configures the shared client, builds one server, starts stdio
  or the default HTTP runtime (e.g. Bun.serve if you use that convenience).

**Why both:** Hosted gateways and tests can embed the server without spawning a
child process; operators and MCP clients can still run a single binary.

---

## 2. Transport layering

### stdio

- Dynamic import `@modelcontextprotocol/sdk/server/stdio.js`.
- `McpServer.connect(StdioServerTransport)`.
- Global HTTP client auth from `configure*Client` is typical; no per-request ALS
  unless you add it.

### Streamable HTTP

- `WebStandardStreamableHTTPServerTransport` from
  `@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js`.
- `sessionIdGenerator`: `undefined` for stateless mode, or `() => randomUUID()`
  for session IDs.
- A **`connect*McpHttpTransport`**-style helper returns `{ transport,
  handleRequest }` so **any** runtime that speaks Web `Request`/`Response` can
  host MCP (Bun.serve, Hono, Cloudflare Workers, etc.) without tying the library
  to one server API.
- A **`start*McpTransport({ mode: "http" })`** convenience may use `Bun.serve`
  when available; on Node without that runtime, throw clearly and point callers
  at the `handleRequest` wiring — avoids silent partial support.

---

## 3. Multi-tenant credential model

**Concepts:**

- **`HttpRequestContext`** (name as you like): opaque `Record<string, unknown>`
  built from the incoming HTTP request or gateway metadata.
- **AsyncLocalStorage**: each MCP HTTP invocation runs tool handlers under
  `run*HttpRequestContext(ctx, fn)` so the HTTP client interceptor can read the
  “current tenant” without threading `Request` through every tool.
- **`CredentialResolver`**: async `(ctx) => { apiKey } | { bearerToken } |
  { authorization } | null`. Map `ctx.tenantId` (or similar) to secrets from
  Redis/KMS/DB instead of storing raw secrets in context when you need stricter
  handling.
- **`installPerRequestAuthInterceptor`** (idempotent): Ky (or fetch wrapper)
  `request` hook that applies resolver output to outbound headers, or strips
  default auth when strict tenant mode forbids global fallback.
- **`wrapMcpHttpHandleRequest`**: wraps the transport’s `handleRequest` to
  `await buildRequestContext(req)` then run MCP under ALS; optional
  `requireTenantCredentials` returns **401** when context is empty.

**Header / token bridge** (example shapes):

- Custom header for API key or token (name from env or config), and/or
- `Authorization: Bearer …` — opaque access token (OAuth, PAT, etc.).
- `Authorization: Basic …` — Base64 payload per RFC 7617. Some vendors use
  **username:password** where both parts are secrets, e.g.
  `Basic ${base64utf8(`${accessKey}:${accessKeySecret}`)}` (Gong and others).
  Others use a single identifier with an empty password; follow vendor docs.
- Forwarding the **entire** inbound `Authorization` header to the upstream
  client when the deployment trusts the MCP HTTP edge (still require TLS).

For **dual-mode APIs** (same endpoints accept Basic *or* Bearer), keep one SDK
and one interceptor path; choose credential shape from env, per-tenant store, or
inbound headers. Full matrix and OAuth placement: see
[Authentication](../SKILL.md#authentication) in `SKILL.md`.

**Security note:** passing long-lived secrets in headers is only appropriate with
TLS and trusted infrastructure; production multi-tenant setups often use
short-lived tokens plus server-side resolution. Never log `Authorization` values.

---

## 4. OpenAPI codegen and the generated folder

Use **`@hey-api/openapi-ts`** with **`@hey-api/client-ky`** (not axios). Typical
artifacts: `client.gen.ts`, `sdk.gen.ts`, `zod.gen.ts`, types — see
[openapi-ts.md](openapi-ts.md) for `defineConfig`, plugin order, CLI, runtime
`setConfig` / interceptors, and troubleshooting.

**Rule:** treat `src/generated/**` as build output; fix mismatches by changing
the spec and regenerating, not by editing generated TS.

---

## 5. Zod: two strategies

### Atomic tools (generated)

- Import e.g. `zListItemsData` and `listItems` from generated modules (names
  follow your OpenAPI operation IDs).
- **`registerAtomicTool`** (your equivalent of a thin wrapper):
  - Walks the Zod shape under `body` (handles optional, intersection, union) if
    your generator nests params that way.
  - **Sanitizes BigInt** to `z.number().optional()` (or similar) where MCP JSON
    Schema cannot represent the type.
  - Calls the SDK with the shape your API expects (often `{ body: params }`).

### Workflow tools (hand-written)

- `registerWorkflowTool` takes a flat `inputSchema` object of Zod fields (not
  the full generated request envelope).
- Handlers use **`callSdk(sdkFn, body)`**-style helpers to unwrap `{ data }`
  (or your client’s wrapper), normalize **`success: false`** (or HTTP errors)
  into thrown errors, and use **`callSdkAll`** (or `Promise.allSettled`) for
  parallel partial success.

This split keeps **1:1 tools** cheap to add (codegen + one registrar block per
endpoint) while **workflows** stay intent-shaped.

---

## 6. Edge runtimes (Cloudflare Workers, Deno Deploy, etc.)

Edge runtimes impose constraints that differ from long-lived Node/Bun processes.
The core library code does not need to change; you add a **thin worker entry
point** that adapts to the runtime's execution model.

### Startup CPU budget

Edge runtimes enforce strict startup CPU limits (Cloudflare Workers: ~50 ms
CPU). Module-level code runs during startup. Generated Zod schemas
(`zod.gen.ts`) can be thousands of lines of eagerly-evaluated schema
constructors. Statically importing the library entry (e.g. `*-mcp.ts`)
transitively imports all tool modules → all SDK functions → all generated Zod
schemas, blowing the startup budget.

**Fix: deferred module loading.** The worker entry dynamically imports the
library entry inside the `fetch` handler:

```typescript
type McpModule = typeof import("./my-mcp.ts");
let mcpModule: Promise<McpModule> | null = null;

function loadMcp(): Promise<McpModule> {
  if (!mcpModule) {
    mcpModule = import("./my-mcp.ts").then((mod) => {
      mod.configureClient({ apiKey: "" });
      return mod;
    });
  }
  return mcpModule;
}
```

Bundlers (wrangler/esbuild) wrap deferred modules in lazy `__esm` initializers:
`Promise.resolve().then(() => (init_my_mcp(), my_mcp_exports))`. The heavy Zod
and tool evaluation runs on first request (which has a generous CPU budget), not
at startup.

**What stays at module level** (lightweight): credential interceptor
installation (`enableHttpHeaderCredentialBridge()` or equivalent), base URL
config for the HTTP client, and the import of the transport class
(`WebStandardStreamableHTTPServerTransport` — its import chain is minimal).

### Per-request server + transport

Two SDK constraints make this necessary on stateless edge runtimes:

1. **`Protocol.connect(transport)`** throws if the server is already connected
   to a transport. You cannot reuse a server across requests without calling
   `close()` first (race condition under concurrency).
2. **Stateless `WebStandardStreamableHTTPServerTransport`** (no
   `sessionIdGenerator`) throws if `handleRequest` is called a second time.

The correct pattern: create a **fresh `McpServer` + transport per request**.
Tool registration is pure in-memory computation (Zod schemas are already parsed
from the first dynamic import), so overhead is sub-millisecond.

```typescript
const { createMcpServer } = await loadMcp();
const server = createMcpServer();
const transport = new WebStandardStreamableHTTPServerTransport({
  sessionIdGenerator: undefined,
});
await server.connect(transport);
return transport.handleRequest(request);
```

### Environment variables and secrets

Edge runtimes pass secrets via the `env` parameter to the `fetch` handler, not
via `process.env`. If the library uses eager env validation (e.g. `envalid`),
ensure **all fields have defaults** so the validation pass doesn't crash at
import time under `nodejs_compat`.

For **multi-tenant** deployments, no secrets are needed on the worker itself —
each request carries its own credentials in headers (`X-Api-Key`,
`Authorization: Basic`, etc.), resolved per-request by the existing ALS +
interceptor infrastructure.

For **single-tenant** deployments, configure the client lazily on first request
using the worker's `env` binding:

```typescript
let configured = false;
// inside fetch():
if (!configured) {
  configureClient({ apiKey: env.API_KEY });
  configured = true;
}
```

### Compatibility flags

Cloudflare Workers requires `nodejs_compat` in `wrangler.toml` for:

- `node:crypto` (`randomUUID` used by session ID generators)
- `node:async_hooks` (`AsyncLocalStorage` used by multi-tenant credential flow)
- `process.env` (for eager env validation libraries with defaults)

### Global type conflicts

`@cloudflare/workers-types` and `@types/bun` (or `@types/node`) define
overlapping globals (`Request`, `Response`, etc.). Do not add both to the same
`tsconfig.json` `types` array. For projects that target multiple runtimes, use
separate tsconfig files or rely on the bundler's own type resolution.

### Worker entry as a thin adapter

The worker entry (`src/worker.ts` or equivalent) should be a **thin adapter**
between the edge runtime's `fetch` interface and the existing library. It does
not contain tool logic, schema definitions, or auth code — those live in the
shared library entry. The worker only:

1. Installs the credential interceptor (module level, once per isolate)
2. Lazily imports the library entry on first request
3. Creates a per-request server + transport
4. Wraps the transport handler with multi-tenant context (if applicable)
5. Returns the `Response`

---

## 7. End-to-end diagrams

**stdio + shared credentials:**

```
CLI → configure*Client → create*McpServer → register*Tools
  → connect(stdio) → tool invoke → sdkFn({ body }) → HTTP client (global auth)
```

**HTTP multi-tenant (long-lived process):**

```
HTTP Request → wrapMcpHttpHandleRequest
  → buildRequestContext(req) → run*HttpRequestContext(ctx)
  → transport.handleRequest → tool invoke → sdkFn({ body })
  → interceptor reads ALS + resolver → auth headers per tenant
```

**Edge worker (Cloudflare Workers / similar):**

```
fetch(request) [startup: interceptor only, no heavy imports]
  → loadMcp() [first request: dynamic import evaluates tools + Zod schemas]
  → createMcpServer() + new stateless transport [per request]
  → server.connect(transport)
  → wrapMcpHttpHandleRequest (multi-tenant ALS + 401 enforcement)
  → transport.handleRequest → tool invoke → sdkFn({ body })
  → interceptor reads ALS + resolver → auth headers per tenant
```

---

## 8. Adoption checklist (technical)

- Replicate **three layers**: generated client + domain atomic modules + public
  library orchestration (`*-mcp.ts` or equivalent).
- Keep **one shared HTTP client**; use interceptors for cross-cutting auth, not
  per-tool client construction.
- If JSON Schema from Zod fails, audit **BigInt**, **Date**, and **union**
  shapes — the atomic registrar may need sanitization like optional → number
  coercion.
- Document **when global auth applies** vs **strict tenant-only** to avoid
  accidental credential leakage between tenants.
- If targeting an edge runtime: worker entry uses **dynamic `import()`** for the
  library entry; module-level code is interceptor + base URL only.
- Edge worker creates **fresh `McpServer` + stateless transport per request**.
- Ensure `nodejs_compat` (or equivalent) is enabled for `node:crypto` and
  `node:async_hooks`.
