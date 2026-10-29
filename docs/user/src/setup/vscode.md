# VS Code and Cursor

The `vibelang` package ships the editor extension `vibelang.vibelang` as `node_modules/vibelang/editor/vibelang.vsix`. The extension runs the project's compiler as the language server, `vibelang --lsp --stdio`, for diagnostics, hovers, definitions, references, renames, and completions. It works in VS Code 1.91 or later and in Cursor, and is not yet on the VS Code Marketplace or Open VSX.

## 1. Install the extension

On macOS, open the editor’s Command Palette and run **Shell Command: Install 'code' command in PATH** for VS Code or **Shell Command: Install 'cursor' command in PATH** for Cursor. Open a new terminal so the shell can find the command before continuing.

From the project directory, after installing dependencies, run the command for your editor:

```sh
code --install-extension node_modules/vibelang/editor/vibelang.vsix
cursor --install-extension node_modules/vibelang/editor/vibelang.vsix
```

## 2. Check the extension

```sh
code --list-extensions | grep vibelang
```

For Cursor, run `cursor --list-extensions | grep vibelang`. The output is:

```out
vibelang.vibelang
```

## 3. Open your project in the editor

Open the project directory and trust the workspace: the extension runs the workspace's `node_modules/.bin/vibelang`, so it does not run in an untrusted workspace. When it cannot find `vibelang`, the status item next to the language mode reads "vibelang not found".

VS Code's built-in TypeScript cannot resolve `.vibe` files, so if a `.ts` file imports a `.vibe` module, run **VibeLang: Serve TypeScript Files in This Workspace** from the command palette. In Cursor, the command turns the built-in TypeScript features off for the workspace; in VS Code, it shows the extension to disable, "TypeScript and JavaScript Language Features". Support for the new forms and adjacent `.d.vibe.ts` declarations arrives with the compiler's VIP implementation.

After updating `vibelang`, reinstall the extension from `node_modules`.

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

## Server settings and troubleshooting

| Setting | Default | Purpose |
| --- | --- | --- |
| `vibelang.server.path` | `""` | Override the compiler executable; relative paths start at the first workspace folder |
| `vibelang.server.typeScriptFiles` | `"auto"` | Serve TypeScript when the built-in server is off; `"on"` always serves it, `"off"` leaves it to the built-in server |
| `vibelang.trace.server` | `"off"` | Set `"messages"` or `"verbose"` to log LSP traffic |

After changing the executable or rebuilding the compiler, run **VibeLang: Restart Language Server** from the command palette. Use **VibeLang: Show Language Server Output** to inspect the server log. For protocol problems, enable tracing, restart, reproduce, then turn tracing off. Review logs before sharing them: protocol traffic can contain source text and file paths.
