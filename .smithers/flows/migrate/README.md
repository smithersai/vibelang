# The migrate flow: an Effect TypeScript codebase to VibeLang

The migrate flow moves an existing Effect TypeScript codebase to idiomatic VibeLang the way a codemod would: in small planned batches, mechanically wherever a rule can do the work, with an agent only where none can, and gated on the target's own tests and public API. Every run also produces the list of what the codemod could not do and what VibeLang got wrong, which is how the next run gets better.

```text
upgrade-effect ──▶ setup ──▶ plan ──▶ for each batch: codemod ──▶ compile ──▶ repair ──▶ verify ──▶ record ──▶ report
(no model)        (no model) (agent)                 (no model)  (no model)  (agent)    (no model) (no model)  (no model)
```

| Step | Model | What it does | Writes |
| --- | --- | --- | --- |
| upgrade-effect | none | Installs and runs the target's tests as they are; moves `effect` and every `@effect/*` package on Effect's major line to the exact version the VibeLang runtime requires, wherever the repository declares it (dependencies, catalogs, overrides), with overrides that keep one copy installed, written to every overrides table the repository declares (`pnpm-workspace.yaml`'s, `package.json`'s `overrides` and `pnpm.overrides`; with none, the package manager's) in the quoting of the entries beside them; moves each `name@version` selector and patched dependency that names an old version to the new one (pnpm's `minimumReleaseAgeExclude`, `allowBuilds` and `patchedDependencies`, renaming a patch named for the old version and carrying its `package.json` hunks); in a repository VibeLang already set up, moves the `vibelang`, `vibelang-runtime`, `vibelang-vite` and `vibelang-unplugin` it depends on to this run's release, which requires that Effect, with `.vibelang-toolchain/` in `.gitignore` for a staged toolchain, and carries each patched dependency that names an old VibeLang version: one the new release already contains goes with its patch file, one that still applies moves to the new version, and one that does neither stops the step (`vibelangPatches` in `upgrade-effect.json`); installs and runs the tests again; commits the upgrade alone, before any VibeLang change. Separately versioned tools such as `@effect/tsgo` keep their versions, and an Effect peer range keeps its operator; VibeLang peer ranges and optional peer metadata stay as written, including when installed dependencies move to staged tarballs In a repository an earlier run migrated, only when declaration probes show that the installed compiler is pre-VIP-1 and this run's target compiler is post-VIP-1, it first runs the installed `vibelang --fix --fix-vip-only` on each project with a tracked `.vibe` file, so the compiler that wrote those modules applies its VIP migrations before the new one replaces it, and the commit carries them. Each probe compiles `export const f = (n: number) => n + 1` with declaration emit: an Effect return is pre-flip, `number` is post-flip. A same-side switch, a downgrade or a failed probe skips the migration; `vipFixes` in `upgrade-effect.json` records the emitted declarations, probe logs and skip reasons. | `upgrade-effect.json`, `baseline/upstream-tests.json`, `baseline/upgraded-tests.json` |
| setup | none | On the upgrade's commit, sets VibeLang up in the repository's own packages, the root and each workspace member, leaving a vendored tree that no workspace names as it is, and every Git submodule too: a commit cannot hold a submodule's edits, so a package the run names inside one is left with a warning (dependencies, `tsc`, `tsgo` and `tsrs` to `vibelang` in scripts, the `vibelang-vite` plugin, `vibelang()` from `vibelang-unplugin/bun` in each `Bun.build` of a package that reaches a migrated one, in its scripts and sources, and `vibelang()` from `vibelang-unplugin/esbuild`, last in the plugins, in each esbuild `build` and `context` call in the scripts and sources of such a package (an options object, a const or local helper that gives one, spreads of literals; a warning names the file and line of a call it cannot edit, a `buildSync`, or an esbuild loaded with `import()` or `require()`), never in a test, a fixture or a file only tests import, which keep every byte (decided detail 272) and get a warning when they bundle, `rewriteRelativeImportExtensions`, a `.vibe` include pattern beside each `.ts` one (`src/**/*.vibe` beside `src/**/*.ts`) in each package's tsconfigs, `allowArbitraryExtensions` in every tsconfig that extends none of the repository's others, `*.d.vibe.ts` in `.prettierignore`, `**/*.d.vibe.ts` in the Oxlint configuration's `ignorePatterns`, in each `dprint.json`'s `excludes` and as the first entry, `{ ignores: ["**/*.d.vibe.ts"] }`, of each ESLint flat configuration (a warning names one it cannot edit), VibeLang's dprint plugin in each `dprint.json` unless that configuration pins every plugin by checksum, where the dprint scripts it governs run `vibelang-format` after dprint instead (with a warning), and, under pnpm, `dprint` in `allowBuilds` in `pnpm-workspace.yaml`; `preload = ["vibelang/bun"]` under `[test]` in the `bunfig.toml` of a test command that runs `bun test`, and of every package that runs `bun test` and reaches a migrated package through workspace dependencies, and at the top level of the `bunfig.toml` of each such package where a script runs a program under Bun, `bun file` or a bin such as `bun alchemy-test`, which `[test]` does not reach; Knip's compiler for `.vibe`, `vibelang/knip`, in a `knip.config.ts` that keeps a JSON configuration's settings; in each package that reaches a migrated one, `withVibeLang` from `vibelang/metro` around the config its `metro.config` exports, `vibelang/babel` last in its Babel configuration's presets (the pair `["vibelang/babel", {}]` when every preset there is a `[name, options]` pair), `.vibe` modules in the `include` of each `@vitejs/plugin-react` call that turns the React Compiler on, and, under pnpm or Bun, a `patches/oxc-transform-react@<version>.patch` in `patchedDependencies` that hands a `.vibe` module's JavaScript to the React Compiler a test calls on the text it reads; a warning names a configuration it cannot edit); installs; formats the `.vibe` files the repository already has in its own packages with `vibelang-format`, since its format check now reads them; runs the tests as the baseline, compared with the upgraded tests; checks each package with `vibelang`; emits its declarations, and records a setup issue for each module an earlier run migrated whose declaration differs from the sidecar (`x.d.vibe.ts`) that run committed, since the baseline would otherwise take in a toolchain's change to it; inventories every source file and the local modules it imports, by a relative path or through its package's tsconfig `paths` alias (`~/main`), resolved as TypeScript does; runs `vibelang agents init`, so the target's coding agents get the VibeLang skill, the language server and a check after each edit; commits | `setup.json`, `baseline/`, `inventory.json` |
| plan | one agent call | Orders the Effect files into small batches, leaves and tested modules first, each with a reason; the answer is validated before anything reads it | `plan.prompt.md`, `plan.draft.json`, `plan.json` |
| codemod | none | First moves a batch module's platform code, each top-level declaration that uses a Node or Bun builtin imported as a value, with the module's own declarations it reads, verbatim into `<Name>.platform.ts` beside it (EK4402's fix: "move the code into a sibling `.ts` module"); an export that moved stays in the module as a function with the same written signature that calls the moved one, so the module's declarations are unchanged, and the sibling starts with the file-wide directives of the module's leading comments, such as `// @effect-diagnostics nodeBuiltinImport:off`, which governed the moved code; a module whose moved exports are not such functions keeps its platform code (`platform` in `codemod.json` lists both, and `revert` removes the sibling). Renames the batch to `.vibe`, points each package's `exports`, `imports`, `main`, `module` and `types` at the renamed modules (a `types` field or condition at the declaration sidecar `x.d.vibe.ts`, `main` and `module` at `x.vibe`; an `exports` or `imports` target names the source under the `vibelang-source` condition and the emitted JavaScript under `.vibelang/js/` by `default`, and a bare entry the sidecar too, `{ "types": "./x.d.vibe.ts", "vibelang-source": "./x.vibe", "default": "./.vibelang/js/x.js" }`, since stock TypeScript names a consumer's inferred type only through a target that is the sidecar, and the `bun build` CLI loads no plugin and plain `node` no loader, unless the repository already uses bare `.vibe` exports, whose form stays unchanged; a pattern such as `"./*": "./src/*.ts"` gains an exact entry for each, and revert takes it back), rewrites imports by VibeLang's rules and literal native Vite build inputs (`build.lib.entry`, `build.rollupOptions.input`, `build.rolldownOptions.input`, `pack.entry`, including pack arrays and input arrays/maps), preserving the config's quotes and recording `buildEntries` for `revert` and for a resumed codemod; computed roots or entries stay as written with file/line warnings, and tests and fixtures stay untouched, runs `vibelang --fix` until it fixes nothing, keeping the rewrites of the batch's files only (an earlier batch's committed files stay as committed) and listing the modules it put back in `fix.restored`, and records each rewrite it applied or refused | `batches/NN/codemod.json` |
| compile | none | `vibelang --noEmit`: the batch's diagnostics and any error new against the baseline | `batches/NN/compile.json` |
| repair | agent | Fixes what is left and finishes the idiomatic rewrite, with `context.md` as its system prompt; records codemod gaps, VibeLang issues and idiom lessons; returns a file it cannot migrate to `.ts` | `batches/NN/repair.prompt.md`, `repair.json`, `issues.jsonl` |
| verify | none | The tests pass with no new failure and no missing test against the baseline, each test matched by its name with any date it prints (`Date#toString`, `toUTCString`, an ISO timestamp) set aside; published declarations remain byte-identical, a declaration file nothing publishes is compared canonically and ignores a private type alias nothing names (a migrated private `schema` declares one beside its constant) and the order of its import statements and its re-exports, new private declarations are listed as `addedPrivate`, and older baselines without public-surface metadata retain the canonical comparison (comments, member order, redundant type parentheses, and relative source/emitted names proven to identify the same declaration module), and their emit reports no error in a migrated file, since a baseline that fails the same way (`TS7056`) makes equal declarations prove nothing; the working copy changes only the batch modules, platform siblings, sidecars and codemod-recorded manifest, import, path-reference and Vite-script edits; the migrated modules must also be proven against the repository compiler in `declarationOracle`; the batch has no error, no EK48xx but EK4832, no EK4402 and no EK9204 | `batches/NN/verify.json` |
| record | none | Rejects foreign changes before formatting and before committing, including when forced; commits the batch with `jj`, naming its files, with o200k token counts before and after | `batches/NN/record.json` |
| report | none | Batches, tests, declaration identity, tokens, codemod gaps, issues and idiom lessons | `report.md`, `report.json` |

Inside `types` or `typings`, nested conditions and fallback arrays keep declaration-sidecar targets, including `vibe.sidecarDir` layouts; they never gain runtime export wrappers.

Setup also looks for tracked code that lists a folder's `*.ts` files: a glob whose last segment is `*.ts` or `*.{ts,…}` (a script, a `package.json` test command, a test runner's `include`), or a `readdir`, `glob` or walk filtered by `.endsWith(".ts")`, `/\.ts$/` or `extname(…) === ".ts"`, as Smithers' `test/coding-stable-plan.test.ts:57` does. Such code also selects the `x.d.vibe.ts` sidecar beside each `x.vibe`. When the folder it lists holds a `.vibe` file or a `.ts` module that imports Effect, setup sets `"vibe": { "sidecarDir": ".vibe/declarations" }` and adds `.vibe/declarations` to `rootDirs` in each package tsconfig, so every sidecar goes to that hidden directory and stock TypeScript still resolves `./x.vibe` (decided detail 268). It records each finding in `setup.json` under `wired.sidecarDir.reasons` and `wired.warnings`. TypeScript ast-grep YAML rules and unquoted script arguments are included. An existing custom or inherited `sidecarDir` is preserved, its actual directory is added to `rootDirs`, and package `types` targets use the same resolved setting. Setup removes the paired adjacent sidecars in that operation, records each removal in `sidecar-layout.jsonl`, and leaves orphan declarations and other selected outputs alone; replay does not remove them twice. The listing would no longer select a module once it is `x.vibe`, so the inventory marks each `.ts` module in that folder with `enumeratedBy`, and the plan keeps it `.ts` with that reason. In such a package the codemod points a `types` field or condition at `./.vibe/declarations/src/x.d.vibe.ts`, the sidecar's mirrored path, and `revert` deletes the sidecar there too. Code that already names `.vibe` or `.d.vibe.ts` files is left alone. A walk without a literal start folder counts as listing its whole package.

Workspace dependencies can contain cycles. Setup wires every package that can reach a migrated package, including each member of such a cycle; unrelated packages keep their configuration.

Setup also rewrites compiler commands in the root package, even when the run names only leaf packages, and installs the compiler there. It does the same in every owned package that reaches a migrated one through workspace dependencies, since a recursive build there rebuilds the migrated project. For literal checker commands joined by `&&`, setup combines their authored project roots into `node .vibelang/typecheck.mjs`. The runner reads project metadata, follows references and checks the union with one `vibelang --build` invocation. A project reached from several roots is built once. Surrounding preparation and follow-up commands keep their order; an unsupported shell form retains the original command with a setup warning.

The runner finds each scoped `.vibe` module's owning source project, adding uncovered owners with ignored `noEmit` check configs beside their original configs, preserving type-library resolution and composite root-directory defaults. It rejects a module with no prepared owning project. Solution references keep their options; an unreferenced shared options overlay is not an extra source project. A base config with no `files` or `include` can implicitly include excluded tests, demos and submodule sources under the wrong options. Vendored packages and Git submodules stay outside discovery.

Use repeated `--typecheck-retire <script-path>` to remove a known `node` or `bun` serial precheck, repeated `--typecheck-prepare <command>` for code generation required before ownership discovery, and repeated `--typecheck-source-root <directory>` to restrict discovery to intentional source roots. These options persist with the run. Preparation failures and metadata errors fail the check. Progress and per-project metadata timings, preparation time, build time and exit status are recorded in the ignored `.cache/vibelang-typecheck.json` receipt. The generated runner and `.vibelang/typecheck.json` are committed with the target's setup; update the shared template and rerun setup to refresh the runner.

ESM source-loader entries register `vibelang/register` after the repository's own Node hooks. Node runs the last synchronous hook first, so setup appends an awaited dynamic import after the entry's registration statements and moves an earlier side-effect preload there. It resolves imports and lexical shadows with the TypeScript binder. Tests, fixtures, test-only helpers, configured compiler outputs and foreign packages remain unchanged; conditional, deferred, generated and CommonJS registrations receive file-and-line warnings for manual setup.

Setup warns with the file and line when a string source-extension allowlist includes `.ts` but omits `.vibe`. It checks arrays and `Set` initializers in the repository’s own source and configuration files; comments, code embedded in strings and vendored packages are excluded. Review the collector, include native sources and exclude generated `.d.vibe.ts` sidecars. These warnings appear in `setup.json` under `wired.warnings`; setup leaves the allowlists for the repository to configure. Setup also warns when a literal source-extension regex accepts TypeScript filenames but skips the corresponding `.vibe` filename. The warning identifies the literal's file and line; regexes and repository plugin behavior stay under the repository's control.
Setup adds `vibelang()` from `vibelang-unplugin/rolldown` first in each configuration exported by an owned `tsdown.config.ts` (or its JavaScript variants), including arrays and immutable local config factories. It preserves existing options, plugin order and type assertions, and adds `vibelang-unplugin` to the owning package’s development dependencies, retaining an existing runtime dependency there. Test and fixture configs stay unchanged. A dynamic options expression, mutable plugin list or overriding spread that setup cannot edit safely produces a warning with the file and line.


### Test and fixture identity

Decided detail 272 keeps tests and fixtures as the migration's oracle. Each batch's `verify` compares pinned jj trees from before setup through the current batch, using the flow's test-file detection and fixture directories. Adding, deleting or renaming a test or fixture fails. Changed TypeScript files are parsed with the TypeScript AST; every byte outside the permitted literal or selector must stay unchanged, including embedded configs and setup. Source-text assertions remain protected.

Exactly five edits are permitted:

- A module-path literal in an `import`, `export … from`, `import()`, `require()`, `vi.mock()` or `jest.mock()` may name the same migrated module with its new extension: `.ts` to `.vibe`, `.tsx` to `.vibex`, or the project's `declarationImportStyle` spelling. Call path arguments may also be parenthesized literals or templates without substitutions. The rename map must correspond to files actually removed and added in the snapshots.
- A file selector may gain the matching VibeLang extension and exclude `*.d.vibe.ts`. Its selected paths, mapped to base names, must have exactly the same count and names before and after. A widening that adds or drops one file fails, even if the target's tests still pass.
- A path literal may change `.ts` to `.vibe` or `.tsx` to `.vibex` only when both pinned inventories resolve it uniquely to the rename map's source and destination. Relative and repo-rooted paths, static `path.join`/`path.resolve` fragments based on `__dirname`, `import.meta.dirname` or a constant repository root, and `new URL(…, import.meta.url)` qualify. A dynamic base is rejected as `not statically resolvable`. Reads through `readFile*`, imported aliases, `fs.promises` and `Bun.file(...).text()` are traced through local aliases and expressions; asserted source text, callbacks and unknown text consumers are refused with `keep .ts, send to migfix`. An edited expected path is also refused.
- An expected dependency list or object in an equality assertion may gain exactly one `"vibelang-runtime"` entry, only when the test's nearest owning `package.json` gained it in `dependencies` between the pinned trees. Object entries must use the actual new version. Every existing token and comment in the collection is preserved; an extra name, removal, duplicate entry, version change, negated assertion or change to another part of the assertion fails. The report lists these separately under `assertion edits`.

A test already present as `.vibe` in the baseline may also take formatter-only changes. The native VibeLang parser must parse both snapshots successfully, and their ASTs with locations and trivia stripped must match. Their token streams must also match, retaining comments in position with only internal comment whitespace normalized. Only whitespace, trailing commas and statement-terminating semicolons may differ; parentheses, empty statements and `for`-head semicolons remain protected. This allowance does not cover fixtures or newly converted tests. The report lists the proof separately under `formatter-only`. A missing parser or an unsupported parse fails the batch.

For `import.meta.glob`, the verifier uses the target Vite installation's own `tinyglobby` or `fast-glob`, with Vite's selection options. Literal patterns and pattern arrays, `exhaustive` and `caseSensitive` use the installed Vite transform's selection rules. Its literal matcher flags are read with the TypeScript AST; unsupported dynamic flags fail with a reason rather than guessing engine defaults. A distribution that bundles its glob engine without a separately loadable module is refused; the verifier never substitutes another package's Vite. Rooted patterns require an explicit repository-relative tool root (`test.globRoot` in the run's `config.json`); absolute roots and paths leaving the snapshots are refused; aliases and a custom `base` option require a root resolver and are refused. A `readdir` or `readdirSync` filter is evaluated directly over each tree's directory entries, relative to the configured test working directory. Only synchronous, non-generator callbacks with one plain filename parameter qualify. Supported predicates combine `endsWith` extension checks or extension regexes with `&&`, `||` and `!`. A named regex must be confined to that selector. Both the codemod and `verifyTestDiff` check every resolved reference: each must test the filename parameter of a `filter` over a standard imported directory listing (optionally through `map(String)` or a local immutable list). An assertion, escaped alias, exported regex or unknown consumer refuses the widening; a directory listing elsewhere in the file is insufficient. No target code is executed; dynamic directories, mutable or shadowed bindings and other unsupported expressions fail with a reason. Locally declared loader or reader names must be standard imports (such as `vi` from `vitest` or `readdirSync` from `node:fs`); custom wrappers are refused. Same-spelled declarations in different scopes are treated as ambiguous.

Each batch writes `batches/NN/test-diff.json` and `test-diff.md`: every changed test or fixture, each permitted or forbidden edit, and every set check's counts and names. `record` repeats this check after formatting and sidecar emission, immediately before committing. `record --force` cannot waive it. Revert a forbidden edit and leave its module TypeScript when necessary.

The run's `report.md` and `report.json` include these proofs. Use `pr-body.md`, generated by `report`, in the migration pull request body so every touched test or fixture and its result is reviewable; the flow never posts it.

Declaration-only snapshots disable `sourceMap`, `inlineSourceMap`, `inlineSources` and `declarationMap` together, including values inherited through `extends`. They leave the target's configuration intact and still require successful emission and the published declaration identity check.

Before wiring VibeLang, setup emits each published package's original declarations with the installed stock compiler its scripts name (`tsc`, `tsgo` or `tsrs`; `--stock-compiler <path>` selects another). It saves them under `baseline/stock-dts/`, compares the native baseline in canonical form and records every missing, extra or different declaration in `baseline/declaration-oracle.json` and the run's issues. Verification fails `declarationOracle` for a batch that migrates such a module, even when its native declaration matches the native baseline. Its ordinary native-to-native public declaration comparison remains byte for byte. A missing or failed stock compiler cannot prove identity; older runs without this oracle need a fresh setup before migrating published modules.

Compiler discovery prioritizes the package's declaration build scripts over check-only scripts, then the root's scripts. If that named compiler is missing, the oracle is unavailable; it never substitutes another installed compiler. `stockCompiler` remains the explicit override for a custom publishing toolchain.

Declaration identity applies only to published packages. `verify` reports a package marked `"private": true` as `declarations: "not published"` and skips its declaration emit and comparison; its tests, compiler errors and style checks still gate the batch. A monorepo whose apps consume private workspace packages passes `--include-private-declarations` to `upgrade-effect`: the run records `declarations: { includePrivate: true }`, and `verify` then holds every private package's declarations and their emit to the identity a published package's are held to. The repository’s build, workspace typecheck, lint, format and Knip gates still apply.

`verify` also checks each migrated module's run phase (alchemy-62). A function's kind is decided by its `effect` keyword, so a conversion that marks `effect` a function the original module kept plain makes the call return a program, and its body runs only when that program runs. Types and declarations can hide this (alchemy's `effectClass` was typed through `as any`), so `verify` pairs each `effect` function in the `.vibe` with the original function at the same name path (`const`, property, method, class and function names) and reads the original's body. The batch fails when the original returned a value (an object, array, class, literal, function, `new`, `Object.assign(…)` or `JSON.*` call, or nothing), or did work at the call before returning (a `throw`, a call, an assignment or an update outside nested functions). An original that returned `Effect.gen(…)`, or an `Effect.fn` function, passes. One that returned any other expression, such as a pipeline, is listed under `runPhase.changes` with verdict `review` and does not fail the batch. `verify.json` lists every finding by file, name, line and verdict under `runPhase`; a module the compiler cannot parse is listed under `runPhase.unchecked`, and compile's own gate fails it.

The codemod refuses a batch whose `.vibe` path the repository ignores, as a tracked module under an ignored `lib/` directory is: a commit would delete the `.ts` and record no `.vibe`.

A file the repository's own code finds by its name stays `.ts`, as a tool's config does: the inventory records in `namedBy` the first non-test file that writes the file name as a string, as alchemy's CLI writes `"alchemy.run.ts"`, and the plan refuses that file with the reason.

The codemod formats generated `.platform.ts` siblings with the repository's own formatter before it records its result, so a batch's immediate format check sees the final TypeScript. `codemod.json` records the formatter, exact files, exit code and relative log under `platform.formatted`; formatter failures remain visible there and in `logs/platform-format.log`. Files outside the split remain untouched.

Each step reads and writes the run directory, so a step that already recorded its result returns it, and a stopped run resumes where it stopped.

Before changing the target, `codemod` atomically writes and flushes
`batches/NN/codemod-state.json`: original source bytes, planned renames,
package exports and import edits. It replays interrupted mechanical edits
without overwriting a conflicting file. Before starting the compiler it
records the `fixing` phase, then each compiler attempt and project progress;
attempt logs have distinct names. Retrying the same run preserves already
renamed modules and checked hand repairs and runs the current compiler to a
fixed point. Only the completed `codemod.json` advances the flow. `revert`
can use the saved original and import/export bookkeeping before the compiler
finishes, even if the parent commit no longer contains the TypeScript source.
Keep the run directory private: its journal contains original source bytes.
Runs interrupted by an older flow before any journal was written still need
a fresh run from their saved TypeScript sources; no receipt is inferred.

For a migrated `.mts` module, declaration identity pairs a removed `x.d.mts` with its new `x.d.ts`, recorded under `renamed`. A destination already present in the baseline is a collision; a change in public reachability still fails. Published declarations remain byte-identical, including comments and quote spelling.

Public declarations reachable from `exports` or `types` must remain byte-identical; unreachable new declarations pass as `addedPrivate`. One difference is excused: a relative module specifier whose two spellings stock TypeScript resolves, under Bundler and Node10 resolution and in both trees, to the same listed declaration file, such as `export * as Runtime from "./runtime"` declared as `"./runtime.js"` once the codemod names the migrated module `./runtime.vibe`. `verify.json` lists each excused pair under `excusedSpecifiers` (package, file, line, before, after); copy the list into the pull request's description. Shipped hand-written `.d.ts` roots outside the compiler output are copied into each run's declaration snapshot and resolved through the package's actual output aliases. Their bytes, transitive reachability and resolved dependency edges stay part of the public comparison; a new file that shadows a directory index is public. Legacy runs recover those roots from their committed setup tree, never from candidate files. An unresolved root remains conservative even if it is unresolved on both sides. The gate follows declaration imports, re-exports, import types and reference paths, including conditional and wildcard entry points. Removed declarations still fail. Setup snapshots the published roots and emit aliases; unresolved entry points and older baselines without a snapshot conservatively check every addition. Verification reports the roots and unresolved paths.

The diagnostic reader accepts compiler output with `LF`, `CRLF`, or mixed line endings, preserving diagnostic codes, source locations and repair notes. A nonzero compiler exit with ordinary diagnostics is an error result; a crash, signal, or failing exit without diagnostics stops the step.

Each test invocation discards an earlier Vitest JSON report before starting. A nonzero test command fails verification against a passing baseline even when its fresh report lists only passing assertions; unchanged baseline failures remain unchanged.

Every install the flow runs also rewrites each other lockfile at the repository's root, which the package manager's install leaves stale: `bun install --lockfile-only` for a `bun.lock` or `bun.lockb` beside `pnpm-lock.yaml`, and `npm install --package-lock-only --ignore-scripts` for a `package-lock.json` beside another manager's lockfile. A `--install` command replaces all of it.

Upgrade-effect, setup and record run the target's own formatter on the files they wrote or the batch changed, other than `.vibe` files, sidecars and lockfiles: the tool its root `package.json`'s format scripts run (`oxfmt`, `vp fmt`, `prettier`, `biome format`, `dprint fmt`), else one it installs. The target's format check then passes on them. Record then formats the batch's `.vibe` files, because `vibelang --fix` does not format what it rewrites and a format check covers them: with the target's `dprint fmt` where the file's nearest dprint configuration loads `npm:vibelang/dprint-plugin.json`, so its whole TypeScript configuration applies, and with the target's `vibelang-format --write` elsewhere.

Record resolves jj's compact rename summaries to destination paths before formatting. Literal braces in shared prefixes, suffixes and filenames stay intact; rename and copy records retain their original path as `from`.

The ESLint bridge counts type-query reads for `no-unused-vars` as Oxlint does, including `declare const` symbol brands used only through `typeof`. Rule options and unused-variable diagnostics remain active. Its real-linter regression and 60-run property use `VIBELANG_UNUSED_ORACLE_NODE_MODULES` for Oxlint and the compiler package's installed ESLint test dependencies.

The ESLint bridge retains Oxlint `ignorePatterns` in their original order, including directory patterns, rooted paths, brace and source-extension globs, and negations. Patterns remain relative to the lint command's working directory. A `.ts`, `.mts` or `.tsx` file pattern also covers its migrated `.vibe` counterpart; ignored modules stay ignored and visible siblings stay checked. Set `VIBELANG_LINT_ORACLE_NODE_MODULES` to a directory containing `eslint`, `oxlint` and `espree` to run the real-linter property comparisons.

For tests that bundle a package's sources through Rolldown or Vite's bundled config loader without a native plugin, pass `--emitted-project packages/plugin/tsconfig.build.json` to `upgrade-effect` (repeat per project). Setup writes exact private `#vibelang/emitted/…` imports, with `vibelang-source` for compiler builds, `types` for type checkers and `default` for the JavaScript the package's existing build produces. It enables the source condition in the package's compiler projects so cold builds do not need sidecars. No tests, fixtures, test scripts or public exports change, and no build step is added. The project must already run from `build` or `prepare` and emit individual JavaScript files. `wired.emittedImports.modules` records the exact source/output set. For published packages, setup compares declaration bytes before and after and rolls back the wiring if they change. Run the real Rolldown/Vite regression and the emitted-JavaScript property with `VIBELANG_EMITTED_IMPORTS_ORACLE=1`, a built compiler and installed Vite test dependencies.

Reverting an importer and its dependency restores their original TypeScript specifiers in either order. Recorded import edits follow a restored importer back from its `.vibe` path; a still-native importer continues to name the explicit source file.

### Restart and measurement rules for a whole-scope pass

The pass banks each completed package in `fix-bank.json` and skips it after a
restart when its source digest still matches. Dependency packages run first;
among ready packages, smaller packages run first. A successful wide settle
banks package outcomes, kept modules and return causes in `done.json`.
A config whose `--fix` timed out is recorded in the bank and receives no more
`--fix` in that pass, including after a restart. Start a new run to retry it.

Own `EK` diagnostics blame only their own module. Ordinary type errors first
blame reachable migrated modules whose declaration differs from the baseline;
when none can be distinguished, settle widens to the reachable set. Dependency
roots are returned first and every return is checked. Missing declaration
evidence is treated as suspect. Both baseline and candidate declaration emits,
including sidecar checks, use `--singleThreaded`.

A statically resolved path string follows its renamed module in tests and
sources (detail 272 addendum 4). Relative paths, package-relative paths and
`new URL("x.ts", import.meta.url)` are resolved; bare names are resolved only
with `__dirname` or `import.meta.dirname`. An unknown directory or URL base
does not identify a module. Comments and prose strings stay as written.
`vi.mock` and `require.resolve` name modules. A module whose source text a
test reads stays `.ts`, with the reader recorded as its deferral cause.
A test that observes bundle `metafile.inputs` and names an owned source
path also protects that package: an unrelated migration can route native exports
through emitted JavaScript and change the observed input filename. Scope planning
conservatively keeps the package native, records `BUNDLE-INPUT-PATHS` with the
test and source path, and still admits candidates in other packages. If the whole
scope is protected, the error lists each retained module and its cause. The test,
its expected paths and the package runtime graph remain unchanged.

Pass `--after-convert "<command>"` to `upgrade-effect` (repeat per hook).
The run stores these repository adapters in `config.json` and runs them before
every settle check and verification, including the final verification after
record formats the files. Use hooks for generated bundles and repository
build-graph paths; the flow contains no repository-specific adapter.
A failed hook stops the step and preserves its log in the run.

Whole-scope verification measures the candidate against both the previous
commit and the repository's main, in one measurement job. Main resolves from
`main@origin`, `main@github` or `main`; `--main <revision>` selects it
explicitly. Temporary jj workspaces use each revision's dependencies and are
removed afterward. The candidate must also pass the setup baseline.
Vitest JSON, Node's spec reporter and Bun's per-test output are read and
checked against their summaries. Zero tests, missing reports, contradictory
counts, unexplained exits, newly skipped passing tests and missing tests fail
admission. No exit-only fallback or automatic flaky rerun is used here.
Custom `--test-report` output must also print
`SUMMARY total=N passed=N failed=N skipped=N`.

For a box provider, set `--measure-command "<adapter>"`. The adapter receives
`VIBELANG_MEASURE_MANIFEST` and `VIBELANG_MEASURE_COMMAND`; it must run all
three sides in one box job, remapping paths as needed, and return
`receipts.json` to the manifest's output directory with the same job ID.
The manifest includes each side's target, revision and install command.
Separate jobs for different sides do not measure comparable green results.
The run retains raw per-side logs, normalized receipts and `comparison.json`.
`record` repeats verification after formatting and regeneration; `--force`
cannot bypass this whole-scope gate.

The style gate retains advisory `EK4804` when the compiler identifies the global `Error` and the enclosing native function writes `!Error` matching that function’s original declaration. `compile.json` records each decision under `styleExemptions`, with the declaration path and reason. A plain function that directly returns `Effect.callback<A, E>` also declares `E`: its native replacement may retain that written failure channel after switching to a platform service. This proof requires one matching function on each side, accepts an expression body or a single `return`, and never lends the channel to a nested callback. An `async` function or a generator returns a `Promise` or an iterator instead, so the callback inside that wrapper cannot prove the function’s failure channel. Missing or ambiguous declarations, unwritten or changed failure types and shadowed `Error` names retain the warning as a style problem; real TypeScript-style Effect forms remain rejected.

Plans and codemods accept `.ts` and `.mts` modules; `.mts` requires its nearest `package.json` to declare `type: "module"` so the renamed `.vibe` emits ESM. Codemod checks this before moving any batch member, when it prepares its durable state and again when a resumed codemod replays it, and names an unsafe boundary. Configure an ESM boundary while preserving existing CommonJS modules before retrying. Imports spelled `.mjs` or `.mts` follow the renamed source, package entry points follow it and its sidecar, and revert restores the original `.mts` path and specifiers. JSX and declaration files remain outside the migration candidates. Existing tool-configuration exclusions apply to both source extensions.

## Run it

Every batch lands on a jj bookmark, `vibe` unless `--bookmark` names another: upgrade-effect starts it on the default branch (`trunk()`, or `--base <branch>`, such as `dev`, which restarts a bookmark an earlier run left elsewhere), or continues an earlier run's `vibe`, and each recorded batch is one commit on top of the last. The first two commits are the Effect upgrade and VibeLang's setup, so a reviewer reads the dependency upgrade, and any test it breaks, apart from the migration. The flow never pushes. After each run, the orchestrator pushes `vibe` to the library's fork and opens a pull request from it there, so the migration's diff is reviewable.

Both ways need a VibeLang toolchain: a published version (`--vibelang-version 0.0.11`), or a staged build of a checkout, which runs the compiler on main before it is published:

```sh
sh scripts/build-vibelang.sh && (cd packages/runtime && bun install && bun run build) && (cd docs/tools && bun install)
node .smithers/flows/migrate/step.mjs toolchain --vibelang . --out <toolchain>
```

The toolchain holds the native compiler, npm tarballs of `vibelang` (with that compiler), `vibelang-runtime`, `vibelang-vite` and `vibelang-unplugin`, and the TypeScript compiler API that reads declarations. Setup copies the tarballs into `.vibelang-toolchain/` at the target's root, each named for its content (`vibelang-0.0.11-<hash>.tgz`), adds that directory to the target's `.gitignore`, and names them relatively from each package (`file:../../.vibelang-toolchain/vibelang-0.0.11-<hash>.tgz`), so no commit names a path on the build host. Every build of one version packs to the same file name, and npm, Bun and pnpm can keep parts of what an unchanged `file:` specifier installed before, its files or its command links; the content's name makes a rebuilt toolchain install. Every commit the flow makes first checks the lines it adds for this machine's absolute paths and refuses them. The target must be a jj repository or a Git checkout, which upgrade-effect makes a colocated jj repository.
A `file:`, `link:` or `portal:` URI is machine-specific only when its
normalized, decoded path lies under the target, run, toolchain or home root.
Virtual editor URIs such as `file:///src/ui/message.ts` and
`file:///${path}` remain portable.

### Whole-scope conversion

Use the same run after `setup` to convert a scope in one pass. The scope file lists
one repository-relative source path per line. Every `.ts` source in it belongs to
one batch, including plain helpers and tests explicitly listed there; `.tsx`
sources stay deferred with the JSX cause. Declarations and existing `.vibe`
sources are recorded as deferred rather than renamed. A missing or escaping path
fails planning.

```sh
step="node .smithers/flows/migrate/step.mjs"
$step plan --run <run> --scope <scope.txt>
$step rename --run <run> --jobs 8
$step fix --run <run> --jobs 8 --timeout 3600 --rounds 4
$step check --run <run> --jobs 8
$step settle --run <run> --jobs 8 --rounds 12
$step verify --run <run>
$step record --run <run>
```

Each command uses only the run's target, packages and toolchain. Before
`rename`, every configured project and every project named by a package's
`typecheck` or `typecheck:tsc` script is checked into
`onepass-baseline.json`. A solution's source projects are expanded.
`rename` records the whole batch's renames, exports, relative import
specifiers and non-import path references (scripts, build entrypoints and
configuration) in `batches/01/codemod.json`.

`fix` processes dependency packages first, with at most `--jobs` concurrent
packages (maximum `8`); related packages never fix concurrently, and dependency
cycles run serially. Each project runs `--fix` to a fixed point. Projects above
`240` modules fix the selected sources and their dependencies in directory-packed,
transitive import-closed shards,
each at most `240` modules, using temporary projects that extend the original
options. Unselected roots remain in the full-project checks. Even a single
selected shard uses a temporary project when the full program is above the cap.
A closure larger than that cap stops with its file and size instead of
running an unsafe shard. Temporary projects are removed after failure too.
`--timeout` bounds each compiler invocation in seconds. A timeout, compiler
crash or exhausted fix limit fails the command and keeps timing, project, shard
and error receipts in `codemod.json` and `progress.jsonl`.

`settle` checks every project again and groups a failing module's diagnostics
by family in `settle-causes.json`. It returns dependency roots first, through
healthy intermediate importers and cycles, then checks again before deciding
whether an importer also needs to return. New errors in TypeScript importers
are traced to migrated dependencies only after own errors have been retried.
An unrelated or unattributed error stays visible and blocks completion.
`settle.json` records each round, causes and remaining diagnostics. The
command prints `SETTLED` and exits successfully only after a complete check
finds no migrated-module error or style violation, no new TypeScript error
beyond the per-project baseline, and no crash or global failure. An exhausted
round limit prints `NOT SETTLED` and exits unsuccessfully.

Bulk rollback uses repeated `--file` options:

```sh
$step revert --run <run> --file <a.vibe> --file <b.vibe> --reason "<cause>"
```

Every request is validated before the first restore. Each original `.ts`
must return, its `.vibe` and sidecar must disappear, and exports, recorded
paths and every importer's specifiers follow the restored source. Missing or
already reverted modules fail loudly. The library exposes the same operation as
`steps.revertMany({ run, batch, files, reason })`; `files` can also contain
`{ file, reason }` entries.

The existing flow uses this path when `plan.json` has `mode: "one-pass"`:
`codemod` runs `rename` then `fix`, and `repair` runs `settle`.
The target's test, declaration and style gates still run in `verify` before
`record`. A clean settle alone does not prove those gates passed.

### Registry versions

`step.mjs` runs from a copy of `.smithers/flows/migrate` with no `node_modules` in reach, as `toolchain` and `upgrade-effect` must before a target has `vibelang` installed: the flow bundles minimatch in `lib/vendor/`, and its loader-record step takes `vibelang/project` from the target's installed `vibelang`.

Once VibeLang publishes the version a migration needs, use the registry instead of a staged toolchain: start the run with `--vibelang-version <version>` in place of `--toolchain <dir>`. Setup then writes exact versions (`"vibelang": "0.0.12"`) and makes no `.vibelang-toolchain/`. Anyone can install the result, and the fork's pull request no longer depends on the tarballs.

To switch a target that a staged toolchain set up, start a new run on it with `--vibelang-version`. Upgrade-effect continues on the `vibe` bookmark, and commits only when the version needs another Effect. Setup then replaces the three `file:` specifiers with the version, deletes `.vibelang-toolchain/` and its `.gitignore` line, reinstalls, records a new baseline, and commits the switch on top. The batches already on `vibe` stay as they are.

### Step by step

Each command prints its result and the next step. A person, or an agent session driving the run, answers the two agent steps:

```sh
step="node .smithers/flows/migrate/step.mjs"
$step upgrade-effect --run <run> --target <repo> --package packages/core --test "pnpm exec vitest run" --test-cwd packages/core --toolchain <toolchain>
$step setup --run <run>                       # reads the run's options
$step plan --run <run>                        # writes plan.prompt.md and a deterministic draft
$step plan --run <run> --accept <answer.json> # validates and records the plan
$step codemod --run <run>
$step compile --run <run>
$step repair --run <run>                      # writes batches/NN/repair.prompt.md; do the repair it asks for,
                                              # checking with compile --no-record and verify as you go
$step repair --run <run> --done               # checks issues.jsonl and records the repair
$step verify --run <run>                      # a failure sends the batch back to repair
$step record --run <run>
$step report --run <run>
$step next --run <run>                        # what to run next
```

`--agent "<command>"` on `plan` or `repair` runs an agent instead: the command gets the prompt on stdin and its path in `MIGRATE_PROMPT`, runs in the target's root, and for `plan` writes its JSON answer to `MIGRATE_OUTPUT`. Any coding agent with a non-interactive mode fits; the flow has no code for any particular one. `revert --file <path.vibe> --reason "<text>"` returns one file to its `.ts` source, and points every import the codemod rewrote to `.vibe` back at the `.ts` file: a file of the current batch, or one an earlier recorded batch migrated, which comes back as it was before that batch, in the current batch's commit.

Directory imports with a trailing slash keep the selected index module when the flow adds its source extension: `./runtime/` becomes `./runtime/index.vibe` in a `.vibe` importer.

A script that runs `tsc` through Bun's shell (`` $`bunx tsc --emitDeclarationOnly` ``, `` $`bun tsc -p tsconfig.build.json` ``), with or without a `Bun.build`, runs `vibelang` after setup, which also compiles the package's `.vibe` modules and writes their JavaScript and imports as `.js`; setup adds `vibelang` to the package's `devDependencies` when it has none. `tsc` in `package.json` scripts was already `vibelang`.

A script that builds with `Bun.build` and runs `tsc` through Bun's shell (`` $`bunx tsc --emitDeclarationOnly` ``) runs `vibelang` after setup, which also compiles the package's `.vibe` modules; `tsc` in `package.json` scripts was already `vibelang`.

Every TypeScript checker of the repository reads the migrated modules: each `vibelang` compile of a migrated package writes `x.d.vibe.ts` beside `x.vibe`, and the batch commits it with the module. Stock `tsc`, `tsrs`, `bun check` and TypeDoc resolve `./x.vibe` to it under `allowArbitraryExtensions`, so the codemod writes that name in every `.ts` importer, for `./x.js` and `./x.ts` alike, including extensionless `./x` file and `./dir` directory imports and a tsconfig `paths` alias such as `@/x` (read with TypeScript's config reader, so `extends` and `baseUrl` apply), which becomes `@/x.vibe` when extension rewriting is off, or a relative `.vibe` source name when it is on, in every source file the repository tracks, the module's tests and other packages included, and `revert` takes it back there too; `vibelang` emits and declares it as `./x.js`. When an original import was extensionless, declaration comparison accepts the emitted `.js` spelling only when stock TypeScript resolves both names to the same listed `.d.ts` module inside their declaration tree. Explicit extensions, external names, missing targets and changed modules or types remain distinct. A Vitest or Jest module mock of the module, `vi.mock("./x.ts", …)`, `vi.doMock`, `vi.importActual`, `jest.requireActual` and the rest, takes the same name as the test's import, so the mock still matches the module the test loads. They read only the sidecars, so a `.vibe` file's type errors are reported by `vibelang`, which every migrated package's scripts run. `revert` puts back each importer's original specifier, each one as it was written, and deletes the sidecar from its effective configured directory, including inherited paths. A specifier in a comment stays as written: declaration emit copies a doc comment. A JavaScript file (`.js`, `.mjs`, `.cjs`, `.jsx`), such as a script that imports `../src/Monitor.ts`, gets the new name only where it names the module's source file; its `./x.js` names a JavaScript file and stays.

A migrated package also commits its emitted JavaScript under `.vibelang/js/`, mirroring the package, one file per module but tests, each starting with a line that names its source. The codemod, verify (before the tests) and record (before the commit) write it again with `vibelang --outDir .vibelang/js --rootDir <package>`, so a test that runs the `bun build` CLI or plain `node` on the package reads current JavaScript; `vibelang/register` and `vibelang/bun` run the `.vibe` source in its place. Each time, it also writes the loader record of each project the package's `.vibe` modules compile with, `.vibelang/js/.loader/<tsconfig name>.json`, with `writeLoaderRecord` from the package's installed `vibelang/project` (the loader that reads the record; the flow stages without the repository's packages), so a process with a cold cache, as in every CI run, uses that compile instead of type-checking the package again while every input it names holds; the emit receipt lists each under `loaderRecords`, with the errors of a project that gets none. Setup keeps Prettier, dprint, Oxlint and ESLint off `**/.vibelang/js/**` as off the sidecars. The foreign-file check treats every path under a `.vibelang/js/` directory as the flow's own output, because each emit writes that tree again from the sources and a record names its dependencies' digests.

When an Oxlint config's `jsPlugins` names a package the run migrates, setup preloads `vibelang/register` (`NODE_OPTIONS="${NODE_OPTIONS:+$NODE_OPTIONS }--import=vibelang/register"`, as for Vite configs) in every package script that runs Oxlint, `oxlint` or `vp lint`, and in that package's test scripts, whose RuleTester spawns Oxlint: Oxlint's plugin host is Node, which loads the plugin's `.vibe` modules only through the loader. Like the Vite wiring, the prefix needs a POSIX shell.

Setup adds the `vibelang-vite` plugin to the Vite or Vitest config the tests load, as `vibelang({ register: true })`, so a `node` or `bun` process a test starts on the sources, such as a command-line program, loads `.vibe` modules too; a config that already has the plugin gains `register: true` in its options unless it sets `register`. When the test command, or the package script it runs (`pnpm test`), names one with `--config`, such as a monorepo's shared `../../vite.config.ts`, setup wires that file, and the package that owns it gets `vibelang` and `vibelang-vite` as dev dependencies. Otherwise it wires each package's own config. It then adds the plugin to every other Vite or Vitest config that bundles migrated sources: each config in a migrated package, or in a package that depends on one through workspace packages (`"foldkit": "workspace:*"`), such as an app's, an example's or a website's, so their builds and dev servers load `.vibe` modules too. Configs under `templates/`, under a directory whose name contains `fixture`, or under a package's `test`, `tests` or `__tests__` directory are left alone, Parentheses, `as` and `satisfies` around the config object or its `plugins` array, as in opencode's `plugins: [...] as any`, do not stop the edit. An electron-vite config (`electron.vite.config.ts`) gains the plugin in each of its `main`, `preload` and `renderer` builds, and a config whose package starts a Vite worker (`new Worker(new URL(...))`, a `?worker` import) gains it in `worker.plugins`, which Vite builds workers with. A config whose shape the edit does not know, such as one that calls no `defineConfig` or whose `plugins` is a variable, is named in setup's warnings for a person to wire, the config the tests load included, and setup goes on.

When a Vite config's runtime import graph reaches a `.vibe` module or a selected source directory that setup will migrate, setup also wires its `vite` package scripts with `NODE_OPTIONS="${NODE_OPTIONS:+$NODE_OPTIONS }--import=vibelang/register"` and `--configLoader native`. This applies before config evaluation, including imports through helpers and re-exports; the application still uses `vibelang()`. Existing `NODE_OPTIONS` are retained, and rerunning setup does not duplicate the preload or flag. Type-only imports and unrelated commands stay as written. A config without a matching script produces a warning with the required settings. A Vite config wired this way is itself a migration candidate: the plan accepts it (other tool configs, which their tool finds by name, stay `.ts`), the codemod points each wired script at the renamed file with `--config vite.config.vibe` (a written `--config` follows the rename), and a per-file revert restores the scripts with the config. For direct invocations, use `NODE_OPTIONS="${NODE_OPTIONS:+$NODE_OPTIONS }--import=vibelang/register" vite build --configLoader native` (and the same for dev or preview). Native loading uses Node's ESM resolution: config helpers need explicit source extensions and package exports instead of `tsconfig.paths`; their `.vibe` files need a project that includes them. A setting inside the config cannot select its own loader. See the [Vite guide](../../../docs/user/src/setup/vite.md#when-the-vite-config-imports-a-vibelang-module).

A package whose tsconfig is solution-style, `"files": []` with `references`, stands for the projects it references: setup wires each of them, and every check, `--fix` run and declaration emit goes over each, its declarations in a subdirectory of the package's own. `upgrade-effect` takes the run's options, which setup and the later steps read from the run: `--base` and `--bookmark` (above), `--package` and `--source` more than once, `--tsconfig` (default `tsconfig.json`, the project the tests check), `--dts-tsconfig` (default `tsconfig.build.json` when it exists: the project whose declarations are the public API), `--install`, `--test-report <pattern>` for a test runner without Vitest's JSON report, a regular expression whose named groups `name` and `status` read each test's printed line (so a baseline with failures, such as tests that need cloud credentials, is compared test by test rather than by exit status), `--no-wire` for a target that already has VibeLang (setup then leaves its wiring as it is, except that a package of the run with no `vibelang-runtime` dependency yet, such as a directory added to `--package` after an earlier setup, gets the dependencies, scripts and tsconfig edits above, with the specifiers a wired package of the run names, rebased to its directory, and the target installs again; with no wired package in the run, setup wires nothing), `--include-private-declarations` to check private packages' declarations too, `--max-files` and `--max-lines` per batch (6 and 900), and `--allow-dirty`.

The `--no-wire` repair uses the same package-wiring rules as ordinary setup, including referenced tsconfigs, import-spelling warnings and sidecar-directory setup for a newly added package whose tracked code enumerates TypeScript files. Its sidecar receipt and stale-output cleanup apply only to the newly wired projects. After it adds the new packages, running setup again changes nothing; packages that already depend on `vibelang-runtime` keep their existing wiring.

### As a Smithers flow

`flow.ts` declares the same steps as durable actions of `Flow.make("migrate", ...)`. One execution upgrades Effect, sets the run up and plans it the first time, then migrates the next batch and reports; the next execution migrates the batch after it. `run.ts` runs one execution on the in-memory engine:

```sh
MIGRATE_AGENT="<agent command>" bun .smithers/flows/migrate/run.ts --run <run> --target <repo> \
  --package packages/core --test "pnpm exec vitest run" --test-cwd packages/core --toolchain <toolchain>
```

The agent steps read `MIGRATE_AGENT` through Effect `Config`; without it, they fail with the prompt to answer, and the standalone steps take over from there. The agent is a command, not `@smthrs/agent`: a repair edits files and runs the target's compiler and tests in its repository on a build host, which a coding agent's non-interactive mode does today, and this repository's `.smithers` composes no model seat for `AgentAction`. A test supplies a scripted command.

## The idiom context

`context.md` is the repair agent's system prompt. `build-context.mjs` generates it, so it is never edited by hand:

- `rules.md`, this flow's own rules: the current call rule (a call runs where it stands; only a function literal defers it), every VibeLang form, wrapping Effect mindfully, platform access only through services, Effect's modules or `Experimental.*`, hatches only for real Promise and callback libraries, identical declarations, every test kept.
- The VibeLang skill, `packages/compiler/skills/vibelang/SKILL.md`.
- The convert flow's cheat sheet and worked examples (`../convert/`).
- Codemod formats only the files its write-ahead journal authored, including remaining TypeScript importers whose `.ts` specifier grows to `.vibe`. Protected tests and fixtures are excluded. The `formatted` receipt names every formatted file, exit status and `source-format.log`; `platform.formatted` retains the sibling subset. Revert formats only the files its reverse edits authored and records `revert-format.log`, so shortening a specifier also restores the target style. Unrelated local changes stay untouched.
- Tests remain unchanged; their unconfigured source bundle graphs stay TypeScript. Inventory records `bundledBy` and `bundleReason` for each reached module, naming the test or test-only helper, line, input entry and bundler (decided detail 272). Static literal inputs, including `new URL(..., import.meta.url)` through `Path.fromFileUrl`, are followed through runtime imports, workspace export maps and aliases. Type-only edges and emitted JavaScript entry points are boundaries. A native adapter already supplied unconditionally by an ESM source plugin factory is proved through its exports, so that bundle needs no deferral. The draft reports each retained module, explicit plans cannot select it, and ordinary/one-pass rename guards recheck the current tests before writing. Inputs that cannot be resolved statically produce `bundleWarnings` for review; they are not certified as source-free.
- Source-child launchers using Node `spawn`/`spawnSync` or Effect `ChildProcess.make` get native preloads for typed source entries. The helper resolves `vibelang/register` (Node) or `vibelang/bun` (Bun) in the parent package and passes an absolute preload to children, including those with another `cwd`. Node installs its preload after existing hooks; Bun preloads before `run`. Built JavaScript entries keep their original arguments. Literal or single-use const argv arrays are supported; shared/dynamic arrays, CommonJS and dynamic imports get located warnings. Setup leaves tests, fixtures, test-only helpers, generated files, vendored sources and project output unchanged. Published runtime launchers install `vibelang` as a dependency; private/build launchers use a development dependency.
- A platform split must not add a published module; a published package with wildcard exports or no export map keeps the platform code in TypeScript. Private packages and packages with explicit entry points may still split; the declaration oracle rejects any new public declaration, including a `.platform.d.ts`. A refusal is recorded in `codemod.json`; it never writes a sibling or edits the source. Wildcard packages are handled conservatively because a package can publish more than one build layout.
- Setup wires programmatic Rolldown builds and exported, explicitly typed Rolldown plugin sets with `vibelang-unplugin/rolldown`. Named/default/namespace imports, direct dynamic imports and local lazy module loaders are supported. Literal plugin arrays keep their existing order; the native plugin goes first, or after any index whose `name` a package test reads. Exported factories construct a fresh plugin on each call. Calls with unknown options or overriding spreads get a file-and-line warning. Tests, fixtures, test-only helpers, generated files, vendored sources and project output stay unchanged. Published source/plugin sets use runtime dependencies; private or build-only code uses development dependencies.
- The platform globals table, `docs/user/src/platform/platform-globals.md`.

```sh
node .smithers/flows/migrate/build-context.mjs           # write context.md
node .smithers/flows/migrate/build-context.mjs --check   # fail when it is stale
```

## Each run improves the next

A run's `issues.jsonl` is the input to the loop that improves the flow. The repair agent appends one entry per lesson; upgrade-effect and setup append one when the Effect upgrade or setting VibeLang up breaks a target test before any file moves, and still finish, so no batch is blamed for it. A runner without per-test results, such as `bun test`, is compared by its exit status, and the issue names the logs from before and after.

| Entry | Where it goes |
| --- | --- |
| `codemod-gap`: a rewrite made by hand that a rule could make (`pattern`, `before`, `after`, `count`) | A `--fix` rule in the compiler: a quick fix for the diagnostic (`typescript/tsc/internal/vibelang/tsforms_*.go` or `lsrules_fixes.go`), its code in `tsFormFixCodes` when it is safe, and a case in `typescript/vibelang/cases/` with the before and after. The next run's codemod applies it. |
| `idiom`: a lesson the context did not teach (`lesson`, `before`, `after`) | One line in `rules.md` (or the skill, when it is about the language rather than migrating), then `node build-context.mjs`. |
| `issue`: a VibeLang bug or missing feature (`title`, `repro`, `expected`, `actual`, `files`) | A VibeLang issue with the reproduction, fixed with a test. The blocked files stay `.ts` until it is fixed; the next run's plan picks them up. |

`report.md` lists all three, with the rewrites `--fix` applied and refused, so a run's report says which rule to write next.

### What `--fix` rewrites

| Effect TypeScript | `--fix` writes | Code |
| --- | --- | --- |
| `Effect.gen(function* () { … })`, as a value or the whole body of an arrow, a function or a method; `Effect.fn(function* (…) { … })`, `Effect.fn("name")(…)`, `Effect.fnUntraced(…)` | `effect { … }`, `effect (a) => { … }`, `effect function f(a) { … }`; a span as `try Effect.withSpan(effect { … }, "name")`. `yield* e` becomes `try e`, `try e.asEffect()` for a Yieldable, or `throw e` for an error in a statement; a held program `const p = load()` becomes `const p = effect { return try load() }`; a generator's `throw` becomes `return try Effect.die(e)` | EK1002 (D470) |
| `x.pipe(Effect.map(f), Effect.asVoid, stage)` whose receiver is an Effect or with a stage of `Effect` | `x \|> Effect.map(%, f) \|> Effect.asVoid(%) \|> stage(%)` | EK4502 (VIP-23) |
| A program a module holds, `export const p = load("x")`, in a variable, a field or an element | `effect { return try load("x") }` | EK1001 (VIP-2) |
| `Option.gen(function* () { const a = yield* maybe; return a })` with statement-position Option yields | An eager plain function body, checking each yielded Option once, returning its `None` early or a fresh `Some` on success; nested expressions, functions and `try`/`finally` keep a refusal | EK1002 (foldkit-36) |
| `Option.match(v, { onNone, onSome })` as a plain choice | `do { const $s = v; const { onNone, onSome } = handlers; match ($s) { when Option.Some(let value): onSome(value); default: onNone(); }; }`, keeping the handler object's construction and property reads before the choice; a choice returning a program keeps a refusal | EK4839 (foldkit-38) |
| `pipe(x, Option.map(make()))`, a stage whose argument is a call, a property read or an object | `do { const $input = x; const $arg0 = make(); $input.map($arg0); }`: the subject and every stage argument are evaluated first, in pipe order, then the method chain runs | EK4840 (foldkit-39) |
| `Match.orElse(({ _tag, value = fallback() }) => …)`, a default handler that destructures | `default let $v: do { const { _tag, value = fallback() } = $v; (…); }`, binding the value once and destructuring only when the default runs, so getter reads and defaults stay where they were | EK4839 (foldkit-49) |
| `Match.when(String.startsWith("Core"), …)`, `Match.whenOr("Exact", String.startsWith("Codec"), …)` | `when let $s and if ($s.startsWith("Core")): …`, and one guard joining the literal and prefix alternatives with `\|\|` (`&&` for `whenAnd`), keeping case order | EK4839 (foldkit-53) |
| `const withChoice = Match.withReturnType<T>()` passed as a stage, `Match.value(x).pipe(withChoice, …)` | the same `match` the inline hint gets, with the hint read kept before the subject (`do { const $s = x; withChoice; $s; }`) so its initialization order is unchanged; a hint whose type is shadowed at the choice keeps a refusal | EK4839 (foldkit-56) |
| `Match.value(x).pipe(Match.when(…), …, Match.exhaustive)`, `pipe(Match.value(x), …)`, `Match.type<T>().pipe(…)` | `match (x) { when …: …; default: …; }` | EK4839 (D472) |
| `pipe(x, Option.map(f), Option.getOrElse(g))`, `x.pipe(Option.…)` | `x.map(f).getOrElse(g)`, or `Option.fromNullishOr(x).map(f)` for a value that is not an Option | EK4840 (D473) |
| `type X = typeof X.Type` just before `const X = Schema.Literals([…])`, or another schema other than a struct whose every part has a type | `schema X = <type>` | EK4841 (D474) |
| In effect code, a call of a plain function of a `.ts` module or a package that says nothing about its exceptions, `Dialect.integer(sql)`, or whose `@throws` names a class the file can't reach | `try Effect.orDie(Effect.try({ try: () => Dialect.integer(sql), catch: (error) => error }))`: an exception stays the defect it was, and `E` and the declaration stay as they were. An operand that runs an Effect moves to a `const` before the statement, unless that would change what runs. Never `trusted` or `trustedPackages`: those are claims about code that someone read | EK4401 (VIP-4) |
| The same call in a function with no Effect operation | `: infer _` on the function, which stays plain, so its declaration does | EK4401 (D500) |
| `import { Array } from "effect"`, or another of Effect's modules a JavaScript global names (`String`, `Number`, `Boolean`, `Function`, `Symbol`, `BigInt`, `RegExp`) | `import { Array as Arr } from "effect"`, and `Arr.take(…)` for each use | EK4842 (D475) |
| Effect error classes, `Context.Service` classes, `Schema.Struct` constants, `Effect.Effect<A, E, R>`, a running `Effect.succeed` or `Effect.fail`, catch combinators, `Effect.withSpan`, `provide` and `provideService` | `error`, `service`, `schema`, `A!E!R`, the value or `throw`, `catch` and `match`, the block forms | EK4830-EK4836 |

Each rewrite keeps the program's meaning and type, or it is not made: the diagnostic it leaves says why in a note that starts `No quick fix:`.

#Match return-type hints keep checked type context: an untyped binding, including
a destructured binding, gains an annotation. In another expression position,
a local typed binding inside `do` preserves the result contract. The quick fix
never inserts an `as` assertion for the hint.

## Known codemod gaps

These patterns have no `--fix` rule yet. The counts are from the four first targets (foldkit, t3code, alchemy and opencode: 44,235 `Effect.gen` sites). A repair records a `codemod-gap` only for a pattern not listed here.

| Pattern | Count | Why there is no rule |
| --- | --- | --- |
| A call that builds a program no `yield*` runs and no `const` holds, as `Effect.log("x")` alone in a statement | | It would run where it stands |
| `Match.when` with a predicate or an array pattern, `Match.discriminator`, a handler that builds a program | | No pattern tests the same, or the arm's call would run |
| An Option stage whose argument is a call, `Option.getOrElse(makeDefault())` | | The chain would evaluate it after the stage before it runs |
| `Option.match(x, { onNone, onSome })` | 3 (foldkit) | EK4840 rewrites Option pipelines only; a `match` over `Option.None` and `Option.Some(let v)` is the target |
| A pure exported or callback helper that TypeScript consumers call synchronously, `(xs) => xs.filter(p)` | 20 (foldkit 13, t3code 5, opencode 2) | Before D550 lands, context can make it an Effect function; `: infer _` keeps it plain. Under D550 a function with no Effect form is plain by syntax, and the annotation is moot |
| `x.pipe(Stream.map(f))` on a Stream value | 1 (foldkit) | EK4840's method rewrite covers Option only |
| A cold `Effect.map` or `orElseSucceed` program, `Effect.currentParentSpan.pipe(Effect.map(f), Effect.orElseSucceed(() => undefined))` | 2 (alchemy) | The deferred direct-style body depends on each use of the value |
| A schema constant written before its type alias, `const X = Schema.…` then `type X = typeof X.Type` | 818 of 820 such pairs that are not structs; 1,474 struct pairs | A schema declaration's declaration file lists the type before the constant, so the rewrite would reorder the module's declarations: EK4841 leaves these pairs, and EK4832's rewrite of a struct pair changes the declarations |

## Tests

The optional lint-engine checks use `VIBELANG_OXLINT_NODE_MODULES` for an
installation of `eslint`, `typescript-eslint`, `oxlint` and `@oxlint/plugins`.
Set `VIBELANG_LINT_ORACLE_NODE_MODULES` to the same installation, including
`espree`, to compare ignore scopes against Oxlint. Those native comparisons
use `--no-error-on-unmatched-pattern`, so an all-ignored project still
produces JSON with an empty diagnostic list.

```sh
node --test .smithers/flows/migrate/test/*.test.mjs
# Also registered in the compiler package fast gate:
node --test packages/compiler/test/migrate-test-diff.test.mjs
```

The migration properties replay the Alchemy batch-scope, Smithers dual-lockfile and T3code Bun-program witnesses. Generated cases vary selected files and fix rounds, root and nested lockfiles, and workspace dependency paths; they check preserved files and configuration as well as the intended edits.

The deterministic steps are tested against fixtures: import parsing and rewriting, `--fix` output, diagnostics, the plan's draft and validation, the setup edits, test-report comparison, declaration canonicalization (it needs `bun install` in `packages/runtime`, whose TypeScript has the compiler API), the run's state machine, issue validation and the generated context.

`Option.match` quick fixes preserve statement and expression contexts, including conditional bodies and line breaks; the flow still reports genuine stable refusals.

When a package script runs Oxlint directly or launches a JavaScript/TypeScript runner that does, setup keeps upstream `oxlint` and includes `.vibe` in extension selectors. Only executable command positions are rewritten: process-spawn/exec arguments and shell templates, including local command bindings. Package names in dependency arrays, metadata and imported helpers remain unchanged. It follows local imports of runners, retains their package and directory filters, and excludes `.d.vibe.ts` sidecars. Plain commands such as `oxlint src` retain their ESLint pass. File-list runners invoke `.vibelang/oxlint.mjs`: upstream Oxlint checks their TypeScript files and the generated ESLint configuration checks their VibeLang files with the repository's JS plugins, rule names, severities and override globs. JSON output merges both passes in Oxlint's diagnostic shape, preserving `.vibe` source lines and warning severity. `--deny-warnings` fails on warnings in either pass. No patch or fork is installed. An invocation that denies warnings keeps that policy when setup refreshes its generated ESLint pass; removing the native option removes that pass's warning limit.

The ESLint configuration preserves directory-wide overrides as well as extension globs. Its `oxc/no-accumulating-spread` counterpart is checked against upstream Oxlint; an enabled rule without a counterpart fails a file-list runner with the rule's name. This prevents silent rule loss when a repository adds another native rule.

Lint configuration follows a module across its rename. Setup, the codemod and `revert` point each literal path in an Oxlint or ESLint configuration (`overrides[].files`, `ignorePatterns`, `ignores`, or any other string that names the file, from the configuration's directory or the root) at where the module is now, so a rule silenced on `x.ts` stays silenced on `x.vibe`. A module the codemod split keeps the path of its `x.platform.ts` sibling beside it. An Oxlint glob ending in `.ts` that matches a moved module gains its `.vibe` spelling, because native `vibelang lint` reads a glob as written; an ESLint glob stays, because the repository's parsers do not read `.vibe`. Setup repairs what earlier runs left.

A directory containing only `.vibe` files still runs the ESLint pass. Setup adds `--no-error-on-unmatched-pattern` to the native Oxlint invocations, which have no TypeScript left to lint, and file-list adapters handle empty native directory scans the same way.

Oxlint disable and enable comments keep their original scope and source locations. The generated parser bridge translates only parsed directive comments, including core and TypeScript rule aliases; it does not rewrite source strings or user files. Unused directives remain quiet, as in Oxlint's default configuration.

A toolchain switch must not turn new test failures or compiler errors into the next baseline. The flow compares the unchanged native sources with the installed predecessor and candidate compilers, saves raw test reports and compiler identities in `baseline/`, and rejects new failures, missing passing tests or a newly failing command. Setup repeats the test comparison after wiring. A rejected `baseline/admission.json` also blocks replay, planning, codemod, verification and recording; repair the toolchain and start a fresh run from the original source. Existing upstream failures remain visible.

Detail 279 keeps modules whose Effect imports are only types in TypeScript by default. The inventory and `report.json` keep every owned source and test, count automatic candidates separately, and name each retained type-only file and reason. Explicit selection still warns and must pass every original compile, declaration, runtime, tool and protected-test check; import spelling does not establish the validity of a source program. Existing plain `.vibe` modules remain legal.

Declaration verification requires a zero compiler exit as well as identical public bytes. Global option diagnostics and nonzero exits remain in the verification receipt even when files were emitted or the diagnostic names an unmigrated source.

A failed declaration command is labelled `EMIT FAILED` in the report even if its raw files compare equal.

When tests live in `test`, `tests` or `__tests__` outside their nearest `tsconfig.json`, setup can write that test directory’s `tsconfig.json` extending the existing complete test project. It checks the original options and complete file membership and records the selected project, prior configuration, files and identity hashes in `baseline/logs/test-projects.jsonl`. Existing local configs and submodules remain unchanged. Missing or ambiguous project evidence produces a warning instead of a guessed configuration. Test bodies remain byte-identical.

Staged VibeLang tarballs replace only entries in `dependencies` and `devDependencies`. Published peer and optional dependency ranges keep their original portable specifiers.

Upgrade test fixtures provide both predecessor and staged compiler checks. Only the predecessor’s VIP-only invocation mutates the original source; failed baseline checks retain the original manifest and sources.

Shipped-root resolution checks retain the exact declaration graph, including each target. A published specifier spelling may use only the existing `D298` same-declaration proof; it cannot excuse a retargeted edge or another changed byte.

The write-ahead codemod journal also includes platform siblings: it keeps the unsplit original module and plans sibling creation before any rename, write or compiler child. Replay completes a partial split, and per-file revert restores the unsplit source and removes only its recorded sibling. An existing companion is preserved.

The split tells a value from a type of the same name, Effect's schema pattern `const Shape = Schema.String` with `type Shape = typeof Shape.Type`: moved code that reads `Shape` as a value takes the value, and a type read takes the type. The module keeps its platform code with a named cause when the moved value's type of the same name, or a type that reads the value, stays in the module, since the module's declaration would then import the value from the sibling.

The same durable rename journal covers whole-scope mode: an interrupted rename resumes before compiler work, and bulk reverts restore the original source bytes.

### Source filename wiring

Before the compiler starts, `codemod` scans the inventory's source files
and owned tool configurations for exact string filenames naming a renamed
module, even when a configuration is outside the configured source directories.
Recognized `import.meta.glob` and imported `glob`/`globSync`/`globby`
calls gain native sources while retaining TypeScript coverage and excluding
`.d.vibe.ts` sidecars. An extension array gains `.vibe` only when its sole
selector use already excludes those sidecars. Package export maps retain the
exact-entry wiring above; TypeScript config globs retain setup's include wiring.
Binary files and directory symlinks are skipped.

The extra configuration scan includes TypeScript and JavaScript `*.config.*`
files, such as `tsdown.config.ts`. Explicit `entry` arrays and maps, `input`
paths and `build.lib.entry` paths follow the renamed module. Test-runner
configurations, tests, fixtures, generated trees, vendored packages and
submodules stay outside this extra scan. Resuming an older journal adds
configuration edits while retaining its earlier source-literal receipts, so
`revert` can restore both. `referenceScan.toolConfigFiles` records the configuration
count; a scope upgrade also records `upgraded`.

Every changed literal is recorded in `referenceEdits` with its file, line,
original spelling and kind. Assertions, expected values, test names and
type literals stay as written. Unknown glob dialects and unguarded extension
lists produce `referenceWarnings` for repair. The journal flushes all edits
before mutation; replay preserves checked hand repairs, and `revert` restores
exact filename literals in either order.

Glob matching caches one compiled matcher per literal across the source scan.
Only path-shaped patterns shorter than 200 characters enter bounded brace
matching. `referenceScan` records file and matcher counts and elapsed time.

Selector rewrites require the complete tracked file inventory. The flow records
exact selected names before and after each rewrite, maps renamed sources back
to their originals, and refuses additions, drops or generated sidecars.
Declarations already matched by the original glob count in its original set.
`selectorChecks` in the codemod receipt and repair prompt provide the exact
names and counts for the PR description. `verify` repeats this check against
the final inventory; missing proofs and inventory growth fail verification.
Establish an approved source companion before taking the selector inventory;
a changed count cannot be waived or subtracted away.

Only a recognized glob's direct pattern argument, or an array of positive literal patterns, uses the automatic selected-set proof. Matching options, exclusion arguments, transforms, spreads and negative-pattern arrays require manual wiring. Exact filename glob operands retain both the proof and per-module revert bookkeeping. Extension lists require an unmodified array or unshadowed global `Set`, a direct sidecar guard, and `file.slice(file.lastIndexOf("."))` or `substring` on that same filename. Unknown extension helpers and guards on another value are refused.

The final verification reads each affected source once, rechecks its current glob contract or extension guard and literal count, then checks exact logical source names against the final inventory. A repaired selector cannot reuse stale proof metadata; a legacy exact-filename glob needs its original proof too. Selected-set checks remain available in the repair prompt for the PR description.

An extension regex that filters a listed directory, such as t3code's `/\.tsx?$/.test(file)` (decided 04:00Z (B), for every repository), becomes `/(?<!\.d\.vibe)\.(?:tsx?|vibe)$/`: one literal that adds `.vibe` and excludes `*.d.vibe.ts`. The regex must end in a known `.ts` extension group (`\.ts$`, `\.tsx?$`, `\.(ts|tsx)$`, `\.[cm]?tsx?$` and the like) with no flag but `i` or `u`, sit in a file that calls `readdir`, `readdirSync`, `opendir`, a `glob` function or `walk`, and be used only as `R.test(x)`, inline or through one `const`. For a named regex, every resolved use must be a proven file-selection predicate; sharing it with an assertion or other unproved logic refuses the entire widening in both the codemod and `verifyTestDiff`. A regex that strips, splits or matches, one in an `expect` or `assert` call, and one in a file that lists no directory stay as written. Every other path test in the file, each string literal under `endsWith`, `includes` and `startsWith` and each other regex, must answer the same for a renamed module's `.ts` path and its `.vibe` path; `!file.endsWith(".gen.ts")` refuses a renamed `x.gen.ts`, with a warning. The receipt's `source-regex` proof lists the selected files of the test's package and checks the identity over the whole inventory, and `verify` accepts only this exact widening, with the same checks against the pinned trees.

Glob selected-set proofs also check source directories and workspace package directories as possible execution roots, using the complete tracked source catalog. A match that would add an unrelated native source from another package is refused.

Detail 272 still keeps source-text assertion modules in TypeScript. Literal path and exact-set selector rewrites preserve filesystem identities; they do not authorize rewriting source scans or assertions. The Foldkit corpus retains the refused source-text witness alongside the supported filesystem identity test.

Native config proof and rename/revert also recognize explicit `node --import vibelang/register ./node_modules/vite/bin/vite.js` launchers. Existing native loader flags and preload spelling are preserved.

Whole-scope planning uses the same native-loader receipt for Vite configs as batch planning. A config without that receipt stays TypeScript with a recorded cause.
Before checking a batch, `verify` formats its migrated sources so declaration
identity covers their committed spelling. If `record` changes any tracked file
while formatting, it reruns verification and refuses a failed result before
committing. `verificationRefreshed` records that extra check, and token counts
come from the final formatted sources.


After formatting, `record` rejects protected test edits before rerunning verification, then checks again before committing.

Declaration guard regression fixtures create a Jujutsu baseline before calling `verify`, matching the repository precondition of a migration run.
Before upstream and upgraded test controls, setup's baseline, and every candidate test run, the flow executes declared product build prerequisites. It uses an existing root `build:packages` script when present; otherwise it builds the selected package's local workspace dependency closure in dependency order, then the package, using each existing `build` script. Unrelated workspace packages stay outside that closure; an aggregate build handles declared cycles. It never adds a build call to a test. Each `*-build.json` receipt records source commits, dependency and toolchain identities, commands, stages, timing, exit codes and signals before a test baseline can be written. A failed build stops preparation; candidate builds refresh the actual distribution tests load. Failed legacy baselines without preparation evidence cannot pass `verify`: retain their historical reports and start a fresh prepared control. A correctly prepared control's intrinsic failures remain named in verification, which separately reports the actual test-command status.
Reports, verification summaries and recorded commit messages distinguish a matching baseline from passing tests. A prepared original failure may remain unchanged under the accepted baseline comparison, but it is labelled as failing, retains its actual command exit and assertion failure names, and is never presented as a green package. Older receipts without a command status are labelled as unknown.


The single measurement job installs and builds each of `main`, `previous`, and `candidate` before its tests. Each side retains its own build receipt; a failed build stops measurement before tests can establish a misleading baseline.

Setup adapts publication helpers that map package `exports` or nested `imports` conditions from TypeScript source paths to built JavaScript and declarations. Named path helpers such as `output(...)` retain the script's own package-specific `dist` and `types` layout. Migration-generated `vibelang-source` entries and earlier paired sidecar/default source entries use that same mapping, so packages retain working installed entry points. Shared script packages are included; tests, fixtures and helpers only tests import stay as written.

When extension rewriting is enabled, a migrated paths alias uses a relative source name resolving to the same module. The flow reads the importer's effective `rewriteRelativeImportExtensions` option, including `extends`, and leaves its value unchanged. The forward receipt records the authored alias so native importers revert to their exact original spelling. Native `TS2877` checks remain in force. A migrated module's paths alias to a module that stays TypeScript keeps its authored spelling, `~/state/filesystem` as written: it resolved under the same configuration before the rename, and `~/state/filesystem.ts`, a non-relative TypeScript name, is `TS2877` under extension rewriting.

The `fixToFixedPoint` preservation boundary applies on every exit, including interruption, signals and missing per-file statistics. A read-only compiler query lists the project's VibeLang sources and their dependency closure before the fix loop. Every pre-existing source in that graph outside `only` is restored from its original bytes before failure is reported; verified writes in selected modules remain available for resumption. Unrelated projects keep their concurrent edits.

Within one flow process, fix calls whose VibeLang source graphs overlap take turns; disjoint graphs run concurrently. Use separate checkout copies for separate processes fixing overlapping graphs. The `*.scope.log` receipt records the compiler's input list, lease acquisition wait and release, without source payloads. A failed scope query stops before any writable fix.

A runtime host that resolves a package entry, reads its extension and scans source filenames keeps its owning package native. Statically named workspace packages in that observer stay native too. The scope receipt records `RUNTIME-SOURCE-ENUMERATION` with the observer and line; other packages continue. The flow leaves the host and its virtual module names unchanged (VIP-34).


Inventory treats executable bare filename literals such as `alchemy.run.ts` or an explicit `index.ts` as lookup names, so those modules remain TypeScript. It ignores comments, embedded code strings, type-only filename literals, module specifiers and fixture code. It parses only potential lookup-bearing files, including escaped filenames; directory resolution alone does not pin an `index.ts` module.

Revert restores recorded imports of native and previously existing VibeLang consumers, preserving the original alias and suffix. The migration's baseline or write-ahead rename journal identifies whether the importer was already `.vibe`; a consumer converted in that batch still names the restored native source as `.ts`. The fallback repairs unrecorded references without rewriting an original name it just restored.

Import rewrites accept recorded `preserve` names together with injected `read` and `write` callbacks; the callbacks keep transactional source access while the recorded names stay intact.



Native source runtime exports in a mixed package use the emitted graph only when they belong to a runtime import component containing a Vibe source. Unrelated native export paths stay as written. Components include importers and dependencies so public singletons remain shared. Computed or unresolved runtime edges conservatively retain package-wide routing; each emit receipt records the mode, reason and module counts under `runtimeRouting`. Wildcards retain their native fallback and gain exact routes for connected sources; a nested `types/default` source target identifies generated exact routes for idempotent cleanup and revert.

Connected native exports use that package's actual emitted graph, including native `.ts` entries and wildcard exports that share an output mapping. Their `types` and `vibelang-source` conditions retain the native source path; `default` names its emitted JavaScript. Source loaders keep relative and package imports on one instance. A package whose only `.vibe` file is private still receives the same routing; reverting its last source module restores the native export entries.

Native runtime entries route only to package-owned JavaScript files the emit actually wrote, even when the compiler reports errors. A nonzero emit such as `TS6059` on a sibling package's fixture does not discard those outputs. Each `emittedJs` receipt retains the compiler's `code` and `diagnostics`, and records `exportsChanged`. Compiler checks and tests still gate the batch; a missing output never gains an emitted route.

Relative non-code imports in emitted JavaScript resolve to their original source assets. Moving a native entry under `.vibelang/js/` therefore keeps text, JSON and other source assets reachable without duplicating them. Static imports, re-exports and dynamic imports keep their attributes; comments, unrelated strings and code-module names stay as emitted. The source asset's bytes are unchanged.

Setup preserves source declaration resolution for typed tools in referenced projects. It changes owned `disableSourceOfProjectReferenceRedirect: true` settings to `false`; an external preset stays unchanged and its owned inheriting config gets a local override. This lets a TypeScript namespace barrel resolve a native leaf through `x.d.vibe.ts` instead of mapping emitted declarations back to a foreign source extension. Fixtures, submodules and vendored projects stay unchanged. `setup.json` records each setting in `wired.declarationRedirects`. Existing `--no-wire` runs retain their configuration; rerun full setup to apply this adapter. Run the native/Oxlint corpus and generated namespace/reference controls with `VIBELANG_DECLARATION_REDIRECT_ORACLE=1`, `VIBELANG_BINARY` and `VIBELANG_OXLINT_MODULES` pointing to the compiler binary and an installed Oxlint/tsgolint dependency directory.

The scope guard admits protected files only after a fresh `testDiff` proof certifies their permitted literal, selector or formatter-only edits. It checks the proof before and after verification and before recording, so a later assertion edit cannot reuse an earlier receipt. Setup manifests remain in the setup commit; an unrecorded manifest edit is still foreign.

A stock Strada compiler that rejects `--singleThreaded` is retried with only that Go-specific switch removed. The rejected command stays in the sibling `.single-threaded.log`; final emit errors still fail the oracle. The selected compiler is preserved.

The codemod preserves value-only TypeScript helpers before the fix gate. It probes the selected compiler once: a compiler using C1 legacy inference needs `: infer _`, while a compiler implementing VIP-1 keeps unmodified functions plain and gets no marker (decided detail 269). The durable journal and batch/one-pass receipts record `functionModel` and `plain`; schema, `Layer`, `Stream`, tagged error and overloaded reader helpers retain their TypeScript declarations.

The function-model probe must finish successfully and emit a recognized declaration before any source rename. A signal, timeout, missing declaration or unknown declaration stops the codemod with its stage and reason; it never guesses that a failed probe means legacy C1.

The codemod also points package scripts at renamed entry points: `node --import vibelang/register scripts/generate.ts` becomes `node --import vibelang/register scripts/generate.vibe`. It records each manifest, script and module in `packageScriptEdits`, in the durable journal and in both batch and one-pass receipts. Reverting that module restores its script paths independently.
