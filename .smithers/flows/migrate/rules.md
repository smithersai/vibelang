# Migrate Effect TypeScript to idiomatic VibeLang

You migrate an existing Effect TypeScript codebase to VibeLang one batch of files at a time. The result must be correct and idiomatic: it uses every VibeLang form that applies, wraps Effect only where no form exists, and keeps the package's public API and tests. Correct but TypeScript-shaped VibeLang is not done.

## Whole-scope passes and rollback

For a scope-list pass, use the shared flow commands: `plan --scope`,
`rename`, `fix`, `check` and `settle`, all with `--run`. Keep one batch
of all listed `.ts` modules; defer `.tsx` with its JSX cause. Never substitute
a repository-specific driver or paths.

Fix packages in dependency order with a bounded job count and compiler timeout.
Split a large project by directory into the selected modules and their import
closures, in groups of at most `240` modules; keep unselected roots in the full
project checks. Use a temporary project even when only one selected shard is
needed; stop and explain an indivisible closure above the cap. Keep the
project's compiler options and always check the full projects after fixing.

A failing dependency is retried before its importers: select the sink components
of the failing-module dependency graph, including paths through healthy files.
Recheck after each bulk revert. Keep every diagnostic family and cause in the run.
Print `SETTLED` only when every project finished, no `.vibe` source has an
error or style violation and no other file has errors beyond its baseline.
Crashes, global errors, unattributed errors and an exhausted round limit remain
`NOT SETTLED`; a successful restore command alone proves nothing.

A bulk revert must validate every request, restore each original `.ts`,
remove its `.vibe` and sidecar, and restore its exports, path references and
every importer's specifier, including `.vibe` importers. Verify the files on
disk and fail loudly if any requested module did not return. Settling does not
replace the target's test or public-declaration gates.

## The call rule

Calling an `effect` function returns its Effect unrun. Inside an `effect` function or block, `try` runs an Effect. Pass Effect values to program combinators: `try retry(fetchUser(id), policy)` and `try timeout(slow(), "1 second")`. To defer several statements, pass an `effect { … }` block: `retry(effect { return try fetchUser(id) }, policy)`, `withSpan(effect { return try load() }, "name")`, or `Effect.all([effect { return try load() }])`. A marked arrow is still a function returning an Effect; call it or replace it with an effect block at a program position. Callback positions stay functions: `Effect.forEach(ids, effect (id) => try load(id))`. `vibelang --fix --fix-vip-only` materializes legacy program literals using the old analyzer, before the inference rules are removed; annotated literals and optional/default parameters retain their contracts and delayed evaluation through `Effect.suspend`. Accepted VIPs override older examples: https://github.com/smithersai/vibelang/tree/main/docs/design/vips (VIP-1, VIP-2 and VIP-5).

## Where this toolchain is behind the skill

The skill below teaches accepted VIPs, and the toolchain does not implement every one yet. Until each lands, write the form in the middle column; it means the same. The lane that lands the change deletes its row.

| The skill | Write on this toolchain | Until then |
| --- | --- | --- |
| Every export of `Effect` as a global: `ensuring(…)`, `scoped(…)`, `onExit(…)`, `serviceOption(…)`, `currentParentSpan` | `Effect.ensuring(…)`, `Effect.scoped(…)`, `Effect.onExit(…)`, `Effect.serviceOption(…)`, `Effect.currentParentSpan`; unqualified are `all`, `die`, `exit`, `forEach`, `log`, `logDebug`, `logError`, `logInfo`, `logWarning`, `race`, `repeat`, `retry`, `sleep`, `timeout` and `withSpan` | TS2304 |
| `fork.scoped w()`, `fork.in(scope) w()`, `fork.detached w()` | `Effect.forkScoped(w())`, `Effect.forkIn(w(), scope)`, `Effect.forkDetach(w())` | TS1005, EK4410 |
| A function with no modifier is plain (VIP-1) | Before the compiler's VIP-1 flip, a value-only helper needs a written plain return type or `: infer _`; the codemod probes and records the actual model | Writing `: infer _` after the flip (decided detail 269); assuming the model from a package version |

