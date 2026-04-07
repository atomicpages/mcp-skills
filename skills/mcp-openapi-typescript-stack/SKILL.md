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
  validators, Ky client).
---

# MCP + OpenAPI TypeScript stack (library-first)

This skill describes a **reusable architecture pattern**: a single package that
can be an **npm library**, a **CLI MCP process**, and a thin **MCP tool layer**
over a **generated HTTP client**. Reference implementations may use different
file and function names; the **roles** stay the same.

Use it **together with**:

- [mcp-builder](../mcp-builder/SKILL.md) — protocol framing, tool design, MCP
  SDK usage, evaluation.
- [mcp-workflow-design](../mcp-workflow-design/SKILL.md) — composite workflow
  tools on top of atomic 1:1 API tools.

**Do not duplicate those skills here.** This document answers: *how is the code
organized, why, and what to decide before adopting the pattern on a greenfield or
existing MCP server.*

---

## HTTP client: use Ky, not axios

For the generated REST client and any hand-written fetch layer in this pattern,
use **[ky](https://github.com/sindresorhus/ky)** via **`@hey-api/client-ky`**.
**Do not use axios** — avoid `@hey-api/client-axios`, axios interceptors, or
axios examples when implementing or regenerating clients for MCP servers in this
stack. Ky fits `Request`/`Response`, keeps a small surface, and matches the
interceptor style used for per-request / multi-tenant auth.

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
matters; the legacy plugin name **`@hey-api/services`** is now **`@hey-api/sdk`**
(output **`sdk.gen.ts`**, not `services.gen.ts`).

**Authoritative detail** (CLI flags, all plugins, migrations, Valibot): see
[reference/openapi-ts.md](reference/openapi-ts.md) and the upstream
[hey-api/openapi-ts](https://github.com/hey-api/openapi-ts) docs.

---

## Discovery questions (ask before planning or implementing)

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

3. **Distribution shape**
   - **CLI-only** binary (users run a command)?
   - **Library-only** (embed `create*McpServer` in another app)?
   - **Both** (recommended: `package.json` `exports` + `bin`)?

4. **API surface**
   - Is there a **machine-readable OpenAPI** spec (or can you maintain one)?
   - If not, you can still use the **same folder ideas** (hand-written client +
     Zod), but you lose **one spec as source of truth** for request shapes.

5. **Workflow vs atomic tools**
   - Start **1:1 with endpoints** (mcp-builder bias), then add **workflows**
     (mcp-workflow-design). A common split: **atomic** tools under
     `src/tools/<domain>.ts` (or similar) and **composite** tools under
     `src/tools/workflows/`.

6. **Upstream authentication schemes**
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

Operators may create this once in a shell or your CLI reads **two** env vars
and builds the header at startup. Do not confuse this with “username only”
Basic (some APIs use empty password).

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
resolver returns (see table below). Avoid branching every tool; keep auth in
client config + interceptor.

### Worked example: Gong Public API (illustrative)

[Gong](https://www.gong.io/) documents two credential paths (check current
vendor docs for details):

- **Manual / key pair:** Technical admin creates an **Access Key** and **Access
  Key Secret** in the Gong API page. Call the Public API with Basic auth using
  the Base64 of `accessKey:accessKeySecret` as above.
- **OAuth:** Follow the vendor OAuth guide to obtain a Bearer access token; call
  the API with `Authorization: Bearer <token>`.

For an MCP server in *this* stack: **same** generated client and tools; choose
per deployment whether `configure*Client` (or the per-request resolver) sets
**Basic from two env vars** or **Bearer from one env / forwarded header**. If you
support **both** at runtime, define precedence (e.g. Bearer in context overrides
global Basic) and document it.

### Mapping schemes to single-tenant vs multi-tenant HTTP

| Upstream expectation | Single-tenant (shared client) | Multi-tenant HTTP (ALS + resolver) |
| -------------------- | ----------------------------- | ---------------------------------- |
| Basic from key + secret | Set default `Authorization` when creating the Ky client, or set headers in `configure*Client`. | `buildRequestContext` copies two headers or one custom header pair; resolver returns `{ authorization: "Basic …" }` after combining, or you store a precomputed Basic string per tenant. |
| Bearer only | `Authorization: Bearer ${TOKEN}` from env. | Forward inbound `Authorization` if trusted, or resolver loads Bearer per tenant from DB/KMS. |
| Operator passes full header | Single env `UPSTREAM_AUTHORIZATION` (discourage for production; rotation pain). | Prefer forwarding `Authorization` from MCP HTTP request to upstream (still only over TLS). |

A resolver that can return **`{ authorization: string }`** (full header value)
is the most portable escape hatch when the vendor adds a third scheme later.

### OAuth and refresh

- **stdio / local MCP:** Users often paste or inject a long-lived token, or you
  document a small companion script that refreshes and writes env — keep refresh
  logic out of hot tool paths when possible.
- **Hosted HTTP MCP:** Gateway validates the user, attaches Bearer, or injects
  tenant id so the resolver fetches the current access token server-side.
- **Document** whether your package implements OAuth endpoints or expects tokens
  **already issued**.

### Security notes

- Do not log `Authorization` headers or raw secrets.
- Use **TLS** for streamable HTTP MCP; treat header-based credentials as
  sensitive on the wire.
- In multi-tenant mode, ensure ALS scope is **per MCP HTTP request** so tenants
  cannot bleed credentials across concurrent requests.

For interceptor placement and context flow, see
[reference/structure-and-flows.md](reference/structure-and-flows.md).

---

## What this stack optimizes for

| Property | Pattern (rename symbols per project) |
| -------- | ------------------------------------ |
| **Dual transport** | `start*McpTransport({ mode: "stdio" \| "http" })` plus a `connect*McpHttpTransport()` (or equivalent) that returns `handleRequest` for any Web `Request`/`Response` host. |
| **Multi-tenant (optional)** | `credentialMode: "shared" \| "multi-tenant"` (or flags with the same meaning); AsyncLocalStorage + HTTP client interceptor + optional `buildRequestContext` / `setCredentialResolver`. |
| **Library-first** | `configure*Client`, `register*Tools`, `create*McpServer`, and HTTP helpers exported from the **library entry**; CLI is a thin argv/env wrapper. |
| **Generated REST SDK** | Codegen (e.g. `@hey-api/openapi-ts`) → `src/generated/` (`client.gen.ts`, `sdk.gen.ts`, …). **Never hand-edit generated files.** |
| **Zod for MCP inputs** | Atomic tools: generated `z*Data` (or equivalent); a **registrar** extracts the request `body` shape for MCP `inputSchema`. Workflow tools: hand-written Zod. |

---

## Repository map (roles, not fixed names)

| Role | Typical location (adjust to your repo) |
| ---- | ---------------------------------------- |
| **Library public API** | e.g. `src/<service>-mcp.ts` — client config, `register*Tools`, server factory, stdio/HTTP wiring, optional re-exports for HTTP/credential helpers. |
| **Per-request HTTP context** | e.g. `src/request-context.ts` — ALS, credential resolver, header/token bridge, wrapper around the transport’s `handleRequest`. |
| **CLI / dev entry** | `src/cli.ts`, `src/index.ts` — parse flags and env, configure client, create server, start transport. |
| **Atomic tool registrar** | e.g. `src/tools/register.ts` — `registerAtomicTool`: Zod → MCP `inputSchema`, map params → SDK call shape, map errors → MCP text. |
| **Domain atomic modules** | e.g. `src/tools/<domain>.ts` — import `sdkFn` + generated schemas, call the atomic registrar. |
| **Workflow module** | e.g. `src/tools/workflows/` — `registerWorkflowTool` + shared `callSdk` / `callSdkAll`-style helpers. |
| **Generated output** | e.g. `src/generated/` — Ky client, SDK functions, Zod (from OpenAPI or your generator). |
| **Codegen config** | e.g. `openapi-ts.config.ts` — see [reference/openapi-ts.md](reference/openapi-ts.md). |
| **Package surface** | `package.json` — `exports` → library bundle; `bin` → CLI when you ship one. |

For ALS/credential flows, BigInt vs JSON Schema, and end-to-end diagrams, see
[reference/structure-and-flows.md](reference/structure-and-flows.md). For
`@hey-api/openapi-ts` plugins, CLI, and generated filenames, see
[reference/openapi-ts.md](reference/openapi-ts.md).

---

## How the pieces connect

**Atomic tool path:** MCP tool params → Zod-validated object → SDK call (often
`sdkFn({ body: params })` for POST-heavy APIs) → HTTP client → upstream API.
When generated schemas describe `{ body, path, query }`, the registrar
**projects** the part agents should fill (often `body`) into the MCP
`inputSchema`.

**Workflow tool path:** Hand-crafted `inputSchema` → handler calls multiple SDK
functions via a small helper (unwrap response, normalize errors) → aggregate →
JSON (or structured) MCP content.

**HTTP multi-tenant path:** Incoming `Request` → `buildRequestContext(req)` →
ALS wraps `handleRequest` → on each outbound HTTP request, an interceptor reads
ALS + `credentialResolver` → sets or strips auth headers. Empty context +
`requireTenantCredentials` → **401 before MCP** (fail closed).

---

## Workflow with companion skills

1. **mcp-builder** — Pick TypeScript + MCP SDK, define transport needs, tool
   naming, annotations (`readOnlyHint`, etc.), error message style.
2. **This skill** — Split `exports` vs `bin`, wire stdio vs HTTP, decide
   single- vs multi-tenant, wire OpenAPI codegen and atomic/workflow registrars.
3. **mcp-workflow-design** — Audit SDK vs tools, add workflows, return
   `summary` + structured `data` where useful.

---

## Checklist when adopting the pattern

- [ ] OpenAPI (or equivalent) drives generated client/schemas; regen is a
      documented command (`bunx openapi-ts` / `npx @hey-api/openapi-ts`).
- [ ] Codegen uses **`@hey-api/client-ky`** (not axios / not `@hey-api/client-axios`).
- [ ] One atomic registrar maps **generated Zod (or types) for the tool-facing
      slice** → MCP tools.
- [ ] Mutating tools set `readOnly: false` (or equivalent MCP annotations).
- [ ] Workflows use a **separate** registrar with hand-written Zod (or validated
      input objects).
- [ ] Library entry exports server factory + transport helpers; CLI only
      parses argv/env when you ship a binary.
- [ ] Multi-tenant mode documented (headers, TLS, resolver hooks, 401
      behavior).
- [ ] Supported auth modes documented (Basic two-part, Bearer, forwarded
      `Authorization`, OAuth expectations) and mapped to env / HTTP / resolver.
