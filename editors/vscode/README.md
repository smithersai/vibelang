# VibeLang for VS Code

> **Warning:** VibeLang is v0. The language will change in major, breaking ways. It is not suitable for production use.

The extension `vibelang.vibelang` registers `vibe` (VibeLang) for `.vibe` files and `vibex` (VibeLang JSX) for `.vibex` files and runs the VibeLang compiler, `vibelang --lsp --stdio`, as their language server. Opening either file type activates the extension and connects it to the language server. It works in VS Code 1.91 or later and in Cursor.

| Feature | What you see |
| --- | --- |
| Diagnostics | TypeScript's errors at `.vibe` spans, and VibeLang's own, such as `EK(1003)` on `async` |
| Hover | A function's inferred contract, `function lookup(id: number): Effect<string, NotFound, never>`, and at a call that runs, "Runs here and returns `string`." |
| Navigation | Go to definition, find references, and rename across `.vibe` and `.ts` files |
| Completions | TypeScript's completions, with VibeLang types: inside a `.vibe` function, a call that runs has its success type |
| Highlighting | A TextMate grammar derived from VS Code's TypeScript grammar, with root scope `source.vibe`. A module declaration's body is colored by VS Code's TypeScript grammar, `source.ts`, as a `.ts` file is |

## Install

On macOS, open the editor’s Command Palette and run **Shell Command: Install 'code' command in PATH** for VS Code or **Shell Command: Install 'cursor' command in PATH** for Cursor. Open a new terminal so the shell can find the command before continuing.

From a project with `vibelang` installed, such as one made with `bun create vibelang`:

```sh
code --install-extension node_modules/vibelang/editor/vibelang.vsix     # VS Code
cursor --install-extension node_modules/vibelang/editor/vibelang.vsix   # Cursor
```

Then open the project directory. The extension isn't on the VS Code Marketplace or Open VSX yet; install it again after updating `vibelang`.

To build it from this repository, run `sh scripts/setup.sh` at the repository root, which builds the extension and prints the install commands, or build it alone:

```sh
cd editors/vscode
bun install
bun run package                             # writes vibelang.vsix
code --install-extension vibelang.vsix        # VS Code
cursor --install-extension vibelang.vsix      # Cursor
```

## How it finds vibelang

The extension runs the first of:

1. The `vibelang.server.path` setting. A relative path is relative to the first workspace folder.
2. The `node_modules/.bin/vibelang` nearest to the open `.vibe` or `.vibex` file, then nearest to each workspace folder. `bun install` puts it there from `vibelang`.
3. `vibelang` on `PATH`. `scripts/setup.sh` links `~/.local/bin/vibelang` when that directory is on `PATH`.

If none exists, the extension says so and the status item next to the language mode reads "vibelang not found". After rebuilding the compiler, run **VibeLang: Restart Language Server**. After installing a missing compiler, restart the server even if the earlier notification is still open; it does not block activation or restart.

## TypeScript files

The language server checks the program's `.ts` files with its `.vibe` files, so `.vibe` code sees TypeScript types. `vibelang.server.typeScriptFiles` decides which server answers for an open `.ts` file:

| Value | `.ts` and `.js` files are served by |
| --- | --- |
| `auto` (default) | VibeLang when the built-in TypeScript features are off, else VS Code's built-in TypeScript |
| `on` | VibeLang, and also VS Code's built-in TypeScript unless it is off, so results appear twice |
| `off` | VS Code's built-in TypeScript |

The built-in features count as off when the built-in extension "TypeScript and JavaScript Language Features" is disabled, or, in Cursor, when `typescript.experimental.useTsgo` is `true`. Turn them off when a `.ts` file imports a `.vibe` module: VS Code's TypeScript cannot resolve `.vibe` files. **VibeLang: Serve TypeScript Files in This Workspace** does it in Cursor and shows the extension to disable in VS Code.

The extension never forwards `typescript.validate.enable` to the server, so turning off the built-in TypeScript diagnostics doesn't turn off VibeLang's.

## Settings and commands

