# mcp-skills

This repository exists to **publish Agent Skills** for people using AI coding
agents. It is not an application you run locally; it is a catalog of reusable
skill packages that agents can load to follow specialized workflows.

## Install from the directory

Browse and discover skills on
**[The Agent Skills Directory](https://skills.sh/)**. The same ecosystem lists
this repo and many others, with install counts and search.

## Install this repo’s skills

From a terminal, install every skill in this repository into your agent’s skills
location with [`skillsadd`](https://skills.sh/) (requires
[Node.js](https://nodejs.org/) / `npx`):

```bash
npx skills add atomicpages/mcp-skills
```

Your agent’s documentation will say where installed skills are read from (for
example Cursor, Codex, Claude Code, and others are represented on
[skills.sh](https://skills.sh/)).

## Skills in this repo

| Skill | What it covers | Path |
| ----- | ---------------- | ---- |
| **mcp-openapi-typescript-stack** | Portable TypeScript MCP over REST: `@hey-api/openapi-ts` (Ky client, Zod request validators), **dual transports** (stdio + streamable HTTP), optional **multi-tenant credentials** via AsyncLocalStorage, **library-first** package surface (optional CLI), and auth modeling (e.g. Basic from two-part secrets, Bearer/OAuth). Pairs with **mcp-builder** and **mcp-workflow-design**; does not duplicate them. | [`skills/mcp-openapi-typescript-stack/`](skills/mcp-openapi-typescript-stack/) |
| **mcp-workflow-design** | Evolve 1:1 API-wrapper MCP servers into **composite, outcome-oriented workflow tools**: audit API vs tools, research native vendor automation, identify user flows, implement workflows. Complements **mcp-builder** for greenfield servers. | [`skills/mcp-workflow-design/`](skills/mcp-workflow-design/) |

Add new skills under `skills/<skill-name>/` (each with a `SKILL.md` as required
by the Agent Skills format).

### Reference material (in-repo)

Long-form detail lives next to each skill:

- **mcp-openapi-typescript-stack**
  - [`references/openapi-ts.md`](skills/mcp-openapi-typescript-stack/references/openapi-ts.md) — CLI, plugins (`@hey-api/sdk` vs legacy `@hey-api/services`), migrations, Valibot notes.
  - [`references/structure-and-flows.md`](skills/mcp-openapi-typescript-stack/references/structure-and-flows.md) — package vs CLI surface, transports, credential/tenant flows, illustrative layout.
- **mcp-workflow-design**
  - [`references/architecture.md`](skills/mcp-workflow-design/references/architecture.md) — `workflows/` layout, helpers, registration patterns.
  - [`references/ashby-ats-example.md`](skills/mcp-workflow-design/references/ashby-ats-example.md) — worked example of the workflow-design process.

## Evaluations

Each skill includes an `evals/evals.json` file with assertions tested via [agent-skills-eval](https://github.com/darkrishabh/agent-skills-eval) — the same prompt runs **with** and **without** the skill loaded, and a judge model grades both to measure **skill lift**.

### Run locally

```bash
npm install

# Lint (no API key needed)
npm run lint

# Run all evals (requires OpenAI-compatible API key)
export OPENAI_API_KEY=sk-...
npm run eval

# Run a single skill's evals
npm run eval:openapi
npm run eval:workflow
```

Reports land in `eval-reports/` (gitignored). Open `iteration-1/report/index.html` for the visual report.

### Configuration

See [`agent-skills-eval.yaml`](agent-skills-eval.yaml) for full config. Override target/judge models via CLI:

```bash
npx agent-skills-eval ./skills --target gpt-4o --judge gpt-4o --baseline --strict --report
```

### CI

GitHub Actions runs lint on every PR and evals weekly (or on-demand via the `run-evals` label). See [`.github/workflows/skills.yml`](.github/workflows/skills.yml).

### Eval coverage

| Skill | Evals | Focus |
|-------|-------|-------|
| mcp-openapi-typescript-stack | 9 | Ky over axios, plugin chain order, interceptor pitfall, edge runtime deferred imports, library-first exports, auth modeling, discovery questions, debug logging, dual transport |
| mcp-workflow-design | 9 | API audit gap table, vendor automation exclusion, intent-based naming, response shape, disambiguation, fault tolerance, bounded pagination, full 6-phase process, user flow identification |

### Case studies

These skills were benchmarked end-to-end building MCP servers for [Gong](https://www.gong.io/) and [Ashby](https://www.ashbyhq.com/):

> I want to build a MCP server around gong. While they have an official MCP server, I find it lacking in many respects. Please review their API documentation and plan the creation of a new MCP server using relevant skills to perform this task.

| Agent | Model | Result |
|-------|-------|--------|
| Claude Code | Opus 4.6 high | Excellent — one-shot |
| Claude Code | Sonnet 4.5 medium | Very good |
| OpenCode | Opus 4.6 | Excellent — one-shot |
| OpenCode | Sonnet 4.5 | Good, required iteration |

Formal eval IDs covering equivalent scenarios: `stack-rejects-axios`, `codegen-plugin-chain`, `discovery-questions`, `full-process-six-phases`.
