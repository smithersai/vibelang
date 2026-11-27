# Changelog

All notable changes to the Vibe (`vibelang.vibelang`) VS Code / Open VSX extension are documented in this file.

## 0.0.15

- Updated language server integration for Vibe 0.0.15, including `effect@^4.1.0` compatibility (tested on `4.1.6`), `@effect/ui` throws-table support, `schema data` (VIP-74), and concise tagged `e catch { when … }` (VIP-75).

## 0.0.14

- Adopted the **Vibe** display name alongside `vibelang` identifiers and CLI binaries (`vibe`, `vibe-format`).
- Added VS Code Marketplace and Open VSX publishing readiness (256x256 PNG icon, gallery banner, Q&A link, and changelog).
- Improved `.vibe` file rename/move import specifier preservation, `schema`/`data` reference & highlight coverage, and format-selection handling via the 0.0.14 language server.
- Supported JSX editing, paired-tag linked editing, and Vibe expressions inside `.vibex` files.

## 0.0.13

- Initial alpha release of the Vibe (`vibelang.vibelang`) extension bundled in `node_modules/vibelang/editor/vibelang.vsix`.
- Added `.vibe` and `.vibex` TextMate grammars derived from VS Code's TypeScript/TSX grammars, semantic token scopes, and language configurations.
- Wired `vibelang --lsp --stdio` with workspace-first binary discovery, untrusted-workspace protection, and optional TypeScript file handoff (`vibelang.server.typeScriptFiles`).
