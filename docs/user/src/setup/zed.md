# Zed

Zed defines languages through extensions, so these settings treat `.vibe` files as TypeScript and replace the binary of Zed's TypeScript server, `vtsls`, with `vibelang`. Zed then sends `.vibe` files with the language id `typescript`, which the server accepts, and the server also serves the project's `.ts` files. In Zed 0.195.3 the server starts, but diagnostic requests fail: Zed sends `previousResultId: null`, which VibeLang rejects with `InvalidParams` (-32602). Until the client sends diagnostic requests without the null field, check the project with `npx vibelang --noEmit` in the terminal.

## 1. Find the compiler's absolute path

From the project directory, run:

```sh
echo "$PWD/node_modules/.bin/vibelang"
"$PWD/node_modules/.bin/vibelang" --version
```

The first line is the path for step 2; the second command prints `VibeLang 0.0.11 (TypeScript 7.1.0-dev)`.

## 2. Add the project settings

Put these settings in the project's `.zed/settings.json`, so other TypeScript projects keep `vtsls`; if the file exists, merge these keys into it. Replace the `path` value with the path from step 1.

```json
{
  "file_types": {
    "TypeScript": ["vibe"]
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
    }
  }
}
```

The path must be absolute. The `language_servers` list selects only this server, so no other TypeScript server reports the same files. Open the project in Zed to use the server. Keep the project configuration in `vibe.config.json`, `tsconfig.json`, or `jsconfig.json`. VibeLang selects the first file that exists in that order.

Support for the new forms arrives with the compiler's VIP implementation.
