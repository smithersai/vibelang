# Editor setup

Every editor runs the same language server: `vibelang --lsp --stdio`, the VibeLang compiler a project installs from `vibelang` (`node_modules/.bin/vibelang`). It serves the `.vibe` and `.ts` files of the program `tsconfig.json` describes: diagnostics with TypeScript and EK codes, hovers with inferred contracts, definitions, references, renames, and completions.

The server reports a file's diagnostics when the editor asks (LSP 3.17 pull diagnostics, `textDocument/diagnostic`), so the editor's LSP client must support pull diagnostics; VS Code, Cursor, Neovim 0.10 or later, and current Zed releases do.

| Editor | Setup | Tested |
| --- | --- | --- |
| VS Code, Cursor | The extension in [vscode/](vscode/README.md), shipped in `vibelang` as `node_modules/vibelang/editor/vibelang.vsix` | `bun run test` in `editors/vscode`, on VS Code 1.98.2 and 1.105.1 |
| Neovim 0.10 or later | [nvim/vibelang.lua](nvim/vibelang.lua) and the [tree-sitter grammar](tree-sitter-vibelang/), below | `editors/nvim/test.sh`, on Neovim 0.10.3 with nvim-treesitter `master` |
| Zed | Settings, below | No: Zed has no headless mode |

`.vibex` files contain JSX and use the TSX-derived `source.vibex` grammar in VS Code and Cursor. VibeLang forms are highlighted inside JSX containers; tag names, attribute strings and JSX text keep their JSX scopes.

## Neovim

Load `nvim/vibelang.lua` from your clone of this repository, so it finds the tree-sitter grammar in `tree-sitter-vibelang/` next to it. Add this line to `init.lua`, with your clone's path for `<vibelang checkout>`:

```lua
dofile(vim.fn.expand("<vibelang checkout>/editors/nvim/vibelang.lua")).setup()
```

`.vibe` and `.vibex` files then get the `vibe` and `vibex` filetypes, highlighting, and `vibelang --lsp --stdio` as their language server. The server is the project's `node_modules/.bin/vibelang`, else `vibelang` on `PATH`; `setup({ cmd = "/path/to/vibelang" })` names another. Neovim's built-in LSP client shows diagnostics, and its defaults give hover on `K`, go to definition on `<C-]>` (through 'tagfunc'), and completion on `<C-x><C-o>` (through 'omnifunc').

Highlighting uses the `vibe` parser once installed, else tree-sitter's TypeScript parser, else Vim's TypeScript syntax. The TypeScript parser reads VibeLang's forms, such as `A!E!R`, `match`, and `provide`, as errors. With [nvim-treesitter](https://github.com/nvim-treesitter/nvim-treesitter) (its `master` branch, for Neovim 0.10), `setup()` registers the grammar, so this command compiles it with your C compiler and installs it:

```vim
:TSInstall vibe vibex
```

Then reopen your `.vibe` and `.vibex` buffers. The `vibex` parser extends TSX; without it, `.vibex` falls back to the `tsx` parser or Vim’s `typescriptreact` syntax. Without nvim-treesitter, compile the parser into Neovim's `site` directory, from the repository root:

```sh
cd editors/tree-sitter-vibelang
mkdir -p ~/.local/share/nvim/site/parser
cc -o ~/.local/share/nvim/site/parser/vibe.so -shared -fPIC -Os -I src src/parser.c src/scanner.c
cc -o ~/.local/share/nvim/site/parser/vibex.so -shared -fPIC -Os -I vibex/src vibex/src/parser.c vibex/src/scanner.c
```

The highlight queries, `tree-sitter-vibelang/queries/vibe/*.scm`, inherit nvim-treesitter's TypeScript queries and color VibeLang's words in the same groups as the VS Code extension. If you copy `vibelang.lua` elsewhere, `setup({ grammar = "<vibelang checkout>/editors/tree-sitter-vibelang" })` names the grammar.

`setup({ typescript = true })` also attaches the server to `.ts` and `.js` files, so a `.ts` file that imports a `.vibe` module resolves it. Turn off your other TypeScript server (`ts_ls`, `vtsls`) for those projects first, or both report every `.ts` file.

