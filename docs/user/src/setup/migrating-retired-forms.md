# Migrating retired forms

`vibelang --fix` rewrites each retired or legacy form to its VIP form or to the Effect TypeScript it means. The [specification](https://vibelang.sh/spec/007-tooling#compiler-and-tooling-requirements) states, for each form, its diagnostic and the rewrite it produces, and one rule for all of them: a rewrite that can't preserve types, behavior and declaration output refuses at that site. This page describes how the rewrites work. It is not normative: where it and the specification differ, the specification and the compiler's tests decide.

## General migration rules

**Migration** rewrites toward the VIP form or native Effect TypeScript and preserves evaluation order, captures, the call-versus-run phase, coldness, error and environment channels, and public declarations. It never edits a test or a fixture: a test that bundles `.vibe` passes unchanged, or its modules stay `.ts`. A default plan leaves Effect type-only users in TypeScript. A legacy `try make()` of a removed plain wrapper loses its `try`, whatever the result's shape. An old call whose behavior it can't preserve keeps a `.ts` boundary, with an explicit refusal. It never invents `asEffect()`, never turns `Match.withReturnType<T>()` into an unchecked `as T`, and writes `try Effect.forkChild(program, options)` for the legacy `fork(program, options)`. Prelude cleanup keeps an explicit Effect import where removing it would change the declaration. A tool cache for type-directed compilation is reusable only while its source, declarations, configuration, versions and project are unchanged. A missing validation outcome is unverified: a later stage never inherits an earlier stage's exit.

## Stale `.ts` specifiers

The migration ships before enforcement: `vibelang --fix` repairs stale relative `.ts` names in the selected project's own VibeLang sources. `node scripts/migrate-stale-specifiers.mjs` repairs the repository corpus, including foreign importers, without renaming modules or applying other language migrations. Native TypeScript implementations stay native. Emitted JavaScript and declarations do not mask an available VibeLang source. The repair honors `rootDirs` and `moduleSuffixes`, so a migrated `user.native.vibe` is found through the same configured suffixes and native matches still win. With `rewriteRelativeImportExtensions`, the repair names `.vibe` or `.vibex`; a type-only project allowing source extensions can also use those names. Otherwise it names the actual runtime output, `.js` (or `.jsx` for a JSX-preserving target). The migrate flow uses the same project policy for newly renamed modules. An unresolved name without a migrated sibling stays unresolved. Run the repair before upgrading to the resolver that rejects stale native extensions.

## Trailing blocks

The repair is selected from the pinned legacy source, compiler and options, preserving the actual old program or callback kind and argument position; the callee's parameter type alone cannot decide it. If kind, placement or body preservation is unproved, refuse with an explanation. Comments stay in the source, though their printed placement and equivalent arrow layout can differ. A comment between the call and its block has no place in the rewrite, so the codemod leaves that site to the author; a block after an Effect dual that `0.0.10` placed elsewhere first uses its versioned compatibility repair, retaining a native call error or transitional `EK1023` for a type-correct appended call with changed meaning, without duplicate `EK1101` (VIP-34).

## The retired global `Effect` alias

Its quick fix keeps existing parentheses and written default slots, keeps required imports when globals are disabled, and is refused where it cannot keep the `Effect` namespace binding.

## Ordinary mutable-marker migration

The redundant `mutable` marker on an ordinary interface or object-type property or index signature is removed by `vibelang --fix`, including `--fix-migration-only`. Written `readonly`, comments, declarations and behavior are preserved. A plain `error` payload with a legacy `mutable` marker becomes an explicit compatibility class using the existing runtime error factory, retaining tagged matching. The project gate refuses conversions that introduce an error. Schema fields, schema errors, schema tuples and `data` bodies use their separate rules.

After the preserving codemods ship and all migration repositories have zero remaining accepted uses, these ordinary member and plain-error payload markers are rejected with `EK3410`. A method or identifier named `mutable` keeps its TypeScript meaning. This specifies the retirement target; it does not claim the held rejection implementation or consumer migration is complete.

## Legacy data receiver methods

Legacy Effect data receiver methods migrate to the resolved module’s data-first function: `Option.some(1).map(f)` becomes `Option.map(Option.some(1), f)`. The preserving codemod runs under `--fix` and `--fix --fix-migration-only` before rejection. It keeps receiver and argument evaluation once and in order, import evaluation, comments and exact public declaration output. It refuses a shadowed module without a safely reusable namespace binding, an alias whose import elision or deferred evaluation cannot be preserved, explicit type arguments, trailing blocks or changed declarations. Native/own methods, namespace calls, computed access and optional chains are not rewritten by this migration.

## Legacy prelude shorthand

For a legacy bare prelude `Scope` type, `vibelang --fix` writes `Scope.Scope`; `--fix-migration-only` and `--fix-vip-only` apply this migration too. It selects the resolved implicit binding and preserves comments, the declaration API and emitted JavaScript. A written import, local or ambient type, or type parameter named `Scope` keeps its TypeScript meaning. Prelude cleanup retains the qualified namespace type.

`--fix`, including `--fix-vip-only` and `--fix-migration-only`, expands the retired same-named module-export shorthand using the resolved binding: `Option<A>` becomes `Option.Option<A>`, and `FileSystem.of(impl)` becomes `FileSystem.FileSystem.of(impl)`. VIP-14 supplies module namespaces; a local type, an ambient type, an already qualified export and a namespace's own member keep their meaning. Prelude import cleanup retains these explicit export names. The migration preserves the emitted declaration and the runtime lookup.

## Legacy fork, try-statement and wire migration

The transitional bare `fork { ... }` spelling migrates with `vibelang --fix` to `fork effect { ... }` (VIP-2 and VIP-17). The insertion preserves the cold body, lexical captures, return value, Exit and declaration output; explicit Effect operands are unchanged. Retire the old spelling only after migration consumers have no remaining uses.

The `try statements` codemod migrates old Effect statement catches and finalizers to explicit Effects, `catch effect`, and native cleanup combinators under VIP-5. It keeps structural tag matching, handler order and the old successful finalizer input `Exit.void`. It refuses unsupported outward jumps, observed `do` completion and any rewrite that changes the declaration's [API identity](https://vibelang.sh/spec/001-functions#api-identity).

The `wire compositions` codemod replaces the retired resolved `wire` intrinsic under VIP-24 with explicit `Layer.provideMerge` composition. It evaluates each supplied layer once in source order and preserves the dependency order of the old graph. Opaque, duplicate or cyclic graphs, spreads and rewrites that change the declaration's [API identity](https://vibelang.sh/spec/001-functions#api-identity) require manual migration. An unrelated local function named `wire` keeps its TypeScript meaning.

After preserving migration, a bare `fork { … }` is `EK1707` and the resolved retired `wire` intrinsic is `EK2401`. The held enforcement changes still require landed codemods and zero remaining uses in every migration repository. The spec does not wait for those code receipts.

## Empty legacy trust wrappers

The resolved `trusted(f, [])` runtime wrapper is retired with `EK0407`. Its preserving `vibelang --fix` migration captures `f` at the original declaration and replaces private direct synchronous calls in explicit Effect bodies with an identity-mapped `Effect.try` and `Effect.orDie` bridge. Preserve the callee read, forwarding function, argument order, coldness, exact defect value and declaration output. Refuse escaping function values, changed exported `Trusted` types, lost comments or reordered Effect operands. A reviewed `.ts` helper with `@throws {never}` is another replacement. Listed-failure wrappers are outside this migration. As with other held retirements, ship the codemod and migrate all consumers before enforcing rejection.

VIP-4 recorded the same migration:

Migrate a private wrapper whose only uses are direct synchronous calls in explicit Effect bodies by capturing `f` at the original declaration and using the identity-mapped `Effect.try` / `Effect.orDie` bridge at each invocation. Preserve the original callee read, forwarding function, argument order, coldness, exact defect value and public declaration output. Refuse automatic migration when function values escape, an exported `Trusted` type would change, comments would be lost, or Effect operands cannot stay in order. A reviewed TypeScript helper with `@throws {never}` is another replacement. Calls with listed failure classes are outside this retirement.


## Legacy entry-dispatch migration

The legacy entry input is a module marked by a side-effect import of `vibelang/platform/node`, `vibelang/platform/bun` or `vibelang/platform/browser`. These compiler-only markers report `EK2601`, including in a module without `main`. A function named `main` alone remains ordinary source and gets no entry diagnostic ([VIP-26](https://vibelang.sh/vips/0026-top-level-and-main#decision)).

`vibelang --fix` expands an eligible legacy startup to an explicit Effect platform runner and removes the marker. An eligible startup is an exported, non-default, zero-parameter function declaration `main` with a body, without a checker-resolved top-level runner call under the pinned legacy compiler and options. If the marked module has no eligible startup, the fix removes the inert marker and keeps any explicit runner unchanged.

The `node` and `bun` markers select `NodeRuntime.runMain`; `browser` selects `BrowserRuntime.runMain`. Import Effect platform namespaces from their subpaths. Preserve exactly the platform and experimental layers selected by the pinned legacy compiler, including their nesting order; `bun` keeps `BunServices.layer` when selected. The runner receives `main()` for a legacy Effect function and `Effect.sync(main)` otherwise. Preserve the original callable kind, entry-only execution, import-only behavior and public declarations.

The migration never writes a retired runtime dispatcher or fallback runner. If the selected runner or layer is unavailable, or preserving the entry test would require a retired CommonJS dispatcher or the forbidden ESM `import.meta.main` read, leave the marker unchanged, report its file, line and reason, and exit nonzero. Every rewrite that cannot preserve types, behavior and declaration output refuses at that site. A remaining marker still reports `EK2601`; current compilation emits no implicit startup. The normative [entry migration](https://vibelang.sh/spec/007-tooling#legacy-entry-dispatch-migration) states the target forms and refusal rule.

VIP-26 recorded the refusal this way:

The retired side-effect imports `vibelang/platform/node`, `vibelang/platform/bun` and `vibelang/platform/browser` report `EK2601`, naming `vibelang --fix`. The [entry migration](https://vibelang.sh/spec/007-tooling#legacy-entry-dispatch-migration) preserves the pinned legacy startup, including entry-only execution, layers and public types, or refuses with a file, line and reason and a nonzero exit. A refused marker remains an error; no implicit startup is retained and no ordinary `main` binding is rejected.

## Retired continuation forms

`vibelang --fix` rewrites only proved local service-shaped uses whose declarations and `Exit` are preserved. It explicitly refuses continuation-dependent uses and unproved selection rewrites. As for every relic, ship the preserving migration and migrate consumers before enforcing rejection.


## The VIP-1 function-kind and `try` migration

The VIP-1 migration preserves each call's original run phase. When it removes a known legacy wrapper, it removes the `try` that ran that wrapper, even when the success data is an `error` or `schema error` instance, another Effect, or an object with an `asEffect` member. Keeping that `try` would fail with data or run a previously unrun program. A call whose written or native contract already returned the intended Effect keeps its `try`, including an error returned for intentional execution. Use the original resolved callable and migration provenance, not the final value's shape or annotation alone; refuse the repair when that provenance cannot be established ([VIP-34](https://vibelang.sh/vips/0034-compiler-and-tooling#decision), amended).

Only `--fix-vip-only` runs the VIP-1/VIP-2 function-kind and `try` passes, reading input as source for the release before VIP-1. Ordinary `--fix` and `--fix-migration-only` do not run those passes: ordinary `--fix` never removes a valid `try` from current source merely because its callee is unannotated. In current source, `try make()` intentionally runs the result whenever it passes the [operand test](https://vibelang.sh/spec/002-running#operand-test).

A value that fails that operand test, such as `Option.some(1)` or `Result.succeed(2)`, keeps `EK0502`: the migration inserts no conversion and unwraps nothing, whatever methods the value has ([VIP-5](https://vibelang.sh/vips/0005-try-runs-effects#decision), amended). Removing the run of a proven legacy wrapper is a separate repair.

The VIP-1 migration writes `try` before each call that ran where it stood before VIP-1 and keeps that call's run phase; source whose old meaning it can't establish is not reinterpreted. It refuses such a call instead, names its file and line, and exits nonzero. When it refused any, it sets `"vibe": { "severities": { "EK4802": "error" } }` in the project's config with a comment that says why, so all `EK4802` sites in the project, both unrun returns and inferred Effect arguments, fail to compile; the owner removes the setting once a run refuses none.

Schema-error class upgrades preserve the declaration's own tag matcher. A legacy schema-error family with a child tagged `"Child"` does not match the base pattern `when E:`; the class upgrade keeps that result as well as declaration output.
