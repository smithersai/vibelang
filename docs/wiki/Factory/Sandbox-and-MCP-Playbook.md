---
title: Sandbox and Cloud MCP Playbook
tags: [factory, mcp, auth, sandboxes, agents]
---

# Sandbox and Cloud MCP Playbook

Coding agents (Claude Code, Codex, Antigravity, Cursor) interact with `smithersai/vibelang` through the authenticated Streamable HTTP MCP server at `https://smithers.sh/smithersai/vibelang/mcp`.

## OAuth 2.1 Discovery and One-Time-Use Bootstrap

```
  Sandbox Agent                     Smithers Cloud
       │                                   │
       ├── GET /.well-known/oauth-protected-resource
       │◄── authorization_servers + scopes ─┤
       │                                   │
       ├── mint-sandbox-auth.ts --mode pkce (S256, mode-600 file)
       │   (verifier never printed to stdout or argv)
       │                                   │
       ├── Maintainer approves single-use code (5 min TTL)
       │◄── Scoped Bearer Token (mcp:read / mcp:write)
       │                                   │
       └── Streamable HTTP MCP calls ──────► issues, PRs, TODOs, flows
```

### Bootstrap Commands

```sh
# 1. Verify live MCP discovery and tool catalog (anonymous read check)
bun .smithers/scripts/mint-sandbox-auth.ts --mode verify

# 2. Mint untrusted contributor sandbox bootstrap (strictly mcp:read)
bun .smithers/scripts/mint-sandbox-auth.ts \
  --mode pkce --trust untrusted \
  --out "$HOME/.config/vibelang-sandbox/pkce.json"

# 3. Mint trusted maintainer sandbox bootstrap (mcp:read + mcp:write)
bun .smithers/scripts/mint-sandbox-auth.ts \
  --mode pkce --trust trusted \
  --out "$HOME/.config/vibelang-sandbox/pkce.json"
```

## Tool Scope Boundaries

| Access Tier | Available Tools | Restrictions |
| --- | --- | --- |
| Public / Anonymous | `repo_tree`, `repo_read_file`, `docs_*`, `flows_list`, `issues_list`, `pulls_list` | No writes, no `todo_list` |
| Untrusted (`mcp:read`) | All read tools including `todo_list` | Read-only cache, no mutations |
| Trusted (`mcp:write`) | Draft TODOs, PR comments, issue drafts, flow triggers | Never merges PRs or writes secrets |
| Maintainer (Person) | Approve reviews, merge PRs, commit TODOs, rotate secrets | Human-in-the-loop gate |

## Credential Hygiene Rules

- `mint-sandbox-auth.ts` refuses to write secrets into group- or world-writable directories and enforces `0600` file permissions.
- Never pass tokens on `argv`, never echo tokens to logs, and never commit credential files to `jj`.

## Related Notes

- [[Agent-Workflow-Guide]]
- [[Trust-and-Cache-Model]]
- [[Smithers-Cloud-Setup]]
- [[Backpressure-and-Uphill]]
- [[Overview]]
