# Zed

Zed defines languages through extensions, so these project settings map `.vibe` to TypeScript and `.vibex` to TSX and replace `vtsls`'s binary with `vibelang`. VibeLang accepts Zed's `typescript` language id and serves `.ts` files too.

> **Known Zed 0.195.3 limit:** The server starts, but Zed sends `previousResultId: null` on diagnostic requests, which VibeLang rejects with `InvalidParams` (`-32602`). Run `npx vibelang --noEmit` in the terminal for diagnostics until Zed omits that field.

## 1. Find the compiler's absolute path

From the project directory, run:

```sh
echo "$PWD/node_modules/.bin/vibelang"
"$PWD/node_modules/.bin/vibelang" --version
```

Copy the first line for step 2; the second prints `VibeLang 0.0.13 (TypeScript 7.1.0-dev)`.

## 2. Add the project settings

Add or merge into `.zed/settings.json` (keeping `vtsls` intact in other TypeScript projects) and replace `path` with the absolute path from step 1:

```json
{
  "file_types": {
    "TypeScript": ["vibe"],
    "TSX": ["vibex"]
  },
  "lsp": {
    "vtsls": {
      "binary": {
        "path": "/absolute/path/to/project/node_modules/.bin/vibelang",
        "arguments": ["--lsp", "--stdio"]
      }
    }
  },
  "languages": {
    "TypeScript": {
      "language_servers": ["vtsls"]
    },
    "TSX": {
      "language_servers": ["vtsls"]
    }
  }
}
```

`language_servers` selects only this server so no other TypeScript server duplicates reports. VibeLang reads the first existing config in order: `vibe.config.json`, `tsconfig.json`, `jsconfig.json`.
