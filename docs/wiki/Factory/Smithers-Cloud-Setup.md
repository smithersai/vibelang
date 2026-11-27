---
title: Smithers Cloud Public Factory Setup
tags: [factory, smithers-cloud, home, audiences, feeds]
---

# Smithers Cloud Public Factory Setup

`smithersai/vibelang` runs publicly on Smithers Cloud at `https://smithers.sh/smithersai/vibelang`, mirroring bidirectionally with GitHub (`https://github.com/smithersai/vibelang`).

## Declarative Configuration

Every public surface of the repository is declared in code inside `.smithers/` and drift-checked in CI:

| File | Purpose | Drift Gate |
| --- | --- | --- |
| `.smithers/WORKSPACE.ts` | Declares Node/Go/Bun/pnpm/jj host bins and the shared `https://build.smithers.sh` remote object store | `smthrs info` + Uphill `cache-trust` |
| `.smithers/FACTORY.ts` | Single source of truth for featured flows, Dispatcher rules, `S.Github.Policy`, `issueViews`, `issueTransitions`, and the personalized Home | `smthrs ci //.smithers:factory-check` |
| `.smithers/factory.json` | Projected manifest served signed-out to Smithers Cloud and MCP `flows_list` | Projected by `.smithers/scripts/project-factory.ts` |
| `.smithers/home.json` | Projected audience-gated repository homepage | Checked by `check-smithers-content.ts` + `repo-content.test.mjs` |
| `.smithers/merge.json` | Configures `{ "flow": "queue" }` for VibeLang's merge queue | Verified by Smithers Cloud `pr/Merge` |
| `.smithers/workflows/ci.ts` | QuickJS-realm-plannable CI workflow running inside controlled Smithers Cloud job sandboxes | Planned in Smithers Cloud `worker/ci/Realm.vibe` |
| `.smithers/workflows/uphill.ts` | QuickJS-realm-plannable Lighthouse Backpressure Audit workflow | Runs `scripts/audit/run-audit.ts` |

## Personalized Factory UI by Audience

Smithers Cloud tailors `https://smithers.sh/smithersai/vibelang` to three audiences declared in `.smithers/FACTORY.ts` (`contributors: "role"`):

- **Maintainers (`Today`)**: Press `b` for a new branch workspace, triage live issues, inspect the **Mythical stack** of queued TODOs and changesets, watch recent CI runs, trigger factory flows, and jump directly to Live Factory (`/-/factory`), Wiki (`/-/wiki`), Cloud MCP (`/mcp`), and GitHub Releases.
- **Contributors (`Contribute`)**: Signed-in contributors see setup commands, the four-step contribution flow, the untrusted-execution and shared-cache trust boundary, quick links into Issues, Factory, Wiki, Docs, and MCP, and an interactive compiler Q&A prompt.
- **Viewers (`everyone`)**: Anyone visiting signed out sees the VibeLang hero, npm and Bun install commands, a verified runnable `users.vibe` snippet, live repository stats (4,027+ cases, 932+ fuzzers, 5,709 targets), Why VibeLang, the Public Smithers Cloud Factory showcase, benchmarks, ecosystem packages, and release history.

## Live Repository Feeds

Smithers Cloud's Factory (`/-/factory`) and Wiki (`/-/wiki`) tabs stream live Postgres-backed feed documents over ElectricSQL:

- **Public factory feeds**: `agents`, `commits`, `queue`, `vip`, `grades`, `origins`, `postmerge`, `migrations`, `hosts`, `media`, `audit`
- **Public wiki feed**: `wiki` (`{ notes: [{ path, title, markdown, tags, updatedAt }] }`), generated directly from `docs/wiki/**/*.md` by `.smithers/scripts/wiki.ts --publish`
- **Maintainer-only feeds**: `telegram`, `accounts`, and `for_will` decision answers (enforced server-side via `RepoRoles`, person-only `feed/answer`)

## Related Notes

- [[Overview]]
- [[Build-Graph-and-Cache]]
- [[Backpressure-and-Uphill]]
- [[Trust-and-Cache-Model]]
- [[Agent-Workflow-Guide]]
