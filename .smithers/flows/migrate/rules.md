# Migrate Effect TypeScript to idiomatic VibeLang

You migrate an existing Effect TypeScript codebase to VibeLang one batch of files at a time. The result must be correct and idiomatic: it uses every VibeLang form that applies, wraps Effect only where no form exists, and keeps the package's public API and tests. Correct but TypeScript-shaped VibeLang is not done.

## The call rule

Calling an `effect` function returns its Effect unrun. Inside an `effect` function or block, `try` runs an Effect. Pass Effect values to program combinators: `try retry(fetchUser(id), policy)` and `try timeout(slow(), "1 second")`. To defer several statements, pass an `effect { … }` block: `retry(effect { return try fetchUser(id) }, policy)`, `withSpan(effect { return try load() }, "name")`, or `Effect.all([effect { return try load() }])`. A marked arrow is still a function returning an Effect; call it or replace it with an effect block at a program position. Callback positions stay functions: `Effect.forEach(ids, effect (id) => try load(id))`. `vibelang --fix --fix-vip-only` materializes legacy program literals using the old analyzer, before the inference rules are removed; annotated literals and optional/default parameters retain their contracts and delayed evaluation through `Effect.suspend`. Accepted VIPs override older examples: https://github.com/smithersai/vibelang/tree/main/docs/design/vips (VIP-1, VIP-2 and VIP-5).

## Where this toolchain is behind the skill

The skill below teaches accepted VIPs, and the toolchain does not implement every one yet. Until each lands, write the form in the middle column; it means the same. The lane that lands the change deletes its row.

| The skill | Write on this toolchain | Until then |
| --- | --- | --- |
| `try.all [a(), b()]`, `try.race`, `try.any`, `try.allSettled` | `await.all [a(), b()]`, `await.race`, `await.any`, `await.allSettled` | `try.all` does not parse (TS1109) |
| `const users = try Users`, then `try users.find(id)` | `try Users.find(id)`, or `const users = Users`; for a service key declared in TypeScript, `Users()` | `try Users` is EK0502 |
| Every export of `Effect` as a global: `ensuring(…)`, `scoped(…)`, `onExit(…)`, `serviceOption(…)`, `currentParentSpan` | `Effect.ensuring(…)`, `Effect.scoped(…)`, `Effect.onExit(…)`, `Effect.serviceOption(…)`, `Effect.currentParentSpan`; unqualified are `all`, `die`, `exit`, `forEach`, `log`, `logDebug`, `logError`, `logInfo`, `logWarning`, `race`, `repeat`, `retry`, `sleep`, `timeout` and `withSpan` | TS2304 |
| `fork.scoped w()`, `fork.in(scope) w()`, `fork.detached w()` | `Effect.forkScoped(w())`, `Effect.forkIn(w(), scope)`, `Effect.forkDetach(w())` | TS1005, EK4410 |
| A function with no modifier is plain (VIP-1) | A return type or `: infer _` on a function that runs and returns no Effect; a function that returns an Effect without running it takes its contract, `(payload): unknown!unknown!unknown => declared.effect(payload)` | It compiles to an Effect; `: infer _` on one that calls an Effect function is EK9203 |
| `Date.now()` and `Math.random()` are allowed (decided detail 56) | `Clock` and `Random` in Effect code; a module whose public API needs a synchronous clock stays `.ts` | EK4403 rejects them |

## Use the forms

- When upgrading existing `.vibe` code to explicit Effect functions, run `vibelang --fix --fix-vip-only` while the old form analysis is available. It marks functions `effect` from their return annotation, body or destination, including an annotated arrow whose body has a direct-call optimization. A return annotation such as `number!!` does not replace the `effect` keyword.

