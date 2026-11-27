---
title: Cloud MCP Agent Workflow Guide
tags: [mcp, agents, byoa, sandbox-auth, jj, workflows]
---

# Cloud MCP Agent Workflow Guide

VibeLang operates on a **Bring Your Own Agent (BYOA)** model over Smithers Cloud's authenticated Streamable HTTP MCP server at `https://smithers.sh/smithersai/vibelang/mcp`.

## Connecting Any Coding Agent

Discovery metadata follows RFC 9728 and RFC 8414:

- Protected resource metadata: `https://smithers.sh/.well-known/oauth-protected-resource/smithersai/vibelang/mcp`
- OAuth 2.1 + PKCE S256 consent: `https://smithers.sh/app/mcp/authorize`
- Repository-scoped MCP endpoint: `https://smithers.sh/smithersai/vibelang/mcp`

Every write is attributed as `<login> (agent)` and checked against the person's live role on `smithersai/vibelang`.

## One-Time-Use Sandbox Authentication

When launching an isolated sandbox or coding agent, mint a short-lived, single-use pairing or PKCE credential via `.smithers/scripts/mint-sandbox-auth.ts`:

```sh
# Print a one-time-use OAuth 2.1 PKCE S256 bootstrap or Attach-to-Conversation pairing command
bun .smithers/scripts/mint-sandbox-auth.ts --repo smithersai/vibelang --mode pkce
bun .smithers/scripts/mint-sandbox-auth.ts --repo smithersai/vibelang --mode attach --branch vibe
```

Security invariants for sandbox credentials:

- Authorization codes expire in **5 minutes** and burn atomically on first use (replay revokes the grant).
- Raw tokens are written only to mode-600 files or passed via stdin, never placed on `argv` or printed into CI logs.
- Every delegated MCP actor carries `act: { kind: "agent" }`, so **person-only acts** (merging PRs, approving releases, committing TODOs, modifying secrets, overriding triage) are refused server-side with `403 person_only`.

## Available Smithers MCP Tools

| Category | MCP Tools |
| --- | --- |
| Repository reads | `repo_refs`, `repo_tree`, `repo_read_file` |
| Documentation | `docs_list`, `docs_read` |
| Factory flows | `flows_list`, `flow_get` |
| Issues and PRs | `issues_list`, `issue_get`, `pulls_list`, `pull_get`, `pull_files` |
| Authenticated writes | `issue_create`, `issue_comment`, `todo_list`, `todo_draft`, `work_link_add` |

## Agent Development Loop with `jj`

1. Read `packages/compiler/skills/vibelang/SKILL.md` and `.agents/uphill/rules.md`.
2. Query `issues_list` / `todo_list` via Smithers MCP and fetch the right repo flow (`issue/repro`, `issue/poc`, `checks/review`, `pr-triage`) via `flow_get`.
3. Work on an isolated `jj workspace` based on `vibe` (never run `jj` directly in a shared checkout, and never invoke `git` CLI).
4. Write a failing test first, run affected `smthrs ci` targets and `uphill --compare HEAD --compact`, and render the Lighthouse audit report.
5. Push your stacked changeset or draft PR for maintainer review. Agents never approve or merge.

## Related Notes

- [[Smithers-Cloud-Setup]]
- [[Backpressure-and-Uphill]]
- [[Release-and-Security]]
- [[Overview]]
