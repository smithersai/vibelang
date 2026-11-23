# VS Code and Cursor

The `vibelang` package ships the `vibelang.vibelang` extension at `node_modules/vibelang/editor/vibelang.vsix` (not yet on the VS Code Marketplace or Open VSX). It works in VS Code 1.91+ and Cursor, running the project's `vibelang --lsp --stdio` server for diagnostics, hovers, definitions, references, renames, and completions.

## 1. Install the extension

On macOS, open the Command Palette and run **Shell Command: Install 'code' command in PATH** (VS Code) or **Shell Command: Install 'cursor' command in PATH** (Cursor), then open a new terminal.

From the project directory after installing dependencies, run:

```sh
code --install-extension node_modules/vibelang/editor/vibelang.vsix
cursor --install-extension node_modules/vibelang/editor/vibelang.vsix
```

## 2. Check the extension

```sh
code --list-extensions | grep vibelang
```

For Cursor, run `cursor --list-extensions | grep vibelang`. Expected output:

```out
vibelang.vibelang
```

## 3. Open your project in the editor

Open the project and trust the workspace—the extension runs `node_modules/.bin/vibelang` and stays inactive in untrusted workspaces. If missing, the status item reads "vibelang not found"; when running, its status detail shows the compiler path and server/TypeScript version. Reinstall the `.vsix` from `node_modules` after upgrading `vibelang`.

- **TypeScript files importing `.vibe`:** Without adjacent declaration sidecars, built-in TypeScript cannot resolve `.vibe` imports. Either run **VibeLang: Serve TypeScript Files in This Workspace** (turns off built-in TypeScript automatically in Cursor; in VS Code, prompts to disable "TypeScript and JavaScript Language Features"), or run `vibelang` to write adjacent `.d.vibe.ts` declarations (even with `--noEmit`) and [configure TypeScript tools to read them](vibelang-cli.md#let-typescript-tools-read-vibe-modules).
- **JSX (`.vibex`):** Open JSX source as `.vibex` (**VibeLang JSX** mode; untitled documents work in both modes). Component/prop completions, hovers, go-to-definition, paired-tag rename, and VibeLang diagnostics/Effect contracts inside JSX containers all work.

## Editor features

The server advertises these LSP capabilities (client support and shortcuts vary; `.ts` files importing `.vibe` require the TypeScript handoff above):

| Feature | How to use it |
| --- | --- |
| Call hierarchy | **Show Call Hierarchy** on a function to inspect callers and callees (reports written call sites; generated `error` constructors do not add calls at the declaration) |
| Type definition | **Go to Type Definition** on a value |
| Workspace symbols | **Go to Symbol in Workspace** to search project symbols |
| Signature help | **Trigger Parameter Hints** inside an argument list |
| Selection ranges | **Expand Selection** / **Shrink Selection** across syntax boundaries, including nested `schema`/`data`/`match`/typed `catch` and mutable schema arrays |
| Document highlights | Place cursor on a symbol to highlight file uses |
| Inlay hints | Enable client inlay hints and TypeScript inlay-hint preferences |
| Code lens | Enable client code lens and TypeScript reference/implementation lens preferences |
| Linked editing | Enable linked editing to update paired JSX tags together |
| On-type formatting | Enable format-on-type for supported characters |

- **Refactor `module` declarations:** On a TypeScript `module` declaration, run **Move module to a TypeScript file** to extract its body to a sibling `.ts` file and rewrite imports/re-exports. See the [refactor guide](../getting-started/012-devtools.md#move-a-typescript-module-body-to-a-file) for filename collisions and extensions.
- **Destructuring parameters:** Reference search and rename include parameter declarations and destructuring sources (including contextual names such as `source`), even when defaults contain `do { }` or a `match` arm returning via `do { }`.
- **Retired syntax:** `service class` (`EK0909`) and `layer` (`EK2121`) declarations are always errors regardless of warning settings; edit them explicitly.

## Server settings and troubleshooting

| Setting | Default | Purpose |
| --- | --- | --- |
| `vibelang.server.path` | `""` | Override compiler executable (relative paths start at the first workspace folder) |
| `vibelang.server.typeScriptFiles` | `"auto"` | Serve TypeScript when the built-in server is off; `"on"` always serves it, `"off"` leaves it to built-in |
| `vibelang.trace.server` | `"off"` | Set `"messages"` or `"verbose"` to log LSP traffic |

Run **VibeLang: Restart Language Server** after changing executables, rebuilding, or installing a missing compiler (even while an earlier notification stays open). Inspect logs with **VibeLang: Show Language Server Output**. For protocol bugs, enable tracing, restart, reproduce, turn tracing off, and review logs before sharing—they can contain source text and file paths.

## JSX highlighting

`.vibex` files use the TSX-derived `source.vibex` grammar with VibeLang scopes inside JSX expression containers. Tag names, attribute strings, and JSX text (including `%`) keep JSX meaning; use `x as T` for assertions and `<T,>` for unconstrained generic arrows, as in `.tsx`.