- Use VibeLang's form wherever the Effect code has one: `error`, `service`, `schema`, `data`, `match` and `is`, direct calls instead of `Effect.gen` and `yield*`, contracts `A!E!R` instead of `Effect.Effect<A, E, R>`, `throw` and `catch` instead of `Effect.fail` and the catch combinators, `try`/`finally` instead of `ensuring`, `|>` for a pipeline of values, `await.all`, `await.race`, `await.any` and `await.allSettled` for concurrency, `for concurrent(n)` instead of `forEach` with a concurrency option, `fork` and `join` for fibers, `using` for resources, `provide` blocks, and an effect block for a program argument, `withSpan(effect { ... }, "name")`.
- `vibelang --fix` already wrote, wherever the meaning stays the same, `Effect.gen` bodies in direct style (EK1002), `Match` chains as `match` (EK4839), and `Option` pipelines as methods (EK4840). Where it left one, the diagnostic's `No quick fix:` note says what would change; rewrite it by hand so that it does not: an `Effect.gen(…).pipe(…)` becomes a direct-style body inside each stage's form (`provide L { … }`, `withSpan(effect { … }, "name")`, `x catch (e) => …`); `Effect.fn("name")(function* …)` becomes a function whose body is `withSpan(effect { … }, "name")`; a parameter with a pattern is destructured in the body only when every caller runs the program at once.
- Write no Effect TypeScript in a `.vibe` file: no `Effect.gen`, `function*` with `yield*`, `pipe(...)` chains of `Effect.map` and `Effect.flatMap`, `Effect.succeed` or `Effect.fail` where the value runs, `Data.TaggedError` or `Context.Service` classes, or `Effect.Effect<...>` types. A warning EK48xx marks each one that `vibelang --fix` did not rewrite.
- Wrap Effect mindfully. Call an Effect module where VibeLang has no form for the job (`Schema.decodeUnknown`, `Stream.*`, `Schedule.*`, `Layer.*`, `Option.*`, `Array.*`), and never where one exists. Prefer methods on Effect data types: `option.map(f).getOrElse(() => 0)`, `stream.filter(p).take(3)`.
- Effect's modules are in scope without an import. Remove imports of them, except for a module whose name a JavaScript global takes (`Array`, `String`, `Request`, `Headers`) or that two subpaths share (`Model`, `Prompt`): import that one under another name, `import { Array as Arr } from "effect"`, where EK4842 warns. `--fix` renames such an import of `Array`, `String`, `Number`, `Boolean`, `Function`, `Symbol`, `BigInt` or `RegExp` where the module's declarations allow it (EK4842). Where it does not warn, because the file writes a type through the import (`Array.NonEmptyReadonlyArray<string>`) or an export's type names the module, keep `import { Array } from "effect"` as written: the declaration file prints the binding's name.
- A function with no Effect operation stays plain, and on this toolchain only a written return type keeps it plain: an unannotated function or method, a static one or one in a class expression included, compiles to an Effect, and behind `as unknown as` every check passes but a test that runs it. Write the return type, or `: infer _`, on each function and method the TypeScript declared plain: `static plain(n: number): number { … }`. Do not give a pure helper a contract it does not need.

- Preserve schema collection mutability when converting declarations. `Schema.Array(S)` maps to `ReadonlyArray<T>`, `Schema.Tuple([...])` to a `readonly` tuple, and `Schema.Record(K, V)` to `Readonly<Record<K, V>>`. `Schema.mutable` gives a mutable array or tuple; `Schema.mutableKey` on a record’s value schema gives `Record<K, V>`. Use `vibelang --fix` and compare the resulting declaration types.

## Platform access goes through services

- Reach the platform only through injected Effect services (`FileSystem`, `Path`, `HttpClient`, `Clock`, `Random`, `Crypto`, `Console`, `Terminal`, `KeyValueStore`, `ChildProcessSpawner`, `Stdio`, `Config`), Effect's own modules, or VibeLang's `Experimental.Process`, `Experimental.FileSystem`, `Experimental.Crypto` and `Experimental.Locks`. The replacement table below names each global's replacement; EK4402 names it too.
- Never wrap a platform global or a Node.js module in a `sync` or `try` hatch, or in a `module` block, when a service, an Effect module or an Experimental API covers it. Thread the service through the code, and provide its layer where the program starts; a test provides a test layer.
- Read time and randomness through `Clock` and `Random`, never `Date.now()`, `new Date()` or `Math.random()` (EK4403).