`Date.now()` and `Math.random()` are allowed (decided detail 56). Prefer injected `Clock` and `Random` services for controllable tests.

## Use the forms

- When upgrading existing `.vibe` code to explicit Effect functions, run `vibelang --fix --fix-vip-only` while the old form analysis is available. It marks functions `effect` from their return annotation, body or destination, including an annotated arrow whose body has a direct-call optimization. A return annotation such as `number!!` does not replace the `effect` keyword.

- Use VibeLang's form wherever the Effect code has one: `error`, `service`, `schema`, `data`, `match` and `is`, direct calls instead of `Effect.gen` and `yield*`, contracts `A!E!R` instead of `Effect.Effect<A, E, R>`, `throw` and `catch` instead of `Effect.fail` and the catch combinators, `try`/`finally` instead of `ensuring`, `|>` for a pipeline of values, `try.all`, `try.race`, `try.any` and `try.allSettled` on an array of Effects for concurrency, and `try all({ … }, { concurrency: "unbounded" })` for an object of Effects, `for concurrent(n)` instead of `forEach` with a concurrency option, `fork` and `join` for fibers, `using` for resources, `provide` blocks, and an effect block for a program argument, `withSpan(effect { ... }, "name")`.
- `vibelang --fix` already wrote, wherever the meaning stays the same, `Effect.gen` and `Effect.fn` with `effect` and `try` (EK1002), `.pipe` of an Effect with `|>` (EK4502), `Match` chains as `match` (EK4839), and `Option` pipelines as methods (EK4840). Where it left one, the diagnostic's `No quick fix:` note says what would change; rewrite it by hand so that it does not: an `Effect.gen(…).pipe(…)` becomes a direct-style body inside each stage's form (`provide L { … }`, `withSpan(effect { … }, "name")`, `x catch (e) => …`); `Effect.fn("name")(function* …)` becomes a function whose body is `withSpan(effect { … }, "name")`; a parameter with a pattern is destructured in the body only when every caller runs the program at once.
- Write no Effect TypeScript in a `.vibe` file: no `Effect.gen`, `function*` with `yield*`, `pipe(...)` chains of `Effect.map` and `Effect.flatMap`, `Effect.succeed` or `Effect.fail` where the value runs, `Data.TaggedError` or `Context.Service` classes, or `Effect.Effect<...>` types. A warning EK48xx marks each one that `vibelang --fix` did not rewrite.
- Wrap Effect mindfully. Call an Effect module where VibeLang has no form for the job (`Schema.decodeUnknown`, `Stream.*`, `Schedule.*`, `Layer.*`, `Option.*`, `Array.*`), and never where one exists. Prefer methods on Effect data types: `option.map(f).getOrElse(() => 0)`, `stream.filter(p).take(3)`.
- Effect's modules are in scope without an import. Remove imports of them, except for a module whose name a JavaScript global takes (`Array`, `String`, `Request`, `Headers`) or that two subpaths share (`Model`, `Prompt`): import that one under another name, `import { Array as Arr } from "effect"`, where EK4842 warns. Where the repository's own lint rejects that alias (Foldkit's `prefer-effect-module-names`), write `Effect.Array.map(xs, f)` with no import of `Array` or `Effect`: `Effect.Array` is that module only while `Effect` is the implicit binding (005). `--fix` renames such an import of `Array`, `String`, `Number`, `Boolean`, `Function`, `Symbol`, `BigInt` or `RegExp` where the module's declarations allow it (EK4842). Where it does not warn, because the file writes a type through the import (`Array.NonEmptyReadonlyArray<string>`) or an export's type names the module, keep `import { Array } from "effect"` as written: the declaration file prints the binding's name.
- Keep every TypeScript value-only helper plain, including a helper that builds a schema, a `Layer`, a `Stream` or a tagged error. The codemod probes the selected compiler and records `functionModel` in its journal and receipt. On a legacy-inference compiler, it writes `: infer _` before the rename, or a plain generator's written `Generator<…>` return type. On a plain-by-syntax compiler (VIP-1), it writes no legacy marker (decided detail 269). Keep authored TypeScript return types and compare declarations (VIP-27); do not add `: infer _` to a compiler that implements VIP-1. Functions returning cold Effects keep their call-time work; a call that the legacy model cannot preserve stays TypeScript until its approved VIP migration.

- Preserve schema collection mutability when converting declarations. `Schema.Array(S)` maps to `ReadonlyArray<T>`, `Schema.Tuple([...])` to a `readonly` tuple, and `Schema.Record(K, V)` to `Readonly<Record<K, V>>`. `Schema.mutable` gives a mutable array or tuple; `Schema.mutableKey` on a record’s value schema gives `Record<K, V>`. Use `vibelang --fix` and compare the resulting declaration types.
- A schema-reference `EK2109` about decoded key flags needs a preserving codec expansion. Run `vibelang --fix` and retain its explicit Effect codecs; do not change `optionalKey` to `optional` or add `?` as a substitute, because explicit `undefined` and omitted keys differ. Compare declaration output and success/failure Exits. Keep schema-error matchers, constructor contracts and methods intact.

- A schema-reference `EK2109` about decoded key flags needs a preserving codec expansion. Run `vibelang --fix` and retain its explicit Effect codecs; do not change `optionalKey` to `optional` or add `?` as a substitute, because explicit `undefined` and omitted keys differ. Compare declaration output and success/failure Exits. Keep schema-error matchers, constructor contracts and methods intact.

## Platform access goes through services

- Reach the platform only through injected Effect services (`FileSystem`, `Path`, `HttpClient`, `Clock`, `Random`, `Crypto`, `Console`, `Terminal`, `KeyValueStore`, `ChildProcessSpawner`, `Stdio`, `Config`), Effect's own modules, or VibeLang's `Experimental.Process`, `Experimental.FileSystem`, `Experimental.Crypto` and `Experimental.Locks`. The replacement table below names each global's replacement; EK4402 names it too.
- Never wrap a platform global or a Node.js module in a `sync` or `try` hatch, or in a `module` block, when a service, an Effect module or an Experimental API covers it. Thread the service through the code, and provide its layer where the program starts; a test provides a test layer.
- Read time and randomness through `Clock` and `Random`, never `Date.now()`, `new Date()` or `Math.random()` (EK4403).

## TypeScript at the edges

- A hatch (`sync`, `try`, `callback`) or a `module` block is for a real Promise or callback library, or a TypeScript-only construct, and nothing else. Comment its body as plain TypeScript, as the docs do: `// try's first argument is plain TypeScript, not VibeLang.`
- A file whose code is mostly a Promise or callback library, DOM code, or a JavaScript generator protocol stays `.ts`. So does a file with no Effect code.
- VibeLang has no JavaScript `throw` (the owner's rule): `throw` in a `.vibe` file is a typed failure, and a plain function never fails. A TypeScript function that throws a programmer error (an invariant check, an invalid schema definition) migrates one of three ways: as Effect code that ends in `die(new Error(...))` when its callers are Effect code; as a typed failure with `throw` and an `error` declaration when callers should recover; or it stays in a `.ts` file when its callers need a plain synchronous function, such as a schema factory evaluated at a module's top level. Never ask for a language change for this, and never record it as a VibeLang issue.
- Effect code that calls a plain function of a `.ts` file or a package whose exceptions nothing lists goes through `Effect.try` (EK4401). In a generator such an exception was a defect, so `--fix` keeps it one and leaves `E` alone: `try Effect.orDie(Effect.try({ try: () => f(x), catch: (error) => error }))`. Name a failure with an `error` declaration in `catch` only where a caller should recover, which changes the declaration. `trusted(...)` and `"vibelang": { "trustedPackages": [...] }` are for a person who read the code: trust a package whose functions throw only programmer errors, never to silence the error. A plain function may call such a function; before the compiler's VIP-1 flip, `--fix` writes `: infer _` to keep it plain. After that flip, leave the plain function's TypeScript inference alone (decided detail 269). Where `--fix` refuses that form because the thunk loses a narrowing (`TS2345` on `x.y` after a check of `x.y`) or a generic call's inference, bind the narrowed value to a `const` first, or give the call its type arguments, and write the same wrapper.

## Keep the contract

- Preserve an original global `Error` failure channel with a written native `!Error` contract; `EK4804` is a tag advisory, not a TypeScript-style Effect form. The style gate compares the enclosing function with its retained declaration and records the exemption; do not replace its error class or suppress other diagnostics. A private function the original only inferred needs no written channel: the gate accepts a `new Error` with the same message that the same function failed with, through `Effect.fail`, a `try` `catch` or `mapError`, as many times as the original did.

- Keep every export, with its name and type: a published package’s emitted declarations must stay identical. A package marked `"private": true` publishes no declarations: `verify` reports `"not published"`; preserve behavior and pass its tests, compiler, build, workspace typecheck, lint, format and Knip gates. Annotate an export's return type when inference would change its declared type, and keep a class a class when callers construct it or test `instanceof`.
- The declaration file prints what the source writes, so write an export's types as the TypeScript did:
  - Keep an import of an Effect module that an export's type names in the TypeScript's spelling, `import * as Schema from "effect/Schema"`: without it the declaration imports `{ Schema } from "effect"`. The same goes for `import type`, whose modifier the declaration prints. `--fix` keeps such an import in a project that emits declarations.
  - Keep each type argument the TypeScript wrote: `Effect.Effect<void, never, never>` is `void!never!never` in an export, not `void!!`, whose declaration is `Effect.Effect<void>`. `--fix` writes it so.
  - Write each interface and object-type member as the TypeScript did: a member is writable unless written `readonly`, in `.vibe` as in TypeScript, and the declaration prints it as written. Only the fields of `data`, `schema` and `error` bodies are readonly unless written `mutable`. A `data` declaration prints each variant's fields as written, as its `Data.TaggedEnum` counterpart does: write `readonly` on each field where the TypeScript wrapped the payload in `Readonly<{ … }>`, which the identity gate reads as `{ readonly … }`.
  - A `Schema.Struct` constant becomes `schema X { … }` only when the TypeScript also exports `type X = typeof X.Type`: the schema declaration declares that type (D501). `--fix` leaves a constant without one (EK4832).
  - A `Context.Service` class stays a class when EK4831 says it has no quick fix: a named or extended shape, static members such as `layer`, or a dynamic key. A service declaration lists its members inline, so it cannot keep the class's declaration, and verify accepts the class.
  - A `Schema.TaggedError` class stays a class when EK4837 says it has no quick fix: an annotations argument such as `{ httpApiStatus: 400 }`, type parameters, a constructor, or a tag that is not the class's name. A schema error has none of those, so it cannot keep them, and verify accepts the class.
  - A service whose members all need one requirement keeps it: EK4809 is design advice, and its member contracts are the published declaration verify holds to the TypeScript's, so verify accepts the warning.
  - A `.ts` file names a migrated module by its source name, `./leaf.vibe`, which the codemod writes for `./leaf.js`, `./leaf.ts` and extensionless file or directory imports, and for a tsconfig `paths` alias, `@/leaf` as `@/leaf.vibe`. A `.vibe` file names a migrated module the same way, and keeps every written specifier of a module that stays TypeScript: `./c.js`, `../d/index.js` and `./e` stay as the repository wrote them (decided detail 272), VibeLang resolves them as TypeScript does, and the declaration keeps the written spelling, so the published `.d.ts` matches the original byte for byte. Every other TypeScript checker resolves that name to the module's declaration sidecar `leaf.d.vibe.ts` under `allowArbitraryExtensions`; each `vibelang` compile writes it and the batch commits it. VibeLang emits `./leaf.vibe` as `./leaf.js` (D298), and its declaration spells the import as the package's sources do: setup sets `vibelang.declarationImportStyle` to `"extensionless"` or `".ts"` for a package whose relative imports all write `./leaf` or `./leaf.ts`, and the default `./leaf.js` fits a package that writes `.js`. A package that mixes spellings gets no setting, and setup warns. Where its declaration names `./leaf.js` and the TypeScript wrote `./leaf.ts`, the identity gate treats a relative `./leaf.ts` and `./leaf.js` as one module. It accepts an extensionless name's emitted `.js` spelling only when stock TypeScript proves both select the same listed `.d.ts` within that side's emitted tree; explicit, external or unresolved names and changed modules or types stay distinct.
- Published declarations are compared byte for byte, but for a relative specifier whose two spellings stock TypeScript proves name the same listed declaration (D298). If either snapshot lacks resolvable public-surface metadata, compare every existing declaration that way and reject every unexplained addition. Only proven private declarations use canonical comparison. A manifest with no `exports`, `types`, `typings`, `main`, `module` or `typesVersions` publishes the root `index` declaration and what it reaches, which TypeScript resolves for the bare package name; without a root index, as in a CLI that publishes only a bundled `bin`, every declaration is private.
- A function whose success type is `any`, `unknown` or `void` cannot return a program as its factory form: `(arg: any): any!any!any => { return () => run(arg) }` succeeds with the function (EK4802). For `Effect.suspend(() => run(arg))`, write the call in place, `(arg: any): any!any!any => run(arg)`: the contract makes the function cold, so each run of its program calls `run` afresh.
- Keep a renamed source reachable from its existing build configuration. The codemod follows literal Vite library and pack entries to `.vibe`, records the exact edits for `revert`, and warns about computed roots/entries rather than guessing. It leaves configuration tests, fixtures and runners as written (decided detail 272); native `--fix` cannot edit these `.ts` siblings (detail 270).
- A `node` script that reaches a migrated module loads it through `node --import vibelang/register`: add the flag where the repository calls `node`, in the batch that renames the module. Setup cannot do it, because a script reaches `.vibe` only once a batch renames what it imports.
- A package whose tests run under `bun test` loads `.vibe` modules through the loader: add `--preload vibelang/bun` to its test script, or `preload = ["vibelang/bun"]` under `[test]` in its `bunfig.toml`. `bun test` ignores a top-level `preload`. Setup writes the `[test]` one for the test command it runs. Setup adds this to every package that runs `bun test` and reaches a migrated package through workspace dependencies.
- Keep every test and fixture unchanged (decided detail 272). Only a module-specifier literal naming a mechanically renamed module may gain its new extension or `declarationImportStyle` spelling; a file selector may gain `.vibe` and exclude `*.d.vibe.ts` only when the verifier proves the same selected base names and count. A named selector regex may widen only when every resolved use is proven to select filenames; an assertion, escaped alias or unknown consumer refuses it, even if a directory is listed elsewhere in the file. A path literal may change only its source extension when it resolves uniquely to the migrated file; static `path.join`, `path.resolve` and `new URL` fragments qualify. A read whose source text reaches an assertion keeps its module `.ts` and goes to migfix. The sole assertion exception is adding exactly one `"vibelang-runtime"` entry to an expected dependency list or object when that test’s package gained it in `dependencies`; list every such edit under `assertion edits` in the PR. A baseline `.vibe` test may take formatter-only changes only with equal native parsed ASTs and token streams: preserve comments in token position (normalizing their internal whitespace), parentheses, empty statements and `for`-head semicolons; only whitespace, trailing commas and statement terminators may differ. List these under `formatter-only` in the PR; a parse failure fails the batch. No other assertion, embedded config, setup or build call may change. `verify` and the final `record` enforce this, including with `--force`; if the test needs another edit, leave the module TypeScript with a named cause. Include `pr-body.md` in the migration PR.
- Keep behavior: the same errors in the same channel, the same order of effects, the same laziness. A `const` that held a lazy `Effect` value stays lazy: write `effect { … }` or keep the Effect value.

## Record what the migration teaches

- A rewrite you make by hand that a mechanical rule could make is a codemod gap: record it with its pattern, before and after, so `vibelang --fix` can learn it. The flow's README lists the known gaps; do not record those again.
- A VibeLang bug or missing feature is an issue: record it with the smallest source that shows it. Never work around it with a cast, `any`, a hatch or a `module` block; leave the file `.ts`.
- A lesson about idiomatic VibeLang that this context did not teach is an idiom entry; it becomes a line of this file.

## VIP-3: Effect type aliases

`A!E!R` is exactly `Effect<A, E, R>`. Every omitted slot means `never`, including on a function with a body. Preserve inferred requirements by writing them explicitly, or leave out the entire annotation when its inferred type is identical. Run `vibelang --fix` to migrate old omitted requirements.

## VIP-9: Service declarations

Use only `service Name { … }` for services; abstract classes remain ordinary classes. Preserve existing runtime identities with `static readonly key = "…"`. A reference default is `static readonly defaultValue = () => shape`, typed `() => Name.Shape`; migrate `default` by wrapping its value in a thunk and changing reads to `Name.defaultValue()`. Implementations have type `Name.Shape`, while `Name` is the identifier in `R`.

## Required schema field references (VIP-15, detail 132)

A source-required struct field cannot reference a codec with optional or unprovable decoded key flags. For `EK2109`, preserve existing decoding by expanding the enclosing schema declaration to explicit codecs with `vibelang --fix`. Keep optionalKey omission distinct from accepting undefined; adding a question token is not a preserving upgrade. Nested struct codecs in schema-error fields may be named before the error declaration while retaining its constructor, methods and matcher. Explicit optional-key Struct calls stay explicit; do not suggest an inverse rewrite that makes a required field optional.

## Empty schema type arguments (VIP-15)

Remove an empty type argument list from a schema value reference: `schema Alias = Address<>` becomes `schema Alias = (Address)`. Apply the same repair inside fields, arrays, tuples, unions, records and schema errors. Keep comments inside the parentheses, especially line comments before an array suffix. Keep nonempty mapped built-in arguments such as `Array<string>` and expressions in computed field keys. `vibelang --fix` performs this preserving repair for `EK2109`.

- Keep user-written `static` members on the original Effect error class; `error` and `schema error` declarations cannot contain them (`EK1302`).

- Keep setters on the original Effect error class; `error` and `schema error` declarations allow getters, but not setters (`EK1302`).

- Keep a written constructor on the original Effect error class; an error declaration's constructor takes its fields as one object (`EK1301`).
- Keep initialized properties, `private`, `protected`, `public` or `declare` properties, private names, `accessor` properties, index signatures and `implements` on the original Effect error class; error declarations report `EK1304`.
- Keep generic Effect error classes in TypeScript; `error` and `schema error` declarations cannot have type parameters (`EK1303`). A generic schema needs concrete fields or a TypeScript schema factory, not a class whose base refers to its type parameters (`TS2562`).
## VIP-15: Preserve referenced readonly-key codecs

An explicitly `readonly` schema field requires known readonly decoded-key flags on its referenced codec (detail132), including aliases and nested structs. For `EK2109` conflicts, run `vibelang --fix` to keep the existing codec through explicit `Schema.Struct` values. Preserve emitted declarations, decode Exits/Causes, constructor/matcher behavior, getter order and directives. Do not replace a `mutableKey` codec with `readonlyKey` or confuse shallow key mutability with nested value mutability. Direct schema-error fields follow a separate effective-readonly rule (detail167).

- Generic `data` parameters have no defaults (`EK2803`, VIP-28): preserve a default with `vibelang --fix`, which expands the declaration into equivalent Effect TypeScript.

## VIP-20: Stream loops

For `Stream` iteration, write `for try (const x of stream)` in effect code. Rewrite legacy `for await` over a `Stream` to `for try`; keep `for await` over `AsyncIterable` values in `async` code. `continue` skips an element and `break` stops consuming. A body `return` is `EK2002`: use `break` and return after the loop. `EK2007` offers the loop spelling migration through `vibelang --fix`.

An `is` binding without a defined lexical home in a formal-parameter, catch-parameter or enum-member initializer is `EK0705` (VIP-7, details214/240/249). Do not automatically move it into a function body: preserve initializer evaluation order and parameter/body environments. Use an explicit local block only when its returned result preserves the source behavior.

## Whole-scope driver receipts

- Bank completed packages and their source digests; skip unchanged banks on restart, with dependency packages first and large ready packages last. A config whose `--fix` timed out receives no retry in the same pass.
- Own `EK` diagnostics blame only their file. For ordinary importer errors, try reachable modules with changed declarations before widening; return dependency roots first and check every return.
- Emit both sides of every declaration comparison with `--singleThreaded`, including sidecars.
- Under detail 272 addendum 4, rewrite only statically resolved path strings. Bare names require the module's own directory. Comments and prose stay as written; `vi.mock` and `require.resolve` are specifiers. Keep a module `.ts` when a test reads its source text.
- Whole-scope record requires readable, nonempty per-test receipts against the setup baseline, previous commit and main. Reject inconsistent summaries, unexplained exits, missing tests and newly skipped passing tests. Measure all sides in one provider job; never compare separate box jobs.
- Repository-generated bundles and build-graph paths belong in recorded `--after-convert` hooks. Run them before settle checks and final verification; stop on failure. Record formats first and verifies the final bytes again. Its whole-scope test gate cannot be forced.

When upgrading old nested `schema` aliases containing named, optional or rest tuples, `vibelang --fix --fix-migration-only` preserves their former `Schema.Unknown` placeholders and public declarations. Ordinary `--fix` keeps the new tuple mapping; check declaration identity and decode Exits before choosing to tighten a legacy codec.

## VIP-15: Repeated schema field modifiers

A schema field accepts `readonly` once, as TypeScript does. For `TS1030` on repeated `readonly`, run `vibelang --fix` to remove only the duplicate token. Keep comments, the remaining modifier, the codec and its decoded/encoded behavior. Do not weaken readonly fields or replace their codecs.

Runtime helper consumers must handle the primitive branch of `$extract(C, value)` when a structural constructor type can hold `String`, `Number`, `Boolean`, `BigInt` or `Symbol` (VIP-7/detail87). Use the primitive/boxed union instead of promising `object`. This SDK type rule does not admit an ordinary-class extractor without an own `Symbol.customMatcher` (detail100).

For generic schema arrays, resolve the TypeScript-library type binding instead of guessing from its written name (VIP-15, detail286). Canonical `Array<T>` and `ReadonlyArray<T>` imports that refer to the opposite library type can preserve the old decoder and declarations through `vibelang --fix --fix-migration-only`. Keep ordinary compilation on the resolved meaning. Do not invent previous codecs for newly supported qualified or renamed generic forms.

- VIP-15/detail286: resolve both generic type bindings in `Readonly<Record<K, V>>`, including qualified or renamed imports. Keep source-required and readonly decoded-key checks. For previously accepted shadowed canonical names, apply the compiler’s preserving explicit-codec repair; when the canonical `Readonly` name resolves to an array library type, use `--fix-migration-only` to retain the earlier record codec. Never invent a previous codec for newly supported spellings.

## Retained nested Effect error patterns (VIP-7, detail 92)

Qualified constructors in the thirty-three retained Effect error patterns use their native module guards. When upgrading code whose nested-module patterns previously used ordinary class matching, run `vibelang --fix --fix-migration-only`; it introduces fresh local constructor aliases and explicit call-only extractors (detail 100), then rewrites those patterns to preserve their own matcher, `instanceof` behavior and declared types. Keep direct qualified patterns when deliberately adopting the native guard semantics. Compare complete `Exit`s and the emitted declarations after the upgrade.
