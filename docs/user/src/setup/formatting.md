# Format with dprint

[dprint](https://dprint.dev) formats `.vibe` files through the `vibelang` package's dprint plugin. The plugin writes each `.vibe` file as TypeScript, has dprint's TypeScript plugin format it, and writes the result back as VibeLang, so `.vibe` and `.ts` files follow the same `typescript` settings of the project's dprint configuration. Install the packages with [Add VibeLang to an existing project](existing-project.md) first.

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
  "excludes": ["**/node_modules", "**/dist"],
  "lineWidth": 120,
  "indentWidth": 2,
  "typescript": {
    "semiColons": "asi",
    "quoteStyle": "alwaysDouble"
  },
  "plugins": [
    "https://plugins.dprint.dev/typescript-0.93.4.wasm@cdbf74066391bdb11ddaef9ea95299636a97d637f5a9bf7f121d584875647c7a",
    "npm:vibelang/dprint-plugin.json"
  ]
}
```

dprint finds the plugin in `node_modules/vibelang` from `dprint.json`'s directory, so the configuration needs no checksum for it. The plugin's executable is the native compiler: the manifest names the platform package that holds it, such as `vibelang-linux-x64`, with that package's tarball checksum; dprint downloads the tarball from the npm registry once, checks it, and caches it. List the TypeScript plugin too: the VibeLang plugin formats with it. The VibeLang plugin has no settings; put style settings under `typescript`.

## 3. Format and check

```sh
npx dprint fmt
npx dprint check
```

`dprint fmt` rewrites unformatted files. `dprint check` changes nothing: it prints a diff per unformatted file and exits with status 20, so a CI step or `lint` script fails on a file that needs formatting. Run `npx dprint check` again after `npx dprint fmt`: it prints nothing and exits with status 0.

## What the formatter changes

Everything dprint's TypeScript plugin changes in a `.ts` file: indentation, line breaks at `lineWidth`, quotes, semicolons, and trailing commas. Import and re-export declarations keep their original order, so formatting preserves module initialization order. The names within one import or export keep their order too, so a linter's `sort-imports` rule sees the order you wrote. VibeLang's own forms keep their shape:

| Form | Formatted as |
| --- | --- |
| `A!E!R`, patterns after `when` and `is` | As written; line breaks around them follow the surrounding code |
| `match (x) { when P: v; ... }` | Arms as object-literal properties: one line when written on one line and they fit, else one per line, each ending in `;` |
| `provide X { ... }`, `uninterruptible { ... }` | The block as a block statement |
| `x catch (e) => y`, `x \|> f(%)` | Like a method call and the `\|\|` operator: a line break before `catch` or `\|>` stays |
| `fork x`, `join x`, `throw x` | Like a prefix operator such as `void` |
| `error`, `schema` | The body as an object type: one line when written on one line and it fits |
| `service` | The body as a class body, one member per line |

Support for the new forms arrives with the compiler's VIP implementation.

A statement-level `match` keeps its boundary after a statement without a semicolon, including with `semiColons: "asi"`.

Comments and JSDoc stay associated with their code, including compiler, linter and tool directives. Formatting is idempotent: a formatted file doesn't change when formatted again.

Under the same compiler/options, formatting preserves parsed program meaning, evaluation order, receivers, ordinary runtime values/effects and public types/declarations/throws contracts. Diagnostic codes, categories and occurrences stay the same; locations and quoted source follow the formatted file. Semantic migrations and diagnostic repairs belong to `vibelang --fix` or editor actions.

Normal quote, grouping, comma and layout styling may change emitted JavaScript bytes. `Function.prototype.toString`, generated source text, offsets and stack presentation may reflect the formatted text. Ordinary strings/data, tagged-template raw/cooked values, regex meaning, function names/lengths, property names and directive semantics must stay the same: an escaped string must not become an actual `use strict` directive. Compiler-generated source-map and declaration-map provenance, including `sourcesContent`, is refreshed for the formatted file.

## What the formatter refuses

The plugin reports the file and leaves it unchanged when:

- the file has a syntax error, reported as `vibelang format: line:column: message`;
- formatting would change the program, a plugin bug: report it with the file.

Comments between ordinary TypeScript `try`/`catch`/`finally` clauses are supported and follow dprint’s TypeScript formatting.

Comments between `catch` and its literal handler are preserved, including line comments.


## From a VibeLang checkout

`sh scripts/build-vibelang.sh` builds the compiler and writes the plugin beside it: `packages/compiler/dprint-plugin.json`, which names a zip archive of the compiler in `packages/compiler/native/`. A project whose `node_modules/vibelang` links to the checkout formats with the freshly built compiler. `vibelang --write-dprint-plugin <directory>` writes the plugin for another copy of the package.

## The editor

VibeLang has one formatter (VIP-34): the language server's formatting, `textDocument/formatting`, the dprint plugin and the Prettier and Oxfmt plugins all run it, so the editor and your format command agree.

## Prettier, Oxfmt and migration

The compiler also ships `vibelang/prettier` and `vibelang-format`. See [Developer tools after migration](developer-tools.md) for the integrations, their shared formatter, and how migration extends existing checks.