`editors/nvim/test.sh` checks the configuration in a headless Neovim. It copies `typescript/vibelang/lsp-fixture` to a scratch project with `vibelang` installed, its Node launcher at `node_modules/.bin/vibelang` and the compiler under test as its native binary, and compiles the `vibe` parser. Without the parser, it checks that `.vibe` files fall back to TypeScript highlighting. With it, it checks the filetype and the `vibe` parser's highlighting, that the project's `vibelang` attaches, TS2322 and EK1003 diagnostics, a hover with the inferred contract and a call's success value, that valid fixture sources have no ERROR or MISSING node and the deliberately malformed pipe fixture retains its parse error, the capture of each VibeLang token in `forms.vibe`, such as `!!`, `match`, `when`, `catch`, and `provide`, and module declarations’ keywords, names, and identifier specifiers. With nvim-treesitter, it also checks that the `vibe` queries inherit its TypeScript queries, that they color module bodies as TypeScript, and that `:TSInstall vibe` builds the parser. It reads `NVIM`, `VIBELANG`, `EFFECT_NODE_MODULES`, `VIBELANG_RUNTIME`, `NVIM_TREESITTER` (default: lazy.nvim's checkout, if any), and `CC`.

## Tree-sitter grammar

`tree-sitter-vibelang/` extends tree-sitter-typescript's TypeScript and TSX grammars with the same VibeLang forms for `.vibe` and `.vibex`; `grammar.js` names each form's decision and the compiler's parser file. A module declaration (`module text { ... }`, D283) is a `module_declaration` whose body is a `statement_block` of tree-sitter-typescript's own nodes, so the inherited TypeScript queries color it as they color a `.ts` file, without a `typescript` injection. The grammar's `src/` is generated and committed, so editors compile the parser without Node. After changing `grammar.js` or `src/scanner.h`:

```sh
cd editors/tree-sitter-vibelang
npm ci
npm run generate
npm test
```

Expression statements follow TypeScript's lookahead restriction: parenthesize
an object or anonymous function used as a statement. The grammar reserves
TypeScript's `catch`, groups `a ?? b catch c` as `(a ?? b) catch c`, and
accepts the compiler parser's `!T` types, empty type parameter lists, and bare
`await` identifiers. The last three follow the pinned TypeScript parser where
the normative grammar appendix inherits TypeScript; accepting syntax here
does not imply that the compiler's checker permits it.

`npm test` checks that `src/` is what `grammar.js` generates, runs the corpus tests in `test/corpus/`, and parses every `.vibe` file in the repository (except failing compiler cases, `*.fail`, and files `scripts/corpus.mjs` lists as deliberately invalid) and every `vibe` block under `docs/`, failing on any ERROR or MISSING node. It also runs the parser-agreement focused regressions in `test/parser-agreement-regressions/`. `node scripts/corpus.mjs name=/path/to/dir` adds another directory's `.vibe` files.

The original fuzz regressions live in `tree-sitter-vibelang/test/property-regressions/`.
The property suite replays the seven repaired disagreements as passing tests and
compares generated programs, mutations, statement splices, Unicode projects,
precedence and recursive patterns against a parser-only compiler probe. Its
shared runner records a seed and shrunk input for reproducible failures.
`FC_SEED=42 npm test` gives a repeatable discovery seed. Two compiler-side
disagreements remain recorded: a tail `match` inside `do` without parentheses,
and an unnamed `module`. The grammar accepts the tail `match` and requires a name in a `module`
declaration, following the normative appendix.

## Zed

Zed defines languages through extensions, so these settings treat `.vibe` files as TypeScript and `.vibex` files as TSX and replace the binary of Zed's TypeScript server, `vtsls`, with `vibelang`. Put them in the project's `.zed/settings.json`, so other TypeScript projects keep `vtsls`:

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
      "language_servers": ["vtsls", "!typescript-language-server", "..."]
    },
    "TSX": {
      "language_servers": ["vtsls", "!typescript-language-server", "..."]
    }
  }
}
```

The path must be absolute; the `vibelang` that `scripts/setup.sh` links into `~/.local/bin` also works when written in full, such as `/Users/you/.local/bin/vibelang`. Zed then sends `.vibe` files with the language id `typescript`, which the server accepts, and the server serves the project's `.ts` files too. These settings are untested in Zed, which cannot run headlessly. An `initialize` request with `vtsls`-style initialization options, as Zed sends, succeeds against `vibelang`.

## Other LSP clients

Run `vibelang --lsp --stdio` for `*.vibe` files, with `tsconfig.json` as the root marker, and send either `vibe` or `typescript` as the language id. Add `*.ts` files to let the server answer for them too, and turn off the editor's other TypeScript server for the project. On GitHub, add `*.vibe linguist-language=TypeScript` to `.gitattributes`.
