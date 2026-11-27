---
title: Public Roadmap and Open Factory Issues
tags: [factory, roadmap, issues, contributing, planning]
---

# Public Roadmap and Open Factory Issues

VibeLang tracks work publicly across Smithers Cloud (`https://smithers.sh/smithersai/vibelang`) and its two-way GitHub issue mirror (`https://github.com/smithersai/vibelang/issues`). Maintainers label issues with `accepted`, `timeline:`, and `commitment:` before implementation begins.

## Major Active Initiatives

| Issue | Theme | Summary |
| --- | --- | --- |
| `#6` | Ship VibeLang | Alpha-to-beta stabilization across compiler, runtime, and docs |
| `#7` | Spec graded A | Four-reviewer adversarial specification grading (`spec-review`) |
| `#8` | Implementation graded A | Compiler, runtime, and fuzz parity against the graded spec |
| `#5` | TypeScript compatibility | VIP-42 `vibelang-typescript` shim and `tsc` tool interoperability |
| `#19` | Real-world migration | Migrating Effect modules (`t3code`) to idiomatic VibeLang |
| `#464` | Durable workflows | Backing `task` and `workflow` directly on Smithers durable engine |
| `#466` | Agent evals and SDK | Moving hand-rolled agent shells to `@smthrs/agent` and `@smthrs/evals` |
| `#471` | Fuzz campaign flow | Running continuous Go compiler fuzz campaigns as durable flows |
| `#476` | Durable triggers | Replacing shell crons with durable Smithers schedules |
| `#477` | Durable flow engine | Moving local JSON-resume flows onto the Smithers durable engine |

## How Contributors Pick Up Work

1. Browse open issues through `https://smithers.sh/smithersai/vibelang` or the Cloud MCP `issues_list` tool.
2. Look for `accepted` and `good first issue` labels, or submit a minimal reproduction for a bug report (`issue/repro`).
3. Try the maintainer's linked `poc: #<n>` draft PR before opening one focused PR per accepted issue.
4. Run `bun scripts/audit/run-audit.ts` locally to inspect [[Backpressure-and-Uphill|Lighthouse Backpressure Audit]] impact before requesting review.

## Related Notes

- [[Smithers-Cloud-Setup]]
- [[Trust-and-Cache-Model]]
- [[Agent-Workflow-Guide]]
- [[Sandbox-and-MCP-Playbook]]
- [[Overview]]
