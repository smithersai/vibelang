# Developer tools after migration

The migration setup extends the repository's existing format and lint scripts,
rather than accepting a green command that skips VibeLang.

## Prettier and Oxfmt

Install `vibelang` and configure Prettier's `plugins` with
`"vibelang/prettier"` (or pass `--plugin vibelang/prettier`). The plugin infers
`.vibe` and delegates the entire file to the shipped dprint process plugin,
the same formatter used by `vibelang-format --write` and
`vibelang-format --check`. Prettier's own layout options do not alter that
result. This keeps the two entry points identical. dprint 0.64.3 is installed
with the compiler; the pinned TypeScript Wasm plugin is downloaded and cached
on first use.

Oxfmt's [unsupported features](https://oxc.rs/docs/guide/usage/formatter/unsupported-features.html)
explicitly exclude Prettier plugins. Its
[CLI source](https://github.com/oxc-project/oxc/blob/main/apps/oxfmt/src/cli/command.rs)
has no external formatter option. Internal N-API external-service callbacks
are implementation details, not a user language-plugin registration API.
Migration therefore appends `vibelang-format --check` or `--write` to
Oxfmt and Vite+ format scripts. The same check extends Vite+ staged hooks.
Raw `oxfmt file.vibe` remains unsupported; use the migrated script.
Existing dprint JSON configs gain the shipped plugin and `.vibe` includes.

## Oxlint

Oxlint's [JS plugin API](https://oxc.rs/docs/guide/usage/linter/js-plugins.html#api-support)
explicitly excludes custom formats and parsers. Its
[partial loader](https://github.com/oxc-project/oxc/blob/main/crates/oxc_linter/src/loader/partial_loader/mod.rs)
dispatches only Vue, Astro, and Svelte script regions. VibeLang is a language,
not a container of JavaScript script tags, so that mechanism cannot parse it.

Migration appends ESLint with the shipped `vibelang/eslint` parser to the
existing Oxlint/Vite+ lint script. The generated
`.vibelang/eslint.config.mjs` enables typescript-eslint's recommended rules
and `no-debugger`, and reports original VibeLang locations. It is editable
for the repository's own rules. It does not automatically port every Oxlint
plugin rule or type-aware rule. Raw Oxlint still skips VibeLang.
This is smaller and preserves source locations better than linting emitted
TypeScript; a future Oxlint-only bridge would need emitted TS, source-map
remapping, and filtering of diagnostics on compiler-generated code.

## ast-grep

`vibelang-ast-grep <output>` compiles the canonical
`editors/tree-sitter-vibelang/src` parser and scanner into a shared library.
The compiler npm release includes these sources; a C compiler is required.
Migration registers `VibeLang` in each `sgconfig.yml`, with the symbol
`tree_sitter_vibe`, extension `vibe`, and a generated library beside the
config. It clones TypeScript/TSX rules with VibeLang language selectors and
unique IDs: registration alone would not apply existing rules.

The library is ignored and rebuilt by the repository's postinstall command,
so a fresh checkout builds for its own machine. Linux and macOS use the same
extensionless output path. Windows developers use WSL.
For ast-grep 0.50+, [custom language loading](https://ast-grep.github.io/advanced/custom-language.html)
also requires `--custom-languages allow` or project trust; earlier versions
load registered languages directly. Existing pinned versions are retained.

Migration recognizes TypeScript/TSX aliases without case sensitivity and translates TS file selectors and ignores to .vibe, preserving directory scope.
