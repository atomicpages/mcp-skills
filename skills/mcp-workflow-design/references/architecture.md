# Workflow Tool Implementation Architecture

## File Structure

Composite workflow tools live alongside atomic tools in a `workflows/`
subdirectory:

```
src/tools/
  <domain-a>.ts          # atomic tools (registerTool helper)
  <domain-b>.ts          # atomic tools
  ...
  register.ts            # shared atomic tool registration helper
  workflows/
    helpers.ts           # shared workflow utilities
    index.ts             # barrel: registerWorkflowTools(server)
    entity-360.ts        # one file per workflow tool
    pipeline-overview.ts
    advance-entity.ts
    submit-entity.ts
    ...
```

## Helpers Module (`workflows/helpers.ts`)

Provides utilities that every composite tool needs. Adapt the naming to match
your project's service prefix (e.g., `callAshby`, `callGithub`, `callStripe`).

### `callService(sdkFn, body)` -- Single SDK Call

Calls an SDK function with `{ body }` params, unwraps the response (which may be
wrapped in `{ data, request, response }` depending on client config), and throws
a typed error on API-level failures.

```typescript
const data = await callService<{ success: boolean; results: T }>(entityInfo, {
  id: entityId,
});
```

### `callServiceAll(...promises)` -- Parallel Fault-Tolerant Fetch

Wraps `Promise.allSettled` and returns an array where failed calls become
`undefined` instead of throwing. Essential for fan-out patterns where one
sub-call failing shouldn't abort the workflow.

```typescript
const [notes, related, ...detailResults] = await callServiceAll(
  callService(listNotes, { entityId }),
  callService(listRelated, {}),
  ...ids.map((id) => callService(getDetail, { id })),
);
// Each element is either the resolved data or undefined
```

### `registerWorkflowTool(server, config)` -- Registration

Registers a composite tool with standard annotations and a try/catch wrapper
that formats errors consistently. Equivalent to the atomic `registerTool` helper
but accepts a hand-crafted Zod input schema and a custom handler.

```typescript
registerWorkflowTool(server, {
  name: "svc_entity_360",
  title: "Entity 360 Profile",
  description: "Get a complete profile for an entity...",
  inputSchema: {
    entityId: z.string().optional().describe("Entity UUID"),
    email: z.string().optional().describe("Email to search"),
    name: z.string().optional().describe("Name to search"),
  },
  readOnly: true, // defaults to true
  handler: async (params) => {
    // orchestration logic
    return workflowResponse({ summary: "...", ...data });
  },
});
```

### `workflowResponse(data)` / `workflowError(message)` -- Response Builders

Standard MCP response formatters:

- `workflowResponse` serializes data as JSON text content
- `workflowError` returns `isError: true` with a text message

### `handleWorkflowError(error)` -- Error Handler

Catches service-specific API errors and common HTTP errors (401, 403, 429) and
returns a formatted MCP error response. Used as the catch-all in
`registerWorkflowTool`.

## Registration Wiring

The `workflows/index.ts` barrel exports `registerWorkflowTools(server)` which
calls each workflow's register function. This is called from the main tool
registration function alongside the atomic tool registrations:

```typescript
export function registerAllTools(server) {
  registerDomainATools(server); // atomic
  registerDomainBTools(server); // atomic
  // ...
  registerWorkflowTools(server); // composite workflows
}
```

## Atomic vs. Composite: When to Use Which

| Characteristic | Atomic Tool                          | Composite Workflow Tool                     |
| -------------- | ------------------------------------ | ------------------------------------------- |
| API calls      | 1                                    | 2-10+                                       |
| Input schema   | Generated from OpenAPI / Zod schemas | Hand-crafted Zod with human-readable fields |
| Registration   | Shared atomic helper                 | Workflow helper with custom handler         |
| ID resolution  | Caller must provide exact IDs        | Resolves names/emails to IDs internally     |
| Error handling | Single API error                     | Partial success possible, structured errors |
| Response       | Raw API response JSON                | Structured with `summary` field             |
| Use case       | Edge cases, granular control         | Common user intents                         |

## Composite Tool Patterns

### Resolve-Then-Act (write workflows)

For state transitions and creation flows:

1. Accept human-readable input (name, title, email)
2. Search/resolve to internal IDs
3. Validate the resolved entity exists and is valid for the operation
4. Perform the mutation
5. Return confirmation with before/after state

### Fan-Out-And-Aggregate (read workflows)

For 360 profiles and dashboards:

1. Resolve the root entity
2. Fan out to N related endpoints in parallel via `callServiceAll`
3. Merge results into a single structured response
4. Build a natural-language summary

### Search-With-Disambiguation

For any tool that accepts search terms instead of IDs:

1. Search by the provided term
2. If exactly 1 match: proceed with the workflow
3. If 0 matches: return an error with suggestions
4. If 2+ matches: return the matches with enough context for the user to choose,
   and a `summary` explaining the ambiguity
