# Smithers Cloud MCP Agent Contract (`smithersai/vibelang`)

All coding agents (Claude Code, Codex, Antigravity, Cursor) connect to VibeLang through the authenticated Smithers Cloud MCP server:

- **MCP Endpoint**: `https://smithers.sh/smithersai/vibelang/mcp`
- **OAuth Discovery (RFC 9728)**: `https://smithers.sh/.well-known/oauth-protected-resource/smithersai/vibelang/mcp`
- **Live Factory UI**: `https://smithers.sh/smithersai/vibelang/-/factory`
- **Obsidian Wiki & Mythical History**: `https://smithers.sh/smithersai/vibelang/-/wiki`
- **Shared Build Object Store**: `https://build.smithers.sh`

## One-Time-Use Sandbox Bootstrap

Mint a single-use PKCE S256 or Attach-to-Conversation pairing credential before starting an isolated agent sandbox:

```sh
# Untrusted contributor sandbox (mcp:read only, mode-600 verifier file)
bun .smithers/scripts/mint-sandbox-auth.ts --mode pkce --trust untrusted --out "$HOME/.config/vibelang-sandbox/pkce.json"

# Trusted maintainer sandbox (mcp:read + mcp:write, 5-minute single-use code)
bun .smithers/scripts/mint-sandbox-auth.ts --mode pkce --trust trusted --out "$HOME/.config/vibelang-sandbox/pkce.json"

# Verify live MCP discovery and tool catalog
bun .smithers/scripts/mint-sandbox-auth.ts --mode verify
```

Never pass raw tokens on `argv`, never print tokens to logs, and never commit credential files.

## Core Rules for Agents

1. Interact with issues, PRs, TODOs, docs, and flows through Smithers Cloud MCP (`issues_list`, `issue_get`, `pulls_list`, `pull_files`, `todo_list`, `todo_draft`, `flows_list`, `flow_get`, `docs_list`, `docs_read`). Note that `todo_list` and all write tools require an authenticated OAuth 2.1 `mcp:read` / `mcp:write` token minted via `mint-sandbox-auth.ts`.
2. Read `packages/compiler/skills/vibelang/SKILL.md` and `.agents/uphill/rules.md` before editing `.vibe` or Go compiler files.
3. Work in an isolated `jj workspace` based on `vibe`; never run `jj` mutations in a shared checkout and never invoke `git` directly.
4. Run affected `smthrs ci` targets and `bun scripts/audit/run-audit.ts` before proposing a change.
5. Respect person-only boundaries: agents never merge PRs, approve reviews, commit TODOs, or write secrets.
