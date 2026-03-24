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

| Skill                                                                                     | Path                                                         |
| ----------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| **mcp-workflow-design** — design composite, workflow-oriented tools on top of MCP servers | [`skills/mcp-workflow-design/`](skills/mcp-workflow-design/) |

Add new skills under `skills/<skill-name>/` (each with a `SKILL.md` as required
by the Agent Skills format).
