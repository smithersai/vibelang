# Developer tools

Install `vibelang` in the project to use its formatter, lint integrations, or
build plugins with `.vibe` and `.vibex` files. Configure each tool to include
those extensions and exclude generated declaration sidecars.

The package ships TypeScript declarations for its public JavaScript entries.
A strict tool configuration can import them with `bundler` or `node16` module
resolution.

## Build entry points

Point your bundler's entries and source globs at the current filenames.
Include `.vibe` alongside `.ts`, and `.vibex` alongside `.tsx`. When
renaming a source, update config paths, including worker and SSR entries.

Write an explicit runner such as `Effect.runSync(main())` in the application
entry. For Node scripts that import VibeLang source, add
`node --import vibelang/register` to the launch command. Each child Node
process that imports source needs the preload too. A production command can
run the compiled JavaScript directly.

Use [Vite and Vitest](vite.md) with Vite. For other bundlers, use the matching
entry from [vibelang-unplugin](https://www.npmjs.com/package/vibelang-unplugin#configure).
For tsdown, add `vibelang()` from `vibelang-unplugin/rolldown` to the plugin list.

The Rolldown plugin excludes generated `.d.vibe.ts` sidecars from build
entries, including expanded `tsdown` entry globs. Array order and named
entry aliases stay as configured; `.ts` and `.vibe` sources still build.
Use the `.vibe` source when choosing a single entry.

In bundler watch mode, creating a missing relative source also triggers a rebuild. Rollup continues watching source, type-only dependencies and configuration after recovering from errors. This includes directory indexes and source imports written with their emitted `.js` extension. Vite and Rolldown watch builds also recover when the missing source is inside newly created nested directories. Set `VIBELANG_UNPLUGIN_DEBUG=1` to see missing source candidates, directory-watch registration and source-change acknowledgements.

Explicit `.vibex` imports work through `vibelang-unplugin`, including module queries and dependencies whose imports rewrite to `.js` or `.jsx`. The esbuild adapter applies the project's effective JSX settings when output preserves JSX and retains original source maps. Ordinary TypeScript sources keep their resolution priority when filenames share a stem.

With esbuild, importing a `.vibe` or `.vibex` module by absolute path and
relative path loads one copy. Default exports reached through a TypeScript
barrel share the same objects, classes, symbols and closure state.

Source maps in esbuild bundles keep original source filenames, including Unicode, spaces and literal `%` sequences, when Node prints mapped stack traces.

Existing `import.meta.hot.accept` dependency handlers keep updates inside the page and preserve its state when a VibeLang dependency changes. Ordinary TypeScript dependency updates continue through Vite's normal hot-reload handling.

Vite's `import.meta.glob`, `import.meta.env` and `import.meta.hot` work in `.vibe` modules with their Vite types. Include `"types": ["vite/client"]` in `compilerOptions` (alongside any other required types). Eager and lazy glob results keep Vite's overloads; Vite transforms the macros when it builds the module.

Diagnostics from source loaders retain their source details and exclude compiler file-list output.

For a custom compiler, set `VIBELANG_BINARY` to its native executable. Selecting the package's JavaScript launcher reports an error before another compiler starts.

Imports between `.vibe` modules preserve Unicode, spaces and literal `%` in file names through bundler builds. Use the original source name in the import. Literal JavaScript import names retain TypeScript's filename meaning. Importing `./créé.vibe` and `./cr%C3%A9%C3%A9.js` in the same module keeps the source and literal JavaScript file distinct.

A `.vibe` module's compiled JavaScript imports a TypeScript module by its emitted name, such as `./dep.js` for `./dep.ts`. With Rollup, Rolldown, Vite, esbuild, webpack and Rspack, plugins placed after `vibelang-unplugin` resolve the name the module wrote, such as `./dep.ts`, `./dep.tsx` or `./dep.mts`, as they do for a `.ts` importer, so a plugin that externalizes or replaces `./dep.ts` keeps working when its importer becomes `.vibe`. Bun plugins cannot pass a resolution on, so Bun's later plugins still see `./dep.js`.

For programmatic Rolldown builds, `vibelang-unplugin/rolldown` uses
Rolldown's `cwd` as its default compiler root. A plugin `project` path is
relative to that root. An explicit plugin `root` can select a different
compiler project; relative bundle entries still resolve from `cwd`.

For `Bun.build`, relative entries resolve from the process working directory.
The plugin's `root` and `project` options select the compiler configuration
without changing that entry directory.

## Paths to converted files

After renaming a module, update paths held as data, including subprocess
arguments, URLs, file selectors and configuration entries. Run your build
and tests from a clean output directory to check that the renamed modules
still reach their consumers.

## Prettier and Oxfmt

Install `vibelang` and configure Prettier's `plugins` with
`"vibelang/prettier"` (or pass `--plugin vibelang/prettier`). The plugin infers
`.vibe` and `.vibex` and delegates the entire file to the shipped dprint process plugin,
the same formatter used by `vibelang format --write`, the language server and `vibelang-format --write` and
`vibelang-format --check`. Prettier's `singleQuote` and `printWidth` decide
the quote style and line width; its other layout options do not alter the
result.

The dprint plugin recognizes both `.vibe` and `.vibex`; include `**/*.{vibe,vibex}` in a repository's dprint configuration. The `vibelang-format` companion discovers both extensions by default, along with `.ts`, `.mts`, `.cts` and `.tsx` files marked with `// @vibe`. It leaves unmarked TypeScript files unchanged. A `.vibex` file and a `.tsx` buffer marked with `// @vibe` use the host's TSX mode, including for language-server formatting.

For editor integrations, `formatSource(text, filePath)` from `vibelang/format` formats the supplied buffer even when its path is ignored or under `node_modules`. The full path selects the repository's style; the caller selects which buffers to format. A supplied `.ts`, `.mts`, `.cts` or `.tsx` buffer with the `// @vibe` directive uses VibeLang syntax, including JSX for `.tsx`, even if the saved file has no directive. Removing the directive restores TypeScript parsing. The Prettier plugin uses the same behavior and reports syntax errors in unsaved input. File-scanning commands apply their ignore rules when selecting files.

`vibelang-format` reads the same two settings from the repository's formatter
configuration, so `.vibe` files follow the style of its `.ts` files. It uses
the nearest configuration from the file's directory up to the repository's
root: `.oxfmtrc.json` or `.oxfmtrc.jsonc` (Oxfmt), `.prettierrc`,
`.prettierrc.json` or the `prettier` key of `package.json` (Prettier), or
`dprint.json` (its `typescript` `quoteStyle` and `lineWidth`). A `dprint.json`
also supplies its other options, as dprint applies them to `.ts` files: the
global `indentWidth`, `useTabs` and `newLineKind` and every option of its
`typescript` section, such as `trailingCommas`; without a `semicolons` (or
`semiColons`) option, `.vibe` files get `"asi"`. A setting the
configuration leaves out takes that formatter's default: width 100 for Oxfmt,
80 for Prettier, 120 for dprint, and double quotes. With no configuration,
files get double quotes and width 120. A Prettier configuration in another
form, such as `.prettierrc.yaml` or `prettier.config.js`, stops
`vibelang-format` with an error naming the file: format through Prettier with
`vibelang/prettier`, which reads every form. dprint 0.64.3 is installed
with the compiler; the pinned TypeScript Wasm plugin is downloaded and cached
on first use.

Use `vibelang-format --write` or `vibelang-format --check` for VibeLang
alongside your existing Oxfmt command. For dprint configuration, see
[Format with dprint](formatting.md).

## ESLint

![ESLint rules on .vibe files](/videos/eco-lint-eslint.mp4)

Add `.vibe` and `.vibex` to the file selection in your ESLint flat config
and use the `vibelang/eslint` parser for those files. The
[Devtools example](../getting-started/012-devtools.md#lint-and-build-integration)
shows a complete configuration. Use `vibelang -p` for type checking.

For `for concurrent`, the lint tree retains the written limit expression and item scope. Compiler-generated cache names are marked as synthetic, so scope rules inspect your own identifiers. The `8` in `for concurrent(8)` has the `Numeric` token kind.

TypeScript module bodies retain the stock lint parser's JSDoc type nodes and source ranges.

The lint parser reports `EK1010` for an unparenthesized throw expression before a comma. Write `[(throw error), value]`; the grouped form remains visible to lint rules.

Plain `error` payloads keep their fields and written methods and getters in the lint tree, including a payload field named `constructor`. Their source names, parameters and references still receive the ordinary rule checks.

## Knip

Put the compiler in a JavaScript or TypeScript Knip configuration.

```js
// knip.config.js
import vibelang from "vibelang/knip"

export default {
  compilers: { vibe: vibelang, vibex: vibelang },
  ignore: ["**/*.d.vibe.ts", "**/*.d.vibex.ts"]
}
```

Keep your existing entry points, project globs, and other compilers. Run Knip
from the package whose config it should read, or pass that config explicitly
with `--config`.

Default aliases such as `export default value` keep their named binding. Knip
can report the named and default exports as duplicates, matching TypeScript;
its unused-export findings and JSDoc tags keep their usual meaning.

## Oxlint

![Oxlint on .vibe files](/videos/eco-lint-oxlint.mp4)

Run stock Oxlint for TypeScript. For VibeLang sources, use the shipped
`vibelang/oxlint` API to run native rules on projected TypeScript and map
diagnostics back to the original files. Install Oxlint in the project.

```js
// lint-vibe.mjs
import { readFileSync } from "node:fs"
import { formatUnix, lintProjected } from "vibelang/oxlint"

const config = JSON.parse(readFileSync(".oxlintrc.json", "utf8"))
const { status, output } = await lintProjected({
  config,
  base: process.cwd(),
  paths: ["src"],
})
process.stdout.write(formatUnix(output.diagnostics))
process.exitCode = status
```

Run `node lint-vibe.mjs` from the project root. This example reads a strict
JSON config. Run ESLint with `vibelang/eslint` for source-tree rules and JS
plugins. If both passes carry the same rule, list its name in
`lintProjected`'s `elsewhere` option to disable it in the native pass.

### Native rules on the projected TypeScript

The native pass runs stock Oxlint on what TypeScript tooling sees. For each
module it runs:

```sh
vibelang --ts-projection src/app.vibe < src/app.vibe
```

The command reads the file's text from stdin and prints one JSON object: `text`,
the virtual TypeScript; `extension`; `mappings`, the span map back to the source;
and `diagnostics`. Like `--estree`, it takes one file and exits with status 2 on
a usage error. A form the checking projection leaves for an annotation takes its
value reading here, because only syntax matters to a linter.
The projected text imports its helper types from `vibelang/prelude`, shipped
with `vibelang`. Stock TypeScript can resolve those types in a consumer with
`vibelang`, `vibelang-runtime` and their pinned `effect` peer installed; no
content mapper package is required. Keep the virtual file in the source
project so its relative imports resolve. The projection is for source
inspection and checking, not executable JavaScript.

Module bodies keep their native lint checks when their members are re-exported,
including named, namespace and type-only re-exports.

`vibelang/oxlint` writes each `x.vibe` as `x.ts` and each `x.vibex` as `x.tsx` under
a temporary directory with the same relative paths, with the repository's
configuration at its root, and runs Oxlint there. So `overrides`,
`ignorePatterns` and `.gitignore` files select the same modules as for a
TypeScript twin, and type-aware rules read a program of projected modules when
the configuration turns on `typeAware`. Reports map back to the source's bytes,
lines and columns:

| Report | Result |
| --- | --- |
| Starts on source text | Reported at the source position |
| Starts on text the projection generated, such as `require-yield` on a lowered `function*` | Dropped |
| `no-unused-vars` on an `effect` import, which declarations keep | Dropped, as in `vibelang/eslint` |
| `no-unsafe-declaration-merging` where the source does not write both an `interface` and a `class` of that name, such as a `service` | Dropped |
| `no-unexpected-multiline` on the `(` of a `try (x)` at a line's start, and `no-unused-expressions` on the value of a `match` arm | Dropped |
| A module the projection leaves unparsable | A `vibelang(unprojected)` warning on that module, because it got no rules |

The native pass reports diagnostics. To apply an ESLint rule's own source
fixes, run `eslint --fix` with the VibeLang parser configured.

Existing `oxlint-disable`, `oxlint-disable-line`,
`oxlint-disable-next-line` and `oxlint-enable` comments keep their scope. A directive containing only a reason, such as `// oxlint-disable-next-line -- explanation`, follows the installed Oxlint release: the bridge checks whether that engine treats it as a blanket suppression. TypeScript rule names written as
`typescript/`, `typescript-eslint/` or `@typescript-eslint/` refer to the same
registered ESLint rule.
The bridge also recognizes ESLint directives and the native core/TypeScript
rule aliases they name. It adapts parsed comments without changing the user
file, string literals or source locations; unused directives remain quiet,
as in Oxlint by default.

## ast-grep

`vibelang-ast-grep [output]` compiles every parser declared by
`editors/tree-sitter-vibelang/tree-sitter.json` into one shared library.
The default output is `vibelang.dylib` on macOS and `vibelang.so` elsewhere;
`vibelang-ast-grep --help` prints the usage, and any other option exits with status 2.
The compiler npm release includes the manifest and each grammar's `src`
directory; a C compiler is required. Legacy packages with a single flat
parser remain supported.

Register the parser in `sgconfig.yml` under `customLanguages`. Use
`tree_sitter_vibe` with the `vibe` extension and `tree_sitter_vibex` with the
`vibex` extension. Point both at the shared library the command generated.
Add a rule for the matching custom language for each TypeScript or TSX rule
you also want to run on VibeLang source. Exclude generated sidecars from
TypeScript rules.

For ast-grep 0.50+, [custom language loading](https://ast-grep.github.io/advanced/custom-language.html)
requires `--custom-languages allow` or project trust.

## Bundlers inside tests

Install `vibelang-unplugin`. Before Node tests import Rolldown or esbuild,
preload `vibelang-unplugin/rolldown/register` or
`vibelang-unplugin/esbuild/register` with `node --import`. For example:

```sh
node --import vibelang-unplugin/esbuild/register --test
```

The preloads include the runtime loader and add the plugin to Rolldown
build/watch or esbuild build/context. esbuild's synchronous API has no
plugin support.

With Bun 1.4.2 or later, use those entries with `--preload` for literal ESM
bundler imports. For computed imports or CommonJS, pass the plugin explicitly.
For `Bun.build` use `vibelang-unplugin/bun/register`. Configure the preload
for each child process that runs the tests. See [Bun builds](vibelang-cli.md#builds-inside-bun-scripts-and-tests)
for the configuration.

## Metro, Babel and the React Compiler

Tools that read one file at a time, such as Metro, Babel and Oxc, cannot parse
a `.vibe` module. Three entry points hand them the module's JavaScript from
the project's compile and move the parsed syntax tree back to `.vibe`
positions, so diagnostics and source maps name `.vibe` lines:

- `vibelang/metro`: `withVibeLang(config)` around the config that
  `metro.config.cjs` exports. Metro resolves `.vibe` and `.vibex` modules and
  their `module` declarations, and the app's own Babel transformer receives
  their JavaScript. See [React Native and Metro](react-native.md).
- `vibelang/babel`: a Babel preset, listed last, for a tool that runs Babel
  on a file itself, such as babel-jest or a React Compiler coverage test.
- `toolArguments(filename, text, options)` from `vibelang/emit`: the
  arguments for a `transform(filename, text, options)` API such as
  oxc-transform-react.

The React Compiler sees JavaScript. On a `.vibe` module's JavaScript it
reports the same diagnostics and writes the same output as on the module's
`.ts` twin.

`vibelang` declares Metro and Babel as optional peers. For Vite projects
using the React Compiler, include `.vibe` in `@vitejs/plugin-react`'s file
filter when those modules need the React transform.

## Published packages

Publish the build's ordinary `.js` and `.d.ts` files. Point published
`types` conditions at the built declarations. Exclude compatibility
sidecars such as `*.d.vibe.ts` and `*.d.vibex.ts` when you publish compiled
output. Run `npm pack --dry-run` to check the file list.

## Last resort: keep TypeScript file names

Use the compiler, plugins and editor integrations above with `.vibe` and `.vibex` files whenever possible. A project that cannot rename its TypeScript files can consider the experimental [TypeScript shim](typescript-shim.md) as the final fallback. Stock readers can accept marked files with different meaning; read the shim's limitations first.
