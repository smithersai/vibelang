---
title: Lighthouse Backpressure Audit and Uphill
tags: [backpressure, uphill, lighthouse, quality, metrics]
---

# Lighthouse Backpressure Audit and Uphill

VibeLang treats repository health as a continuous, Chrome-Lighthouse-style audit report powered by **Uphill** (`.agents/uphill/`) and rendered by `scripts/audit/render-lighthouse-report.ts`.

## Six Audit Categories

| Category | Score Meaning | Key Metrics |
| --- | --- | --- |
| **Footprint** | Package modularity and agent token budget | `go-pkg-prod-lines`, `go-file-max-lines`, `pkg-source-bytes`, `skill-bytes` (`<= 18 kB`), `compiler-cases` |
| **Style** | Formatting and strict typing | `go-fmt`, TigerStyle `go-max-fn-lines` (`<= 70`), `ts-no-explicit-any`, `ts-no-ts-ignore` |
| **Correctness** | Version lockstep, generated-file sync, panic-free Go | `version-alignment`, `repo-guards`, `go-no-panic`, `go-no-todo` |
| **Testing** | Unit, fuzz, and package test depth | `go-unit-tests`, `go-fuzz-targets` (`>= 250`, currently 932+), `pkg-test-files` |
| **Documentation** | Go doc comments and link integrity | `go-doc-coverage` (`>= 80%`), `markdown-links` |
| **Factory & Trust** | Smithers Cloud parity and zero-poisoning posture | `factory-projection`, `cache-trust`, `workflow-trust`, `factory-policy`, `wiki-links` |

## Lighthouse Score Bands

- **90-100 (Green)**: Target met
- **50-89 (Amber)**: Improving, opportunities ranked by point gain
- **0-49 (Red)**: Needs architectural attention

## Running and Inspecting Locally

```sh
# Validate all metric scripts and print compact Lighthouse scores
uphill check && uphill --compact

# Render the interactive Lighthouse Backpressure Audit Report (HTML + JSON + Markdown)
bun scripts/audit/run-audit.ts

# Compare your working copy against HEAD to catch regressions before landing
uphill --compare HEAD --compact
```

Every report stamps **Execution Trust Provenance** at the top:

- **Trusted Controlled Sandbox** or **Maintainer Verified Execution**: eligible for shared cache writes and merge gates.
- **Untrusted Contributor Execution**: encouraged for fast feedback on forks and PRs, strictly limited to read-only shared cache hits and never able to poison trunk keys or bypass gates.

## Related Notes

- [[Smithers-Cloud-Setup]]
- [[Build-Graph-and-Cache]]
- [[Compiler-Pipeline]]
- [[Release-and-Security]]
