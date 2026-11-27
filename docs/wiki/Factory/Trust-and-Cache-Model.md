---
title: Trust and Cache Model
tags: [factory, security, cache, sandboxes, trust]
---

# Trust and Cache Model

VibeLang runs publicly on Smithers Cloud with open participation and strict execution boundaries. Anyone can browse the factory, inspect the [[Backpressure-and-Uphill|Lighthouse backpressure audit]], read the [[Mythical-History|Mythical History]], or run checks locally and on pull requests. Only executions inside controlled sandboxes or verified by maintainers can publish shared cache entries or satisfy merge gates.

## Audience Roles

The public coding factory at `https://smithers.sh/smithersai/vibelang` adapts its home view for three audiences via `.smithers/home.json` (`contributors: "role"`):

- **Maintainers** (`roninjin10`): Full operational cockpit with quick branch creation, triage queues, stacked changeset review, active flow runs, release controls, and one-time-use sandbox credential minting.
- **Contributors** (anyone who has landed at least one contribution): Onboarding setup, focused issue-to-PR workflow, reproduction and PoC templates, read-only shared cache instructions, and backpressure checklists.
- **Viewers** (everyone): Interactive language hero, `npm create vibelang@latest my-app` alongside the Bun command, live compiler/runtime stats, public factory links, runnable benchmark instructions, ecosystem links, and release history.

## Split Read/Write Object Store (`https://build.smithers.sh`)

All 5,709 build targets share `https://build.smithers.sh` as a content-addressed remote cache declared in `.smithers/WORKSPACE.ts`:

| Context | Credential | Remote Cache Reads | Remote Cache Writes | Gate Authority |
| --- | --- | --- | --- | --- |
| Local / Contributor PR | `SMITHERS_CACHE_READ_TOKEN` | Allowed (fast cache hits) | Refused (`HTTP 403`) | Informational only |
| Controlled Sandbox (`main`) | `SMITHERS_CACHE_WRITE_TOKEN` inside `cache-publish` environment | Allowed | Allowed (confined sandboxes only) | Authoritative |
| Unconfined local shell (`sandbox: "none"`) | Any | Allowed | Client-refused (stays local) | Local verification |

Even when a write credential is present, `smthrs` refuses to upload outputs produced by unconfined (`sandbox: "none"`) targets. Only targets executed inside an enforced OS sandbox (macOS Seatbelt or Linux Bubblewrap with `network: none`) or a Smithers Cloud controlled sandbox publish to the shared trunk cache.

## Pull Request and Branch Protection

- `.github/workflows/pr-check.yml` runs with `permissions: { contents: read }`, passes only `SMITHERS_CACHE_READ_TOKEN`, and isolates any scratch namespace to `pr-<number>`.
- `.github/workflows/cache-publish.yml` runs exclusively on `push` to `main` inside the GitHub deployment environment `cache-publish`, restricted strictly to the `main` branch.
- `.smithers/FACTORY.ts` protects `.smithers/**`, `.github/workflows/**`, `scripts/release/**`, `docs/tools/**`, `PACKAGE.ts`, and `WORKSPACE.ts` under `maintainers: ["roninjin10"]`.
- Every run of `bun scripts/audit/run-audit.ts` stamps its [[Backpressure-and-Uphill|Lighthouse Backpressure Audit]] with exact `executionTrust` (`trusted-sandbox`, `maintainer`, or `untrusted-contributor`) and `cachePolicy`.

## Related Notes

- [[Smithers-Cloud-Setup]]
- [[Agent-Workflow-Guide]]
- [[Build-Graph-and-Cache]]
- [[Release-and-Security]]
- [[Overview]]
