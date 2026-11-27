---
title: Compiler Pipeline
tags: [architecture, compiler, go, tsgo, lsp]
---

# Go TypeScript 7 Compiler Pipeline

VibeLang compiles `.vibe`, `.vibex`, and `.ts` files inside a single fork of Microsoft's Go-native TypeScript 7 compiler (`typescript/tsc/`). This design guarantees zero drift between TypeScript typechecking and VibeLang's Effect semantics.

## Subsystem Map

| Package | Responsibility | Key Entry Points |
| --- | --- | --- |
| `typescript/tsc/internal/vibelang/` | Parser extensions, Effect typechecking, lowering passes, diagnostics (`EK*`), compiler identity (`identity.go`) | `declarations.go`, `diagnostics.go`, `identity.go` |
| `typescript/tsc/internal/vibelangmapper/` | Source-level TypeScript projection and form resolution for linters and migration tools | `forms_resolve.go`, `render_exec.go` |
| `typescript/tsc/internal/vibelangestree/` | ESTree projection for native ESLint and Oxlint rule compatibility | `convert.go` |
| `typescript/tsc/internal/vibelangfmt/` | Canonical VibeLang source formatter (`vibelang-format`) | `encode.go` |
| `typescript/tsc/internal/vibelangprotocol/` | Shared compiler/runtime protocol constants (`ProducerQueueKey`) | `producer.go` |
| `typescript/tsc/internal/vibelangfuzz/` | 932+ Go fuzz targets and differential VIP oracles | `vipgen/` |
| `typescript/tsc/internal/lsp/` | Language Server Protocol with push diagnostics (`pushdiagnostics.go`) for coding agents | `pushdiagnostics.go` |

## Compilation Flow

```
  .vibe / .vibex / .ts sources
              │
              ▼
   1. Lex & Parse (contextual keywords: effect, error, service, schema, data, provide, match)
              │
              ▼
   2. Bind & Check (A!E!R Effect slots, @throws tracking, EK* diagnostics, Effect lint)
              │
              ▼
   3. Lower & Emit (JavaScript + source maps + .d.vibe.ts sidecar declarations)
              │
              ▼
   4. Tooling Projections (ESTree for ESLint/Oxlint, LSP push & pull diagnostics)
```

## Key Invariants

- **Sidecar Declarations (`VIP-27`)**: Every `foo.vibe` emits `foo.d.vibe.ts` beside it (or into `vibe.sidecarDir`) so stock TypeScript consumers resolve full Effect types with `@throws {never}` on non-effectful VibeLang functions.
- **LSP Push Diagnostics**: Coding agents such as Claude Code declare `textDocument.publishDiagnostics` without pull diagnostic requests. `pushdiagnostics.go` pushes open-document diagnostics automatically so agents see `EK*` errors immediately after edits.
- **Version Lockstep**: `typescript/tsc/internal/vibelang/identity.go` is the single source of truth for the release version across all npm packages (and `7.1.<patch>` for `vibelang-typescript`). Checked continuously by [[Backpressure-and-Uphill]].
- **TigerStyle Discipline**: Production Go packages enforce `gofmt`, modular files, and structured diagnostics instead of `panic()`.

## Verification Surfaces

- Acceptance cases: `typescript/vibelang/cases/` (4,027+ cases run via `smthrs ci //typescript/vibelang/...`)
- Go unit shards: 64 parallel shards in `PACKAGE.ts` (`go-vibelang-shard-01` .. `go-vibelang-shard-64`)
- Continuous fuzzing: `.smithers/flows/fuzz-campaign/flow.ts`

## Related Notes

- [[Overview]]
- [[Continuation-Kernel]]
- [[Build-Graph-and-Cache]]
- [[Mythical-History]]
