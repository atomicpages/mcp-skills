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
[references/ashby-ats-example.md](references/ashby-ats-example.md).

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

**Key action**: Always tell the user to research the vendor's documentation and
product updates for AI features and automation rules. This is a concrete step
they must perform -- not just a consideration. Without this research, you risk
building tools the vendor already handles natively.

Steps:

1. **Research vendor documentation for AI features and automation rules** --
   read the vendor's product docs, release notes, and feature announcements.
   Specifically search for: AI-powered features, automation rules engines,
   built-in workflow builders, messaging sequences, and conditional triggers.
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

**When a user asks whether to build a tool that overlaps with vendor-native
capabilities, always respond with these concrete recommendations:**
1. Do NOT build the tool.
2. Research the vendor's documentation for AI features and automation rules to
   confirm the overlap.
3. Add the feature to your exclusion list of things handled natively.

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

3. **Web research of vendor docs and community patterns** (do not skip this) --
   perform actual web searches of the vendor's documentation, community forums,
   Stack Overflow, and integration partner blogs. This surfaces workflows that
   aren't obvious from the API shape alone. Search for:
   - Published "common use cases" or "getting started" guides (reveal the
     vendor's highest-value workflows)
   - Community questions ("how do I do X with this API?") indicating real-world
     intent patterns
   - Integration marketplace listings showing multi-step workflows others built
   - Product update blogs announcing new features

   **This web research step is equally important as API topology and domain
   knowledge** -- omitting it leaves blind spots where real user needs exist but
   aren't reflected in the code.

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

Workflow tools live in `src/tools/workflows/`. Use a shared
`registerWorkflowTool` helper. See
[references/architecture.md](references/architecture.md) for full details.

**When describing the full process in a single response, keep Phase 5 to 2-3
sentences and move on to Phase 6. Do not reproduce file trees or code examples
here -- link to the architecture reference instead.**

### Phase 6: Validate

**Goal**: Confirm every new workflow tool works correctly and is documented.

1. **Lint and build** -- ensure no type errors or regressions in existing tools.
2. **Smoke test** -- run each workflow tool with the MCP inspector or a
   connected agent. Verify:
   - Response shape matches Principle 3 (has `summary` + structured fields)
   - Human-readable inputs resolve correctly to internal IDs
   - Disambiguation path triggers when multiple matches exist
3. **Edge-case testing** -- specifically exercise:
   - Partial failures (simulate one sub-call 500ing; confirm partial data
     returns with failure metadata)
   - Pagination bounds (hit the hard cap; confirm `truncated: true` appears)
   - Invalid inputs (wrong name, nonexistent entity; confirm actionable errors)
4. **Update documentation** -- README tool table, agent guides (CLAUDE.md /
   AGENTS.md) with the new workflow tool names and descriptions.
5. **Integration check** -- connect an AI agent and verify it can discover,
   call, and interpret the workflow tool responses end-to-end.