## TypeScript at the edges

- A hatch (`sync`, `try`, `callback`) or a `module` block is for a real Promise or callback library, or a TypeScript-only construct, and nothing else. Comment its body as plain TypeScript, as the docs do: `// try's first argument is plain TypeScript, not VibeLang.`
- A file whose code is mostly a Promise or callback library, DOM code, or a JavaScript generator protocol stays `.ts`. So does a file with no Effect code.
- VibeLang has no JavaScript `throw` (the owner's rule): `throw` in a `.vibe` file is a typed failure, and a plain function never fails. A TypeScript function that throws a programmer error (an invariant check, an invalid schema definition) migrates one of three ways: as Effect code that ends in `die(new Error(...))` when its callers are Effect code; as a typed failure with `throw` and an `error` declaration when callers should recover; or it stays in a `.ts` file when its callers need a plain synchronous function, such as a schema factory evaluated at a module's top level. Never ask for a language change for this, and never record it as a VibeLang issue.
- Calling a plain function of a `.ts` file or a package from code a fiber runs needs a hatch, `trusted(...)`, or the package in `"vibelang": { "trustedPackages": [...] }` (EK4401). Trust a package whose functions throw only programmer errors; wrap the rest.

## Keep the contract

- Keep every export, with its name and type: the package's emitted declarations must stay identical. Annotate an export's return type when inference would change its declared type, and keep a class a class when callers construct it or test `instanceof`.
- The declaration file prints what the source writes, so write an export's types as the TypeScript did:
  - Keep an import of an Effect module that an export's type names in the TypeScript's spelling, `import * as Schema from "effect/Schema"`: without it the declaration imports `{ Schema } from "effect"`. `--fix` keeps such an import in a project that emits declarations.
  - Keep each type argument the TypeScript wrote: `Effect.Effect<void, never, never>` is `void!never!never` in an export, not `void!!`, whose declaration is `Effect.Effect<void>`. `--fix` writes it so.
  - Inside `Readonly<{ … }>`, write each member as the TypeScript did: `readonly` where it wrote one, `mutable` where it did not. The declaration prints a `Readonly` argument's members as written, and its consumers infer from them. Elsewhere, members are readonly by default.
  - A `Schema.Struct` constant becomes `schema X { … }` only when the TypeScript also exports `type X = typeof X.Type`: the schema declaration declares that type (D501). `--fix` leaves a constant without one (EK4832).
  - A `.ts` file names a migrated module by its source name, `./leaf.vibe`, which the codemod writes for `./leaf.js` and `./leaf.ts`: every other TypeScript checker resolves only that name, to the module's declaration sidecar `leaf.d.vibe.ts`, which each `vibelang` compile writes and the batch commits. Its declaration names `./leaf.js` (D298), as the TypeScript's did where it wrote `.js`. Where the TypeScript wrote `./leaf.ts`, the declaration changes spelling but not meaning: TypeScript resolves both to `leaf.d.ts`, and the identity gate treats a relative `./leaf.ts` and `./leaf.js` as one module.
- A function whose success type is `any`, `unknown` or `void` cannot return a program as its factory form: `(arg: any): any!any!any => { return () => run(arg) }` succeeds with the function (EK4802). For `Effect.suspend(() => run(arg))`, write the call in place, `(arg: any): any!any!any => run(arg)`: the contract makes the function cold, so each run of its program calls `run` afresh.
- A package whose tests run under `bun test` loads `.vibe` modules through the loader: add `--preload vibelang/bun` to its test script, or `preload = ["vibelang/bun"]` under `[test]` in its `bunfig.toml`. `bun test` ignores a top-level `preload`. Setup writes the `[test]` one for the test command it runs.
- Keep every test and its meaning. A test written with `it.effect` may become `.vibe`; a Promise-style test stays `.ts`.
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
