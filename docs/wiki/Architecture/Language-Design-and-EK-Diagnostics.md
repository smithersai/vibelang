---
title: Language Design and EK Diagnostics
tags: [architecture, language, diagnostics, effect4, semantics]
---

# Language Design and EK Diagnostics

Every VibeLang construct is exact, transparent sugar for Effect 4 TypeScript. Plain and `async` functions keep standard TypeScript semantics while `effect` functions, typed error slots, and service requirements are checked natively inside the [[Compiler-Pipeline|Go TypeScript 7 compiler]].

## Core Forms and Effect 4 Lowering

| VibeLang Form | Effect 4 Equivalent |
| --- | --- |
| `error NotFound { id: string }` | `Data.TaggedError("NotFound")` |
| `service Users { ... }` | `Context.Service<Users, ...>()` |
| `User!NotFound!Users` | `Effect.Effect<User, NotFound, Users>` |
| `effect function f() { ... }` | `Effect.gen(function* () { ... })` |
| `try expr` | `yield* expr` |
| `throw new NotFound({ id })` | `yield* Effect.fail(...)` |
| `expr catch () => fallback` | `Effect.orElseSucceed(expr, ...)` |
| `try.all [a(), b()]` | `Effect.all([a(), b()], { concurrency })` |
| `provide LiveLayer { ... }` | `Effect.provide(..., LiveLayer)` |
| `effect function* gen() { yield v }` | `Stream.callback` with `$produce` |

## The `EK*` Diagnostic Architecture

Compiler diagnostics are registered centrally in `typescript/tsc/internal/vibelang/diagnostics.go` and cross-checked against Appendix B of `docs/design/src/` by `docs:check`:

- **Grammar and placement (`EK0xxx`–`EK1xxx`)**: Enforces where `effect`, `try`, `provide`, `throw`, and `yield` are legal and rejects ambiguous shorthand syntax cleanly.
- **Typed failure and throw tracking (`EK2xxx`–`EK3xxx`)**: Tracks checked Effect errors alongside JavaScript exceptions via `@throws` contracts (`globalthrows_table.go` and `vibelangmapper/builtin_contracts_generated.go`).
- **Services, layers, and boundaries (`EK4xxx`)**: Verifies service provision, warns on unguarded `any` returns (`EK4409`), and keeps plain TypeScript boundaries explicit through `Effect.try`.

## Three-Way Parity Verification

VibeLang verifies semantics across three independent layers:

1. **Native Go compiler (`typescript/tsc/internal/vibelang/`)**: 4,027+ acceptance cases in `typescript/vibelang/cases/` plus 932+ Go fuzz targets.
2. **TypeScript 7 content mapper (`packages/ts-mapper/`)**: Projects `.vibe` files to TypeScript with `prelude.d.ts` so stock `tsc` agrees on types and diagnostics.
3. **Runtime kernel laws (`packages/runtime/`, `experiments/`)**: 183+ continuation kernel law checks and Node ABI contract tests.

## Related Notes

- [[Compiler-Pipeline]]
- [[Continuation-Kernel]]
- [[Editor-LSP-and-Tooling]]
- [[VIP-and-Decision-Log]]
- [[Overview]]
