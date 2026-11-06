# Replacing TypeScript with VibeLang in a project

Research for [VIP-42](../design/vips/0042-vibelang-in-ts-files-open.md). Observed 2026-11-05. Package versions are npm `latest` on that date; `Effect-TS/tsgo` is at `bf34a20`, and TypeScript's sources are this repository's fork at upstream `257e874`.

## Summary

Effect changes TypeScript in two ways. For TypeScript 5 and 6, `@effect/language-service patch` rewrites `lib/typescript.js` and `lib/_tsc.js`. For TypeScript 7, `effect-tsgo patch` replaces the native `tsc` executable inside `node_modules`, and `effect-tsgo tsc` runs a patched build without touching `node_modules`. No JavaScript hook exists on TypeScript 7: `ts-patch`, Volar and every source-rewriting tool stop at TypeScript 6, and a content mapper can't claim `.ts`. So VibeLang in a `.ts` file needs another compiler at the path that launches `tsc`. An npm alias puts it there with no write to `node_modules` after install. It survives `npm ci --ignore-scripts`, read-only trees and pnpm, and removal is one dependency change. Bundlers don't go through TypeScript at all, so they stay on the existing plugins.

## How the prior art works

| Tool | Version | How it changes TypeScript | Source |
| --- | --- | --- | --- |
| `@effect/language-service` | 0.87.5 | `effect-language-service patch` rewrites `node_modules/typescript/lib/typescript.js` and `lib/_tsc.js`. `unpatch` reverts it, and `check` reports it. The README recommends a `prepare` script so an install reapplies it, and tells TypeScript 7 users to use `@effect/tsgo` | `README.md`, `cli.js` |
| `@effect/tsgo` | 0.67.4 | `patch` finds `@typescript/typescript-<platform>-<arch>/lib/tsc`, renames it to `tsc.original`, copies a packaged build over it and sets its mode. A hash skips a file already patched. `unpatch` renames it back. An unlisted TypeScript version is an error naming the supported ones: `7.0.2`, `7.1.0-beta`, `7.1.0-dev.20261105.1` | `_packages/tsgo/src/patcher/index.ts`, `discovery.ts` |
| `effect-tsgo tsc` | 0.67.4 | Runs the patched build and leaves `node_modules` alone. The README says `patch` "is not possible (or not desirable) with shared or read-only package stores, such as the pnpm global virtual store, Yarn PnP or Nix", and to prefer `patch` "when other tools must keep launching the stock binaries" | `README.md` |
| `ts-patch` | 4.0.1 | TypeScript 6 and later. Live compiler `tspc`, or a persistent patch of `typescript.js` and `tsc.js`. `tsserver.js` isn't a persistent target on TypeScript 6. On the Go compiler: "ts-patch will evaluate that implementation as a separate compatibility track" | `README.md` |
| `vue-tsc` | 3.3.14 | `@volar/typescript`'s `runTsc` reads `typescript/lib/tsc`, rewrites its JavaScript source and compiles it with `Module#_compile`. When `typescript` is aliased to `@typescript/typescript6`, it follows the alias to `@typescript/old/lib/tsc` | `index.js`, `lib/quickstart/runTsc.js` |
| `svelte-check` | 4.7.8 | Wraps TypeScript's JavaScript API. Peer `typescript` `^5.0.0 \|\| ^6.0.0` | `package.json` |
| `ngc` | `@angular/compiler-cli` 22.2.4 | Wraps TypeScript's JavaScript API. Peer `typescript` `>=6.0 <6.1` | `package.json` |

## TypeScript 7

`typescript@7.1.0-beta` has no compiler in JavaScript:

- `bin/tsc` imports `lib/tsc.js`, which calls `lib/getExePath.js` and replaces the process with `process.execve`. The executable is `lib/tsc` in `@typescript/typescript-<platform>-<arch>`, an optional dependency.
- `exports["."]` is `lib/version.cjs`, which holds `version` and `versionMajorMinor`. The API is `typescript/sync` and `typescript/async`, which talk to the executable.
- VS Code's extension (`packages/vscode-typescript/src/util.ts`, `resolveTsdkPathToExe`) reads `package.json` at the tsdk path. A package named `typescript` needs the bin `tsc` and a platform package. Any other name needs the bin `tsgo` and a platform package under `@typescript/`. Failing those, it looks for an executable named `tsc` or `tsgo` in the tsdk directory itself. A workspace tsdk needs workspace trust and the user's opt-in.
- Content mappers can't take `.ts`: `TS18066`, "Content mapper file extension '{0}' is a built-in extension and cannot be registered by a content mapper" (`tsoptions/contentmappers.go`).

Bundlers and runners never load TypeScript for `.ts`: Vite 8 uses Oxc, esbuild and `tsx` use esbuild's parser, and Node.js uses its type stripper. `ts-node` needs TypeScript's JavaScript API.

## Design twice

**A: alias.** `npm install --save-dev typescript@npm:vibelang-typescript@7.1.11`. The package has the bin `tsc`, the export `.`, and a dependency on `vibelang`.

**B: patch.** A `prepare` script copies the VibeLang binary over `@typescript/typescript-<platform>-<arch>/lib/tsc`, as `effect-tsgo patch` does.

