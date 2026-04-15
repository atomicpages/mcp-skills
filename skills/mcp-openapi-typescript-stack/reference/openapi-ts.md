# @hey-api/openapi-ts reference

Succinct reference for codegen used by the **MCP + OpenAPI + Ky** stack. For
full option matrices and migrations, use the official docs (links below).

---

## HTTP client: Ky only

- Generated clients for this stack use the **`@hey-api/client-ky`** plugin
  (wraps [ky](https://github.com/sindresorhus/ky)).
- **Do not use axios** for new code or codegen in this pattern: **strongly** prefer **ky** for
  the shared client, interceptors, and small API surface. If examples online use
  `@hey-api/client-axios`, swap to **`@hey-api/client-ky`** for parity with MCP
  servers that rely on `Request`/`Response` and Ky hooks.
- If there is prior art that uses axios, ask teh user if they want to move to `ky` since it uses `fetch`
- If the user wants to continue to use axios, they **MUST NOT BE** on the following versions of `axios`: `1.14.1` or `0.30.4`. These versions are compromised and are a critical security vulnerability.

---

## What the tool is

**Package:** `@hey-api/openapi-ts`
**Role:** CLI + `defineConfig()` — turn OpenAPI 3.x into TypeScript types, an
HTTP client instance, SDK functions, and optional **Zod** (or Valibot) request
validators.

**Official sources (prefer these when behavior differs from this file):**

- Repo & docs: [github.com/hey-api/openapi-ts](https://github.com/hey-api/openapi-ts)
- Site: [heyapi.dev](https://heyapi.dev)

---

## CLI

From the project root (where `openapi-ts.config.ts` lives):

```bash
npx @hey-api/openapi-ts
```

With Bun:

```bash
bunx openapi-ts
```

One-off without a config file (paths vary):

```bash
npx @hey-api/openapi-ts -i ./openapi.json -o ./src/generated
```

Regenerate whenever the OpenAPI spec changes; then fix any tool/schema drift in
hand-written MCP layers.

---

## Config file

Use **`openapi-ts.config.ts`** (or `.mts`) with **`defineConfig`** from
`@hey-api/openapi-ts`:

```typescript
import { defineConfig } from "@hey-api/openapi-ts";

export default defineConfig({
  input: "./openapi.json", // path, URL, or supported registry id
  output: {
    path: "./src/generated",
    clean: true, // wipe output dir before write (typical)
  },
  plugins: [
    // Order matters: client and types before SDK; validators align with @hey-api/sdk
    { name: "@hey-api/client-ky", baseUrl: "https://api.example.com" },
    "@hey-api/schemas",
    { name: "@hey-api/transformers", dates: true, bigInt: false },
    { name: "@hey-api/typescript", enums: "javascript", comments: true },
    {
      name: "@hey-api/sdk",
      transformer: true,
      comments: true,
      validator: { request: "zod" }, // MCP stack: Zod for request shapes
    },
  ],
  logs: { level: "info", file: false },
});
```

Adjust **`baseUrl`** per API; use env at runtime via `client.setConfig()` rather
than hardcoding secrets in the spec.

---

## Plugins (MCP-oriented cheat sheet)

| Plugin | Purpose |
| ------ | ------- |
| `@hey-api/client-ky` | Shared **`client`** (Ky) in `client.gen.ts`; `setConfig`, `interceptors.request` / `response`. |
| `@hey-api/schemas` | JSON Schema artifacts (optional helpers; many MCP repos include it). |
| `@hey-api/transformers` | Runtime transforms (e.g. **dates**, **BigInt** handling — tune for JSON/MCP). |
| `@hey-api/typescript` | Types, enums, comments. |
| `@hey-api/sdk` | **`sdk.gen.ts`**: one function per operation; calls into `client`. |

**Validators:** On `@hey-api/sdk`, set `validator: { request: "zod" }` (and
optionally `response: "zod"`) so generated code carries **Zod** parsing. That
produces request schemas (commonly consumed from **`zod.gen.ts`**) aligned with
SDK function arguments. If codegen errors mention missing validator support,
check the installed `@hey-api/openapi-ts` version and the [SDK plugin
docs](https://github.com/hey-api/openapi-ts/blob/main/docs/openapi-ts/plugins/sdk.md).

**Legacy name:** Older versions used `@hey-api/services` and **`services.gen.ts`**
— current name is **`@hey-api/sdk`** and **`sdk.gen.ts`**. Update imports if you
see old tutorials.

**Default stack in upstream docs** is often `@hey-api/client-fetch`; for **this**
skill, replace with **`@hey-api/client-ky`**.

---

## Generated files (typical)

Exact names can be customized via `output`; defaults often use **`.gen.ts`**
suffixes:

| File | Contents |
| ---- | -------- |
| `client.gen.ts` | `client`, `createClient`, Ky config types. |
| `sdk.gen.ts` | Operation functions (`getThing`, `createThing`, …). |
| `types.gen.ts` | Models / enums. |
| `zod.gen.ts` | Zod schemas for requests (and responses if enabled). |

**Rule:** treat **`src/generated/**` as build output** — fix the OpenAPI spec and
regenerate; do not hand-edit generated files for feature work.

---

## Runtime usage (hand-written code)

```typescript
import { client } from "./generated/client.gen.ts";
import { someOperation } from "./generated/sdk.gen.ts";

client.setConfig({
  baseUrl: "https://api.example.com",
  headers: { Authorization: "Bearer …" },
  throwOnError: true,
});

client.interceptors.request.use(async (request, options) => {
  // IMPORTANT: modify options.headers, not just the Request — see pitfall below
  const optsHeaders = options?.headers as Headers | undefined;
  optsHeaders?.set("Authorization", "Bearer per-request-token");
  return request;
});

await someOperation({ body: { … } });
```

SDK calls usually take an object with **`body`**, **`path`**, **`query`**, and
optionally **`client`** to override the instance.

### PITFALL: interceptor must modify `options.headers`, not just the `Request`

The generated `@hey-api/client-ky` request pipeline works like this:

1. `beforeRequest()` builds `opts` (merging config headers, calling
   `setAuthParams` to set `Authorization` from `setConfig`)
2. Creates `kyOptions = { headers: opts.headers, … }` (same `Headers` reference)
3. Creates a `new Request(url, { headers: kyOptions.headers })`
4. Runs `client.interceptors.request` — your interceptor receives `(request,
   opts)`
5. Calls `kyInstance(request, kyOptions)` — **Ky merges `kyOptions.headers` ON
   TOP of the Request headers**

If your interceptor only modifies the `Request` object (e.g. creates `new
Request(request, { headers: newHeaders })`), **Ky overwrites those headers** at
step 5 with the stale `kyOptions.headers` from step 2. This means per-request
auth set via the `Request` is silently replaced by the global config auth.

**Correct pattern:** modify `options.headers` directly (it is the same mutable
`Headers` reference that feeds `kyOptions`):

```typescript
client.interceptors.request.use(async (request, options) => {
  const optsHeaders = options?.headers as Headers | undefined;
  optsHeaders?.set("Authorization", `Basic ${btoa(`${apiKey}:`)}`);
  return request; // return original request — Ky applies optsHeaders on top
});
```

To **strip** auth (e.g. strict multi-tenant mode, no credentials resolved):

```typescript
optsHeaders?.delete("Authorization");
return request;
```

This applies to **all** header mutations in interceptors, not just
`Authorization`. Any header set only on the `Request` object will be overwritten
by the corresponding value from `options.headers` / `kyOptions.headers`.

---

## MCP integration reminder

- **Atomic tools:** import **`zSomeOperationData`** from `zod.gen.ts` and
  **`someOperation`** from `sdk.gen.ts`; a registrar projects **`body`** (or
  path/query) into MCP `inputSchema` and calls `sdkFn({ body: params })`.
- **Workflows:** hand-written Zod; call the same `sdk.gen` functions directly.

---

## When agents get stuck

1. Confirm **Node/Bun** runs the same **`openapi-ts`** version as in
   `package.json` / lockfile.
2. Open **`input`** spec in a validator; fix OpenAPI, not generated TS.
3. Check **plugin order** matches a known-good template (client → types → sdk).
4. Search the repo docs for **migrating** and **breaking** if upgrading
   `@hey-api/openapi-ts` across major versions.
5. Prefer **Context7** or official **hey-api** docs over random blog posts —
   option shapes change between releases.