| Setting | Default | Meaning |
| --- | --- | --- |
| `vibelang.server.path` | `""` | The `vibelang` to run |
| `vibelang.server.typeScriptFiles` | `"auto"` | Whether the server also serves `.ts` and `.js` files |
| `vibelang.trace.server` | `"off"` | `"messages"` or `"verbose"` logs the LSP traffic to the VibeLang output |

| Command | Does |
| --- | --- |
| VibeLang: Restart Language Server | Stops the server and starts it again, finding `vibelang` anew |
| VibeLang: Show Language Server Output | Opens the VibeLang output, which has the server's log |
| VibeLang: Serve TypeScript Files in This Workspace | Turns the built-in TypeScript features off for the workspace, as above |

The extension doesn't run in untrusted workspaces, because it executes the workspace's `node_modules/.bin/vibelang`; highlighting still works there.

## Develop

```sh
bun run build            # type-check with tsc, bundle with esbuild to dist/extension.js
bun run package          # build, write vibelang.vsix, then verify its licenses
bun run test             # install vibelang.vsix into a fresh VS Code and check it
bun run derive-grammar   # regenerate syntaxes/ from the installed VS Code's TypeScript grammar
```

`bun run test` needs `vibelang` at `../../typescript/built/local/vibelang` (or `VIBELANG`), `effect` in `../../experiments/node_modules` (or `EFFECT_NODE_MODULES`), and the built runtime in `../../packages/runtime` (or `VIBELANG_RUNTIME`). It downloads VS Code 1.98.2 to `.vscode-test/` (`VSCODE_VERSION`, `VSCODE_TEST_CACHE`), or uses the VS Code at `VSCODE_EXECUTABLE`. It copies `typescript/vibelang/lsp-fixture` to a scratch project, installs `vibelang` there as `bun install` does, with the compiler under test as its native binary, installs the `.vsix` into a fresh profile, and checks the language, the grammar's scopes, TypeScript and EK diagnostics, hovers, a definition, and completions of prelude names and service members; a second run disables the built-in TypeScript extension and checks that VibeLang reports `.ts` diagnostics. On Linux, run it under `xvfb-run -a`; on macOS it opens a VS Code window for about a minute.

## License

The extension is MIT-licensed. The grammar and language configuration are derived from MIT-licensed work by Microsoft. `bun run build` generates `LICENSE` from the repository license and `ThirdPartyNotices.txt` from `scripts/grammar-notices.txt` plus the license and notice files of every dependency that contributes code to esbuild's bundle. Edit the grammar notices source rather than the generated file. `bun run package` verifies the license and complete dependency notices inside the packed VSIX.

## Editor features

The server advertises these features to LSP clients. In VS Code and Cursor, use the command palette or the symbol's context menu; availability and keyboard shortcuts depend on the client.

| Feature | How to use it |
| --- | --- |
| Call hierarchy | **Show Call Hierarchy** on a function to explore callers and callees |
| Type definition | **Go to Type Definition** on a value |
| Workspace symbols | **Go to Symbol in Workspace** to search project symbols |
| Signature help | **Trigger Parameter Hints** inside an argument list |
| Selection ranges | **Expand Selection** / **Shrink Selection** to follow syntax boundaries |
| Document highlights | Put the cursor on a symbol to highlight its uses in the current file |
| Inlay hints | Enable the client's inlay hints and supported TypeScript inlay-hint preferences |
| Code lens | Enable the client's code lens and TypeScript reference/implementation lens preferences |
| Linked editing | Enable linked editing to update paired JSX tags together |
| On-type formatting | Enable format-on-type for supported typed characters |

These are language-server capabilities, not a guarantee that every construct offers a result. A client must enable and support each feature; for `.ts` files that import `.vibe`, use the VibeLang TypeScript handoff described above.

## JSX highlighting

Write JSX in `.vibex` files. The extension selects its TSX-derived `source.vibex` grammar, with VibeLang scopes inside JSX expression containers. Tag names, attribute strings and JSX text keep their JSX meaning, including `%` in text. Use `x as T` for assertions and `<T,>` for unconstrained generic arrows, as in `.tsx`.
