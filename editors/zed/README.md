# Vibe for Zed

> **Warning:** Vibe (VibeLang) is v0. The language will change in major, breaking ways. It is not suitable for production use.

This directory is a complete [Zed extension](https://zed.dev/docs/extensions) for `.vibe` (**Vibe**) and `.vibex` (**Vibe JSX**) files. It pairs the repository's tree-sitter grammars (`editors/tree-sitter-vibelang`) with the Vibe language server (`vibelang --lsp --stdio`).

## Features

- Native **Vibe** (`.vibe`) and **Vibe JSX** (`.vibex`) languages with dedicated tree-sitter highlighting, bracket matching, and indentation queries.
- Automatic language server discovery: uses the workspace's `node_modules/.bin/vibelang` (or `node_modules/.bin/vibe`), then `vibelang` / `vibe` on `PATH`, or an explicit path configured in `.zed/settings.json`.
- Full LSP diagnostics (TypeScript + `EK` codes), hovers with inferred Effect contracts, definitions, references, renames, completions, and formatting.

## Install as a Dev Extension

Requires the Rust toolchain with the `wasm32-wasip1` target (`rustup target add wasm32-wasip1`).

1. Clone `https://github.com/smithersai/vibelang`.
2. In Zed, open the Command Palette and run **zed: install dev extension**.
3. Select the `editors/zed` directory from your checkout.
4. Open any project with `vibelang` installed (`node_modules/.bin/vibelang`) and open a `.vibe` or `.vibex` file.

## Optional binary override

By default the extension runs the project's `node_modules/.bin/vibelang --lsp --stdio`. To override the binary path or arguments in one project, add `.zed/settings.json`:

```json
{
  "lsp": {
    "vibelang": {
      "binary": {
        "path": "/absolute/path/to/vibelang",
        "arguments": ["--lsp", "--stdio"]
      }
    }
  }
}
```

## Submitting to the Zed Extensions Registry

To publish this extension in the official [zed-industries/extensions](https://github.com/zed-industries/extensions) registry:

1. Fork `https://github.com/zed-industries/extensions` and add `https://github.com/smithersai/vibelang` as a submodule under `extensions/vibelang` (or point the dedicated mirror repo at `editors/zed/`).
2. Add an entry in `extensions.toml`:

```toml
[vibelang]
submodule = "extensions/vibelang"
path = "editors/zed"
version = "0.0.15"
```

3. Update `rev` in `editors/zed/extension.toml` to the released commit SHA and open a pull request to `zed-industries/extensions`.
