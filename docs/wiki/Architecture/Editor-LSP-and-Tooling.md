---
title: Editor, LSP, and Tooling Ecosystem
tags: [architecture, lsp, editors, bundlers, tooling]
---

# Editor, LSP, and Tooling Ecosystem

VibeLang ships compiler-backed editor support, formatting, linting, and bundler plugins from one monorepo so `.vibe`, `.vibex`, and `.ts` files share identical types and diagnostics everywhere.

## Tooling Surface Map

| Package / Path | Role |
| --- | --- |
| `typescript/tsc/internal/lsp/` | Native Go LSP with push diagnostics for editors and coding agents |
| `editors/vscode/` | Bundled VS Code and Cursor `.vsix` extension (`vibelang/editor/vibelang.vsix`) |
| `editors/tree-sitter-vibelang/` | Tree-sitter grammar for Neovim, Zed, and syntax highlighting |
| `typescript/tsc/internal/vibelangestree/` | ESTree JSON converter for ESLint and Oxlint (`vibelang/eslint`) |
| `typescript/tsc/internal/vibelangfmt/` | Canonical formatter (`vibe-format` / `vibelang-format`) |
| `packages/vite/` | Vite and Vitest plugin (`vibelang-vite`) |
| `packages/unplugin/` | Webpack, Rspack, Rollup, and esbuild adapter (`vibelang-unplugin`) |
| `packages/create-vibelang/` | Project scaffolder (`npm create vibelang@latest`, `--smithers`) |
| `packages/typescript-shim/` | VIP-42 preview shim running VibeLang under `typescript` (`// @vibe`) |

## Mixed `.vibe` and `.ts` Projects

1. The compiler writes `.d.vibe.ts` declarations beside compiled output so stock `tsc` and `vue-tsc` resolve `.vibe` imports whenever `allowArbitraryExtensions` is enabled.
2. In VS Code or Cursor, disabling the built-in TypeScript Language Features extension for the workspace lets the VibeLang Go LSP own both `.vibe` and `.ts` files with a single typechecker.
3. `vibe run <file.vibe>` compiles and executes a `.vibe` entrypoint directly in Node with source maps.

## Related Notes

- [[Compiler-Pipeline]]
- [[Language-Design-and-EK-Diagnostics]]
- [[Build-Graph-and-Cache]]
- [[Release-and-Security]]
- [[Overview]]
