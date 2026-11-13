# Other editors

Any editor with an LSP client can run VibeLang's language server, `vibelang --lsp --stdio`: the compiler the project installs as `node_modules/.bin/vibelang`. It serves the `.vibe`, `.vibex`, `.ts` and `.tsx` files selected by the project configuration. VibeLang discovers `vibe.config.json`, `tsconfig.json`, then `jsconfig.json`. It reports diagnostics on request, through LSP 3.17 pull diagnostics (`textDocument/diagnostic`). A client that only accepts pushed diagnostics, such as Claude Code's, declares `publishDiagnostics` without `diagnostic`; the server then publishes each open file's diagnostics after every open, change and save.

Retired `service class` and `layer` declarations report `EK0909` and `EK2121` as errors. Changing warning settings does not make either spelling valid. Edit these declarations explicitly.

## 1. Check the server

From the project directory, run:

```sh
npx vibelang --version
```

It prints `VibeLang 0.0.13 (TypeScript 7.1.0-dev)`.

## 2. Configure the LSP client

| Setting | Value |
| --- | --- |
| Command | `node_modules/.bin/vibelang --lsp --stdio`, or its absolute path if the client needs one |
| Files | `*.vibe` and `*.vibex`; add `*.ts` and `*.tsx` to serve TypeScript files too |
| Root marker | `vibe.config.json`, `tsconfig.json`, or `jsconfig.json` |
| Language id | `vibe` for `.vibe`, `vibex` for `.vibex`; `typescript` or `typescriptreact` for TypeScript |

If the server answers for `.ts` files, turn off the editor's other TypeScript server for the project, or both report every `.ts` file. JetBrains IDEs run the server through the LSP4IJ plugin.

## 3. Highlight .vibe files on GitHub

Add this line to the project's `.gitattributes`:

```text
*.vibe linguist-language=TypeScript
```

Named, top-level `module` declarations hold TypeScript bodies (VIP-40). Diagnostics in a body belong to the containing `.vibe` document; generated virtual filenames do not create a separate editor document. The server supports renaming across a body, finding references and organizing imports in a file containing one; identifier specifiers such as `from text` keep their module names. Find references on a module's name, at its declaration or a specifier, returns the declaration and each specifier, the names rename edits. Renaming a symbol the module's name merges with, such as an imported type of the same name, renames the specifiers too. Find References includes the same identifier imports and re-exports, and honors the client’s declaration filter. Renaming `import type { M }` leaves an independent `module M` and its identifier specifiers unchanged; references and document highlights also keep those bindings separate. Renames also recognize escaped identifiers such as `from \u0074ext`. While a `module` declaration is missing its name, renaming other bindings still works.

Find References includes all occurrences in large native TypeScript libraries and files containing module declarations, without the repeated scans that could stall these queries.

Bindings introduced by an `is` pattern in a `while`, `do…while` or `for` head support reference search and rename from either the declaration or a use. A condition that skips initialization through `||`, `&&` or `?:` keeps the same binding identity in the editor.

Reference search and rename include a parameter's declaration and its use as a destructuring source, including contextual names such as `source`, even when a default contains `do { }` or a `match` arm whose `do { }` returns from the function.

The `_` in a legacy `infer _` return annotation is an inference placeholder, so the server declines its rename. Ordinary generic parameters and conditional `infer` bindings remain renameable.

Reference search and rename include imported scalar types in `schema` fields and aliases, including type-only and namespace imports. They follow the written type binding used to select the codec.

For mapped library types in a schema, definition, type-definition and hover
queries follow the written type binding, including a type-only import alias.
An ordinary Schema value keeps its own definition and type information. These queries also support mapped generic types such as `Array<number>` and `ReadonlyMap<string, number>` in schema fields and aliases, including local and namespace declarations.

A `schema`, `error`, `schema error` or `data` declaration can share a line with the next declaration. Formatting preserves both declarations and their documentation, including a separately written schema type alias.