| | A: alias | B: patch |
| --- | --- | --- |
| `tsc` | Runs VibeLang | Runs VibeLang |
| `tsc --lsp --stdio`, VS Code native extension | Runs VibeLang. VS Code finds `lib/tsc` in the package, on macOS and Linux | Runs VibeLang through the stock path, on every platform |
| `typescript/sync` and `typescript/async` | Not exported: `ERR_PACKAGE_PATH_NOT_EXPORTED` | Stock JavaScript against the VibeLang binary |
| Vite, esbuild, `tsx` | Unchanged: need a plugin or a loader | Unchanged: need a plugin or a loader |
| Monorepos | One `overrides` entry at the root | Each installed copy of `typescript` needs patching |
| Lockfile | Records the compiler. A reviewer sees it | Records stock TypeScript, which is not what runs |
| `npm ci` | Reproduces the compiler | Restores stock `tsc`, then needs `prepare`. `--ignore-scripts`, the CI default in many repositories, leaves stock `tsc` |
| Read-only and shared stores | Work: nothing writes after install | Refused, as Effect's README says |
| Upgrades | A version bump | The binary must match every `typescript` version a user can have. VibeLang is one fork of one TypeScript commit, so `tsc --version` and the installed package would disagree |
| Removal | One dependency change, and the lockfile returns to stock | `unpatch`, or a reinstall, plus the `prepare` script |

**Choice: A.** Effect needs B because its build sits on several TypeScript versions and other tools must launch stock paths. VibeLang replaces the compiler whole and pins one TypeScript, so the alias says what happens, in the lockfile. The cost is the TypeScript JavaScript API, which only matters to a tool that already works on TypeScript 7, and VS Code on Windows, which needs an `.exe` at the tsdk path. Both have a route: a project with that need keeps `.vibe` files and `vibelang`.

The package's version is TypeScript-shaped. npm applies peer ranges to an alias's target, so `0.0.11` fails `>=5`, and a prerelease such as `7.1.0-vibelang.11` fails it too.

## Opt-in

The compiler's question "is this file VibeLang?" had one answer, by extension, at every site. VIP-42 adds a second answer for parsed files. `ast.SourceFile.IsVibeLang()` is the file's name or its directive, and it replaces the name test wherever the question is what a file means. Sidecars, `module` declarations and `$entry` keep asking about the name.

## Twin sweep

Each of the 3,190 compiler cases compiled twice: as written, and with each `.vibe` renamed `.ts` behind the directive, each `.vibex` renamed `.tsx`, and specifiers rewritten.

| Result | Cases |
| --- | --- |
| Same codes, same statements | 2,924 |
| Same codes. Output differs by the `$entry` runner and its imports, the rewrite helper this comparison turned on, or a line break | 45 |
| `module` declarations, on purpose: `TS1540` in the twin | 135 |
| The `$entry` runner's own rules, on purpose: `EK3205` and `EK3206` in the `.vibe` file only | 13 |
| Declaration sidecars, or files the comparison pulled in by renaming, such as a `.ts` reference file | 21 |
| Skipped: no `.vibe` file, or a `.vibe` file beside a `.ts` file of the same stem | 52 |

The sweep found one bug, which VIP-42's first commit fixes: a derived service key kept the `.ts` of the file name. `typescript-shim/test/twin.test.mjs` keeps a sample of the sweep.

## Stock readers

Of the 3,510 `.vibe` files in the cases, TypeScript 6's parser accepts 627, 372 of them outside failing cases. Comparing `ts.transpileModule` with the compiler's output for those 372: 266 are identical, 30 differ only in imports the compiler adds, 31 emit nothing to compare, and 45 differ. Those 45 are `module` declarations, the `$entry` runner, `.vibex` under a different `jsx` setting, script or module detection, and a compiler-written name for `Effect`'s `Array` and `String` modules. VIP-42 makes the first two TypeScript's. Compiler-added imports can cause `TS2304` or `ReferenceError` in a stock reader, but that is not guaranteed. For `// @vibe\nexport const request = Request`, stock TypeScript with the DOM library and VibeLang both compile successfully: stock exports the web constructor, while VibeLang exports `effect/Request`. The emitted declarations and runtime values differ. [VIP-42's open prelude question](../design/vips/0042-vibelang-in-ts-files-open.md#open-question-prelude-bindings-in-marked-typescript) records the full reproduction.

## Measurements

| Probe | Result |
| --- | --- |
| `typescript` aliased to a `0.1.2` package, then a required peer `typescript >=4.8.4` | `ERESOLVE` |
| `typescript` aliased to `7.1.0-beta`, then that peer | `ERESOLVE` |
| `typescript` at a stable `7.x`, then that peer | Installs |
| Design B: copy the binary over `lib/tsc`, then `npm ci --ignore-scripts` | `tsc --version` prints `Version 7.0.2` again |
| Design A: `npm ci --ignore-scripts`, then a tree with no write permission | `tsc` still runs VibeLang |

`scripts/release/check-typescript-shim.sh` runs Design A from a registry: a fresh `create-vite` project, `tsc`, the language server, Vite, a clean install, a read-only tree, a peer range, a nested stock TypeScript, uninstalling, a monorepo override, and pnpm.

## What this doesn't cover

- `.tsx` through `vibelang format` and the editor's format command.
- Bun's bundler and test runner, and Metro.
- ESLint, Oxlint and Prettier reading a `.ts` file with the directive.
- VS Code itself: its discovery code ran against an installed project, but no editor window did.
