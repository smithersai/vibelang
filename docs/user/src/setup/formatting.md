# Format with dprint

An explicit file path or glob pattern that matches no files makes the format command fail before writing any files. Check the spelling and quote glob patterns so the formatter receives them intact. Running without paths may find no files and succeed.

[dprint](https://dprint.dev) formats `.vibe` files through the `vibelang` package's dprint plugin. The plugin writes each `.vibe` file as TypeScript, has dprint's TypeScript plugin format it, and writes the result back as VibeLang, so `.vibe` and `.ts` files follow the same `typescript` settings of the project's dprint configuration. Install the packages with [Add VibeLang to an existing project](existing-project.md) first.

![vibelang format with dprint](/videos/eco-format.mp4)

## 1. Install dprint

Use dprint 0.64.3 or later, the minimum supported version for this configuration. dprint 0.50.2 cannot resolve `npm:vibelang/dprint-plugin.json`. The alpha review verified it with 0.64.3.

```sh
npm install --save-dev dprint@0.64.3
```

## 2. Configure dprint.json

Add `vibe` to `includes` and the plugin `npm:vibelang/dprint-plugin.json` to `plugins`. If the project has no `dprint.json`, create this one:

```json
{
  "includes": ["**/*.{ts,vibe}"],
  "excludes": ["**/node_modules", "**/dist", "**/*.d.ts", "**/*.d.vibe.ts", "**/*.d.vibex.ts"],
  "lineWidth": 120,
  "indentWidth": 2,
  "typescript": {
    "semicolons": "asi",
    "quoteStyle": "alwaysDouble"
  },
  "plugins": [
    "https://plugins.dprint.dev/typescript-0.97.1.wasm@3be85494ff8141c412535e659cbe3d764ed3a740375c929be48393ed20a9d429",
    "npm:vibelang/dprint-plugin.json"
  ]
}
```

The last three `excludes` keep dprint off the declarations the compiler writes beside each `.vibe` source, `x.d.vibe.ts` and the forwarding `x.d.ts` (see [Let TypeScript tools read .vibe modules](vibelang-cli.md#let-typescript-tools-read-vibe-modules)). Each build rewrites them in TypeScript's declaration style, so formatting them makes `dprint check` fail again after the next build. dprint also skips every file `.gitignore` lists. A project that keeps its declarations in an ignored [`vibe.sidecarDir`](vibelang-cli.md#keep-the-sidecars-in-one-directory) folder can remove `"**/*.d.ts"` to format its hand-written `.d.ts` files.

dprint finds the plugin in `node_modules/vibelang` from `dprint.json`'s directory, so the configuration needs no checksum for it. The plugin's executable is the native compiler: the manifest names the platform package that holds it, such as `vibelang-linux-x64`, with that package's tarball checksum; dprint downloads the tarball from the npm registry once, checks it, and caches it. List the TypeScript plugin too: the VibeLang plugin formats with it. The VibeLang plugin has no settings; put style settings under `typescript`.

If your project requires a checksum on every plugin, keep its pinned plugin list and run `vibelang-format --write` after `dprint fmt`, or `vibelang-format --check` after `dprint check`. Migration setup wires these commands automatically. If no plugins are configured, it supplies a pinned TypeScript plugin and uses the same command pair. When rerun after an older setup, it removes the old `npm:vibelang/dprint-plugin.json` entry and preserves the pinned plugins and their order.

## 3. Format and check

```sh
npx dprint fmt
npx dprint check
```

`dprint fmt` rewrites unformatted files. `dprint check` changes nothing: it prints a diff per unformatted file and exits with status 20, so a CI step or `lint` script fails on a file that needs formatting. Run `npx dprint check` again after `npx dprint fmt`: it prints nothing and exits with status 0.

## Marked TypeScript files

For `.ts`, `.mts`, `.cts` and `.tsx` files with the `// @vibe` directive, use `vibelang format`. It reads the directive before selecting the parser; direct dprint selects a plugin by the filename alone.

```sh
npx vibelang format --check
npx vibelang format --write src/view.tsx
```

Default discovery includes marked `.tsx` files as well as the other marked TypeScript extensions and `.vibe`/`.vibex` files. `--check` exits with status `1` when formatting is needed and writes nothing; `--write` updates the selected files. Unmarked TypeScript files remain unchanged, including explicit paths.

For `vibelang format` and `vibelang-format`, an explicit path to an existing file selects that file before interpreting glob characters. This includes bracketed route folders. Quote a path such as `vibelang-format --write 'src/[id]/page.vibe'` to pass it unchanged through the shell. A pattern with no literal file of that name still expands to matching files, and discovery exclusions still apply.

## What the formatter changes

Everything dprint's TypeScript plugin changes in a `.ts` file: indentation, line breaks at `lineWidth`, quotes, semicolons, and trailing commas. Import and re-export declarations keep their original order, so formatting preserves module initialization order. The names within one import or export keep their order too, so a linter's `sort-imports` rule sees the order you wrote. VibeLang's own forms keep their shape:

| Form | Formatted as |
| --- | --- |
| `A!E!R`, patterns after `when` and `is` | As written; line breaks around them follow the surrounding code |
| `match (x) { when P: v; ... }` | Arms as object-literal properties: one line when written on one line and they fit, else one per line, each ending in `;` |
| `provide X { ... }`, `uninterruptible { ... }` | The block as a block statement |
| `x catch (e) => y`, `x \|> f(%)` | Like a method call and the `\|\|` operator: a line break before `catch` or `\|>` stays |
| `fork x`, `join x`, `throw x` | Like a prefix operator such as `void` |
| `error`, `schema`, `data` | The body as an object type: one line when written on one line and it fits |
| `service` | The body as a class body, one member per line |

The bundled formatter uses TypeScript plugin `0.97.1` for `.vibe` files. It keeps the compatible `0.93.4` plugin for `.vibex` and marked `.tsx` files; use `vibelang format` for those files. Older plugin versions can fail to reach a stable layout for adjacent conditional statements. In a direct dprint configuration, use the pinned plugin above and the `semicolons` option spelling.

Service members and class-form `error` fields accept comma separators. Formatting preserves these separators, nested type commas and comments on either side of a separator.

A standalone `do` expression keeps the parentheses that distinguish it from a `do`/`while` statement: `(do { 1; });`. The same grouping is preserved in a function, a conditional body or a labeled statement. After a statement whose semicolon the formatter removes, as with `semicolons: "asi"`, it is written `;(do { … })` so that the parentheses cannot continue that statement.

A `provide` list never wraps at a comma between providers. Line breaks inside a provider expression are allowed; the opening `{` stays on the line where the final provider ends.

Pattern expressions in classic `for (init; test; update)` heads, including bindings introduced by `is`, keep their original head position and parse when formatted. The formatter keeps `is` on the same line as its subject and the start of its pattern, including when a narrow print width or the `operatorPosition` setting wraps the condition.

A statement-level `match` keeps its boundary after a statement without a semicolon, including with `semicolons: "asi"`. Parenthesized `return (match …)` expressions and binding `is` branches keep the grouping and braces needed to preserve their parsed structure. When a host writes a braced single-statement body of a binding `is` without braces, the formatter restores the block on its own lines.

Written parentheses and their enclosed comments in return-type annotations stay in place, including nested and generic function types. For example, `(): (() => string)` keeps that return-type grouping in its `.d.ts` output. Computed field and type-member keys also keep their written parentheses and enclosed comments: changing `[(key)]` into `[key]`, or `[(keys).value]` into `[keys.value]`, can change TypeScript's native key diagnostics.

A label on an arrow expression keeps that expression as its body, including with `semicolons: "asi"`.

An empty statement inserted before an expression inside `do`, such as the `;` in `;[1]` under `semicolons: "asi"`, preserves the block's completion value and is accepted by the program-preservation check.

Formatting may remove empty `;` members from native `class`, `error` and `schema error` bodies. A member with JSDoc keeps its `;`, so `@internal` and `@throws` remain attached to the same member.

Comments and JSDoc stay associated with their code, including compiler, linter and tool directives. Adding space between a contract and its initializer, such as `User!!= load()` becoming `User!! = load()`, preserves those associations elsewhere in the file. Formatting is idempotent: a formatted file doesn't change when formatted again. This includes `data`, `schema` and field-only `error` declarations with an opening brace on the next line. This includes `data`, `schema` and `error` declarations whose opening brace starts on the next line.

A standalone `;` with JSDoc keeps its semicolon, so `@internal`, `@throws` and other tags retain their original target.

Under the same compiler/options, formatting preserves parsed program meaning, evaluation order, receivers, ordinary runtime values/effects and public types/declarations/throws contracts. Diagnostic codes, categories and occurrences stay the same; locations and quoted source follow the formatted file. Semantic changes are explicit source edits; formatting does not apply diagnostic repairs.

Normal quote, grouping, comma and layout styling may change emitted JavaScript bytes. `Function.prototype.toString`, generated source text, offsets and stack presentation may reflect the formatted text. Ordinary strings/data, tagged-template raw/cooked values, regex meaning, function names/lengths, property names and directive semantics must stay the same: an escaped string must not become an actual `use strict` directive. Compiler-generated source-map and declaration-map provenance, including `sourcesContent`, is refreshed for the formatted file.

A recovered module declaration with no name, such as `module { export const value = 1 }`, formats its TypeScript body and keeps the missing-name diagnostic `EK4003`. Formatting never supplies the missing name. This recovery applies at the top level; a nested module declaration or an unparsable module body is still reported without formatting.

Formatting keeps diagnostics, including `EK0101` for `async f()` and `effect f()` declarations without `function`. Write the missing keyword: `async function f()` or `effect function f()`.

Commas between fields in `error` and `schema error` declarations remain commas after formatting, including beside methods and getters. Commas in tuple types and expressions follow the TypeScript formatter.

## What the formatter refuses

The plugin reports the file and leaves it unchanged when:

- the file has a syntax error, reported as `vibelang format: line:column: message`. This includes a `match` arm without its `;` (`EK0701`), because formatting would otherwise remove the error;
- formatting would attach or remove JSDoc metadata, such as making an inline `@internal` comment hide a payload from a `.d.ts` file; choose whether the comment should apply before formatting.
- formatting would change the program, a plugin bug: report it with the file.

This check also covers ordinary `/* @internal */` comments on fields, methods and accessors. Parameter comments follow the compiler's parameter attachment rules; a line break that keeps the same meaning can still format.

The formatter commands and `formatSource` include the original file path before a formatting failure, including an error from dprint that names no file. Marked TypeScript files retain their written `.ts`, `.tsx`, `.mts` or `.cts` path in the message. A refused file keeps its original bytes.

Comments between ordinary TypeScript `try`/`catch`/`finally` clauses are supported and follow dprint’s TypeScript formatting.

Comments between `catch` and its literal handler are preserved, including line comments.

Comments between `effect` or `do` and the opening `{` stay with that block. For a `do` block, a line comment before `{` keeps its line break.

Files containing the Unicode line and paragraph separators, `U+2028` and `U+2029`, keep stable indentation when formatted in the editor.


## From a VibeLang checkout

`sh scripts/build-vibelang.sh` builds the compiler and writes the plugin beside it: `packages/compiler/dprint-plugin.json`, which names a zip archive of the compiler in `packages/compiler/native/`. A project whose `node_modules/vibelang` links to the checkout formats with the freshly built compiler. `vibelang --write-dprint-plugin <directory>` writes the plugin for another copy of the package. Overlapping builds of the same compiler prepare separate temporary archives; one build cannot remove or overwrite another build's temporary archive.

## The editor

VibeLang has one formatter (VIP-34). A JSDoc comment before a parenthesized assignment stays attached to that expression; an automatically inserted `;` does not take the comment.

The language server's `textDocument/formatting`, `textDocument/rangeFormatting` and `textDocument/onTypeFormatting` requests format the current editor text, saved or not, through the same formatter as `vibelang format`, `vibelang-format` and `vibelang/prettier`. All of them read the nearest Oxfmt, Prettier or dprint configuration for the file's quote style and print width, and a `dprint.json`'s other TypeScript options too ([Developer tools](developer-tools.md)), and the package supplies the VibeLang plugin itself; without a configuration they use double quotes and width 120. The formatter resolves the installed package’s plugin from the package itself with npm, Bun or pnpm, including when the editor’s working directory is outside the project. When the native platform package is installed locally, the formatter prepares its process plugin from that binary without downloading its version from npm. This supports unpublished local tarball installs and read-only package directories; temporary plugin files stay outside the installed package. Direct `dprint` configurations keep the registry references described above. A file the formatter refuses is left as it is and the editor shows the error.

`vibelang format --write` formats `.vibe` and `.vibex` files with the shared formatter; `vibelang format --check` reports files that need formatting without writing them. `vibelang format --help` lists the options. Both accept file paths or glob patterns. Both batch `.vibe`, `.vibex` and marked TypeScript files with dprint once per quote style, width and core, and remember the file contents dprint left unchanged, so a check of a clean tree starts no dprint. `VIBELANG_DISABLE_CACHE=1` turns that memory off and `VIBELANG_CACHE_DIR` moves it, as for the compile cache. Cached checks validate each file's syntax kind, so clean plain VibeLang cannot hide a JSX error in a `.vibex` or marked `.tsx` file.

Both formatting commands report missing explicit files, unmatched explicit glob patterns, unknown options and conflicting `--check` and `--write` modes before changing any file. A default scan with no matching source files succeeds. Use `--` before paths that begin with `-`. The companion's `vibelang-format --help` lists the same options.

## Prettier, Oxfmt and migration

The compiler also ships `vibelang/prettier` and `vibelang-format`. See [Developer tools after migration](developer-tools.md) for the integrations, their shared formatter, and how migration extends existing checks.

The Prettier plugin formats the supplied buffer even when its path matches an ignore rule, and reports syntax errors in unsaved input. File-scanning commands select files using their ignore rules.

JSX lives in `.vibex` files. The shared formatter sends their encoded source to the host's TSX formatter, preserving JSX text, entities and comments in containers. JSX text keeps its written form, including a `{" "}` space, when the host formatter writes that space as text or wraps a line with one. Use `x as T` for an assertion and `<T,>(x: T) => x` for an unconstrained generic arrow, as in `.tsx`. The formatter keeps the comma that distinguishes the arrow from JSX.
