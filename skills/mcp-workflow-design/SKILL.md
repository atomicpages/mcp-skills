---
name: mcp-workflow-design
description: >-
  Design AI-native workflow tools for MCP servers by analyzing API surfaces,
  identifying common user flows, and composing multi-step operations into single
  outcome-oriented tools. Use when evolving a 1:1 API-wrapper MCP server into
  one with composite workflow tools, or when deciding which new tools to add to
  an existing MCP server.
---

# MCP Workflow Tool Design

Transform a raw API-wrapper MCP server into an AI-native tool surface by
analyzing the upstream API, identifying user intent patterns, and composing
multi-step operations into single outcome-oriented tools.

This skill complements the
[mcp-builder](https://skills.sh/anthropics/skills/mcp-builder) skill, which
covers building MCP servers from scratch. Use this skill when you already have a
working MCP server with atomic tools and need to add higher-level workflows.

For a worked example of this process applied to a real project, see
[reference/ashby-ats-example.md](reference/ashby-ats-example.md).

---

## Process

### Phase 1: API Surface Audit

**Goal**: Build a complete inventory of what exists and what's missing.

1. **Catalog current tools** -- list every registered MCP tool with its name,
   description, SDK function, and read/write annotation.
2. **Catalog full API** -- enumerate all SDK functions or API endpoints the
   upstream service exposes, grouped by domain.
3. **Identify the gap** -- diff the two lists. Highlight unexposed endpoints
   that are critical for common workflows (especially writes).

Output: a table of current tools, a table of all API endpoints, and the delta
list of unexposed-but-important operations.

### Phase 2: Research Native Automation

**Goal**: Understand what the upstream service already automates so you don't
duplicate it.

1. **Search vendor docs and product updates** -- look for AI features,
   automation rules, workflow engines, messaging sequences, conditional
   triggers.
2. **Search developer API docs** -- identify which endpoints are designed for
   human-initiated actions vs. system-triggered automation.
3. **Compile exclusion list** -- features you must NOT build tools for because
   the vendor handles them natively.

Common categories to check for exclusion:

- Automated email/messaging sequences
- AI-assisted screening, scoring, or classification
- Conditional state-transition activities
- Content generation (descriptions, templates)
- Notification/webhook-driven workflows
- Background sync or enrichment

### Phase 3: Identify User Flows

**Goal**: Determine the 5-10 most common intents a human user (via an AI agent)
would express when interacting with this service.

**Method**: Combine three signals:

1. **API topology** -- which endpoints are always called together? Look for
   create-then-link patterns (ex: `entity.create` + `relation.create`),
   read-then-act patterns (ex: `entity.info` + `entity.changeState`), and
   fan-out-and-aggregate patterns (ex: `parent.info` + N x `child.info`).

2. **Domain knowledge** -- what does a practitioner actually ask day-to-day?
   Common intent patterns that recur across domains:
   - "Tell me everything about X" (360 profile / deep-dive)
   - "How's Y going?" (pipeline / status dashboard)
   - "Move X forward" (state transition)
   - "Add X to Y" (intake / creation)
   - "What feedback exists for X?" (aggregation)
   - "What happened with X?" (timeline / audit trail)
   - "Give me a snapshot" (overview dashboard)

3. **Web research** -- search for the vendor's common use cases, community
   forums, and integration patterns. Vendor product update blogs are especially
   useful for understanding which workflows they prioritize.

### Phase 4: Design Composite Tools

**Goal**: Define the tool interface (name, description, input schema, output
shape) for each identified workflow.

Follow these AI-native design principles:

#### Principle 1: Outcome Over Operation

Each tool should map to a _user intent_, not an API endpoint.

- Bad: `svc_change_item_status` (forces the agent to know status UUIDs)
- Good: `svc_advance_item` (accepts status names, resolves IDs internally)

#### Principle 2: Minimize Hallucination Surface

- Accept human-readable inputs (names, titles, emails) and resolve to IDs
  internally. Never force the agent to fabricate UUIDs.
- Validate inputs against the actual data (e.g., check that a target state
  exists before attempting the transition).
- Return actionable errors with available options when validation fails (e.g.,
  `"Status 'Reviw' not found. Available: Draft, Review, Published"`).

#### Principle 3: Structured Response with Summary

Return JSON with two layers:

- `summary`: 1-2 sentence natural language summary the agent can relay directly
- Structured fields: full payload for follow-up questions or programmatic use

```json
{
  "summary": "Acme Corp -- 3 open projects, 12 active tasks, 2 overdue.",
  "projects": [ ... ],
  "tasks": [ ... ],
  "overdue": [ ... ]
}
```

#### Principle 4: Graceful Disambiguation

When a search input matches multiple records, return the matches with enough
context for the agent to ask the user to choose -- don't silently pick one.

```json
{
  "summary": "Found 3 items matching 'dashboard'. Specify an ID to continue.",
  "matches": [
    { "id": "...", "name": "Sales Dashboard", "status": "active" },
    { "id": "...", "name": "Ops Dashboard", "status": "draft" }
  ]
}
```

#### Principle 5: Parallel Fetch with Fault Tolerance

Use `Promise.allSettled` (or equivalent) for fan-out API calls so a single
sub-call failure doesn't abort the entire workflow. Return partial data with a
note about what failed.

#### Principle 6: Bounded Pagination

When a workflow aggregates paginated data (e.g., all child records for a
parent), set a hard upper bound on pages fetched (e.g., 5 pages). Include a
`truncated: true` flag in the response if the bound was hit.

### Phase 5: Implement

See [reference/architecture.md](reference/architecture.md) for the
implementation architecture: file structure, registration pattern, helper
utilities, and how composite tools coexist with atomic tools.

### Phase 6: Validate

1. **Lint and build** -- ensure no regressions.
2. **Smoke test** -- run each workflow tool with the MCP inspector or a
   connected agent and verify the response shape.
3. **Update documentation** -- README tool table, agent guides (CLAUDE.md /
   AGENTS.md) with the new workflow tool pattern.
