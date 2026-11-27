---
title: Continuation Kernel and Effect 4 Runtime
tags: [architecture, runtime, effect4, kernel]
---

# Continuation Kernel and Effect 4 Runtime

Compiled VibeLang code executes on `vibelang-runtime` (`packages/runtime/`) over **Effect 4** (`effect@4.1.1`). Every VibeLang construct compiles to ordinary Effect 4 primitives with zero hidden global state.

## Runtime Layers

| Module | Role |
| --- | --- |
| `packages/runtime/src/kernel/` | Continuation kernel and structured control helpers |
| `packages/runtime/src/producers.ts` | Stream-backed `effect function*` producers keyed by `vibelang-runtime/ProducerQueue` |
| `packages/runtime/src/experimental/` | Platform services (`platform-node`, `platform-bun`, `platform-browser`, DNS, encoding, net addresses) |
| `experiments/` | Formal continuation kernel law suite (`smthrs ci //:kernel-laws`) |

## Cross-Language Contract

The Go compiler (`typescript/tsc/internal/vibelangprotocol/producer.go`) and the TypeScript runtime (`packages/runtime/src/producers.ts`) share the exact service key `"vibelang-runtime/ProducerQueue"`. Any change to lowered helper signatures must pass both `smthrs ci //:kernel-laws` and `smthrs ci //:e2e`.

## Bundler and Starter Ecosystem

- `packages/compiler` (`vibelang`): native binary launcher, agent skill (`SKILL.md`), and bundled VS Code extension
- `packages/vite` (`vibelang-vite`) and `packages/unplugin` (`vibelang-unplugin`): Vite, Vitest, webpack, Rspack, and Rollup integration
- `packages/typescript-shim` (`vibelang-typescript`): drop-in TypeScript 7 compatibility shim
- `packages/create-vibelang` (`create-vibelang`): zero-config app scaffolder (`npm create vibelang@latest my-app`)

## Related Notes

- [[Compiler-Pipeline]]
- [[Backpressure-and-Uphill]]
- [[Release-and-Security]]
