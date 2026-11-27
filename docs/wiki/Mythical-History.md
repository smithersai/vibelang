---
title: The Mythical History of VibeLang
tags: [history, mythical-history, vips, releases, architecture]
---

# The Mythical History of VibeLang

Every enduring language carries the scars of the designs it tested, measured, and deliberately threw away. This chronicle traces how VibeLang grew from early Effect syntax experiments into a Go-native TypeScript 7 compiler and public coding factory on Smithers Cloud.

## Age I: Effeck and the Early Prototypes

VibeLang began under the codename **effeck**, exploring how to write Effect programs without generator ceremony (`Effect.gen(function* () { ... })` and `yield*`). Early prototypes in `prototype/` and the original decision ledger (`docs/design/history/DECISIONS.md`, decisions `D1` through `D520`) tested ambitious implicit models:

- `D320-D323` and `D500` explored inferring whether a function was effectful from `await` inside its body (`D540`, `D550`).
- `D27` experimented with a `wire` syntax for dependency graphs.
- `D129`, `D221-D222`, and `D188` tried custom `layer Name: Service { ... }` declarations and trailing block syntax.
- `D25` and `D342` tried overloading `using` for Effect resource regions.
- `D2`, `D16-D20`, and `D351` designed algebraic control operations and delimited continuation handlers.

Building real programs against those early rules exposed a hard truth: implicit effect execution made plain TypeScript code unpredictable, and bespoke syntax for layers, wiring, and trailing blocks fought the TypeScript mental model instead of clarifying it.

## Age II: The Rename and the TypeScript 7 Go Fork

On **2026-10-18**, the project officially renamed from `effeck` to **VibeLang** and shipped `vibelang@0.0.1`, the first release on npm. Rather than maintaining a fragile standalone parser, the compiler forked Microsoft's native Go TypeScript 7 compiler (`typescript/tsc/internal/vibelang*`) so `.vibe` and `.ts` files typecheck in one unified program, emit clean JavaScript with `.d.vibe.ts` declarations, and share a single language server.

See [[Compiler-Pipeline]] and [[Continuation-Kernel]] for how the Go compiler and `vibelang-runtime` cooperate.

## Age III: The Great Simplification (VIP-1 through VIP-41)

Between late October and November 2026, VibeLang replaced the 520-entry historical log with formal **VibeLang Improvement Proposals** (`docs/design/vips/0001` through `0073`) and subjected the entire specification (`docs/design/src/`) to four-reviewer adversarial grading (`spec-review`: Fable, Opus, Sol, Astra). Every ambiguity discovered during review became a compiler acceptance case and a Go fuzz target:

- **Explicit Effects (VIP-1, VIP-2, VIP-5)**: `effect function` goes exactly where `async function` goes, and `try` runs an Effect while `await` stays strictly for Promises.
- **Typed Errors and Services (VIP-3, VIP-4, VIP-9, VIP-12, VIP-13)**: `A!E!R` shorthand, `error`, `service`, and `provide` replaced the retired `layer Name`, `service class`, and `with Provider` spellings (`EK2121`, `EK0909`).
- **Deliberate Denials**: `VIP-8` denied Effect-overloaded `using`, `VIP-10` denied service call shorthand, `VIP-11` denied trailing blocks, `VIP-24` denied `wire`, `VIP-25` denied inline modules, and on **2026-11-23** `VIP-35` denied algebraic control handlers for the core language.
- **No Guessing on Exceptions (VIP-4, VIP-40)**: Plain VibeLang functions never throw silently, and foreign throwing TypeScript code stays isolated in explicit `module` blocks with `@throws` annotations.
- **First Alpha (`vibelang@0.0.13`, 2026-11-13)**: Cross-compiled 6 native binaries (macOS, Linux, Windows on arm64 and x64), shipped the VS Code extension and LSP push diagnostics for Claude Code (`pushdiagnostics.go`), and crossed 4,000+ acceptance cases.

## Age IV: The Durable Workflow Horizon (VIP-44 through VIP-73)

With the core language hardened by **4,027+ acceptance cases** and **932+ Go fuzz targets**, the next wave of proposals (`VIP-44`, `VIP-55` through `VIP-73`) began encoding durable workflows, tasks, waits, capabilities, evals, memory, sandboxes, and MCP directly into the language standard library so VibeLang replaces YAML for CI and agent workflows across the entire Smithers ecosystem.

At the same time, **Vibe `0.0.14`** (2026-11-26) landed 120+ compiler and runtime fixes, SVG visual user guides on `vibelang.sh`, Sigstore provenance publishing via GitHub OIDC, and opt-in experimental builtins.

## Age V: The Public Smithers Cloud Coding Factory

In late November 2026, `smithersai/vibelang` completed its switchover to a fully public coding factory on **Smithers Cloud** (`https://smithers.sh/smithersai/vibelang`):

- **Shared Object Store**: `.smithers/WORKSPACE.ts` connects all 5,709 build targets to `https://build.smithers.sh` with server-enforced split read/write trust boundaries ([[Build-Graph-and-Cache]]).
- **Personalized Factory UI**: `.smithers/FACTORY.ts` projects audience-tailored homes for maintainers, contributors, and viewers ([[Smithers-Cloud-Setup]]).
- **Lighthouse Backpressure**: Continuous Uphill metrics render as a Chrome-Lighthouse-style audit report with execution trust provenance ([[Backpressure-and-Uphill]]).
- **BYOA Cloud MCP**: Every coding agent connects via authenticated OAuth 2.1 Streamable HTTP MCP and one-time-use sandbox credentials ([[Agent-Workflow-Guide]]).
- **Automated Mirror to Release**: Landing on `main` pushes to GitHub and triggers full cross-platform npm releases and `vibelang.sh` docs deployments automatically ([[Release-and-Security]]).

## Related Notes

- [[Overview]]
- [[VIP-and-Decision-Log]]
- [[Compiler-Pipeline]]
- [[Smithers-Cloud-Setup]]
