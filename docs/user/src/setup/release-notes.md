# Release notes

VibeLang is v0, so a new version can change the language in breaking ways.
Before you update, read the notes for every version between yours and the new
one, and update `vibelang`, `vibelang-runtime`, and `vibelang-vite` together.


## 0.0.11 (unreleased)
- Effect's `deterministicKeys` rule asked a service moved into a `module` body for a key built from the body's own file, `@x/pkg/a.vibe.platform/Port`, where its `.ts` file had `@x/pkg/a/Port`, so every keyed service the migrate flow moved into `module platform { }` failed with `EK3822` (15 t3code desktop modules). A body's keys now come from the `.vibe` file that holds it, so a moved service keeps its key and its run-time identity.
- A build of many `.vibe` files that write `Effect.Array` or another `Effect.M` module could stop at random with `fatal error: concurrent map read and map write` in `(*lowering).visit`. Each file's lowering now reads its own copy of what the checker recorded.
- A type such as `Missing.Shape`, where no scope declares `Missing`, stopped the compiler with `fatal error: stack overflow`. It now reports the error TypeScript reports for the same text.
- The published-declaration checker (`scripts/api-identity.mjs`) made one export's verdict depend on the rest of the batch: a `TS7016` inside `electron-updater` flagged t3code's byte-identical `vite.config.d.ts` default, and every desktop module's proof with it, while a real `// @ts-ignore`d error in an export's own closure passed when nothing else in the program reported one. Every compared export is now inspected for error types, and an error in a declaration outside both snapshots no longer counts while both sides reach the same declarations.
- `vibelang --fix` changed the declaration of an `Effect.fn` with a defaulted parameter: `Effect.fn(function* (o: T = {}) { … })` declares `(o?: T | undefined)`, and the effect function it wrote declared `(o?: T)`. It now writes `o: T | undefined = {}`, which declares what the original did; the parameter still reads `T` in the body. A rest parameter `...r: ReadonlyArray<T>` now becomes `...r: T[]`, as `tsc` declares it, not `readonly T[]`.
- `vibelang --fix` refused every fix a round had not told apart when it reached its bound of 256 checks, all under the round's first error, and a rerun did the same: on t3code's server a round refused 237 fixes under one error of an unrelated file, and a rerun applied none. The round now keeps the fixes a fresh check of the whole project verifies once the fixes its errors can come from are set aside, and names each refused fix by an error of its own file or of a file that imports it.
- The migrate flow's setup stopped with `TS2307: Cannot find module './calendarDate.vibe'` in a package whose committed declaration sidecars import a migrated neighbour as `./x.vibe`, such as `packages/foldkit` in Foldkit: the check of earlier runs' declarations copied the sidecars into a tree that holds only `x.d.ts`. It now spells those imports as the emitted declarations do, `./x.js`, and compares the APIs.
- The migrate flow's codemod still rewrote an extensionless import in a test fixture, such as `../target` in `src/fixtures/a.ts`, to `../target.vibe`, and its own test check then refused the batch. A fixture now keeps an extensionless import as written, as a test does.
- In a package where the migrate flow's setup turned on `vibe.sidecarDir`, `verify` and `record` refused every batch: the batch's own sidecar and a rewritten importer's counted as outside its scope, and a `*.fixture.d.vibe.ts` that setup moved counted as a renamed fixture. Those are now compiler output wherever they live; a sidecar with no `.vibe` source stays protected.
- Oxlint's native rules now run on `.vibe` and `.vibex` files. Setup's lint scripts run stock Oxlint on the projected TypeScript through `.vibelang/oxlint.mjs --vibe-native`, with the repository's overrides and `ignorePatterns`, reports mapped back to source lines and reports on generated code dropped. `vibelang --ts-projection <file>` prints the projection and its span map, and `vibelang/oxlint` is the pass. Rerun setup to get it; existing findings a `.ts` file would get now appear on `.vibe` files.
- The migrate flow's platform split did not read `EK4402`'s message for a global the compiler derives, such as `Blob reads a host global`, so a module that read `Blob` or `ReadableStream` stayed TypeScript with nothing moved. The split now moves the declarations that read such a global.
- Service-declaration guidance no longer names a declaration rule as the fallback member diagnostic; the general member row is explicitly the fallback.
Update `vibelang`, `vibelang-runtime` and your bundler plugin together to
0.0.11. Use exactly `effect@4.1.1`, the earliest Effect version VibeLang
now supports, with matching `@effect/platform-*` and `@effect/vitest` when
used, and the `@effect/platform-node-shared` override at 4.1.1. Effect's
failure rules from 0.0.10 still apply.

### Upgrade from 0.0.10

- Error payload readonlyness is shallow. To retain the old implicit readonly modifiers in nested payload types and method types, run `vibelang --fix --fix-migration-only`.

- Run `vibelang --fix` to update imports and re-exports of older generated `data` helpers while preserving local bindings and exported names; native TypeScript consumers remain unchanged and need an explicit helper-import update.

- To preserve interface and object-type APIs that relied on implicit readonly members, run `vibelang --fix --fix-migration-only` on those legacy modules before publishing their new declarations.

- The old bare `Effect<number>` alias was accepted without its migration warning; it now reports `EK4856`. The migration fix preserves comments and explicit default slots, uses shorthand when it needs no new parentheses, and retains a qualified type in other positions. Local and imported types named `Effect` keep their meaning. Later style passes keep the qualified spelling when an automatic shorthand edit would change grouping or declaration output.
- A comment containing `function` before an `effect` or `async` modifier could hide a missing-keyword error; the compiler now reports it and the quick fix preserves the comment.
- Effect function expressions could name themselves `fork` or `join`; these names now report `EK1702`, while declaration names follow their enclosing context and method names remain allowed.
- `data` payload readonlyness is shallow. To preserve the old implicit readonly modifiers on nested fields, run `vibelang --fix --fix-migration-only`; ordinary `--fix` keeps valid writable payloads unchanged.

This release changes platform access and name resolution in `.vibe`.
Run `vibelang -p tsconfig.json --fix`, then check the remaining diagnostics
against [Platform globals](../platform/platform-globals.md).
The fixes keep a rewrite only when it adds no compiler error.

| Before | After and repair |
| --- | --- |
| `vibelang.tracing` or mapper `options.tracing` | Remove the unsupported option. Add named operation spans explicitly with `try withSpan(program, "name")`. |
| `when var name:` or a `var` binding in an `is` pattern | Pattern bindings use `let` or `const` (`EK0107`, VIP-7). The quick fix and `vibelang --fix` replace the pattern's `var` with `let`. |
| Bare compound types beside `!`, such as `number!Error \| string` or `number!! \| null` | `EK0301` (VIP-3). Run `vibelang --fix` to preserve the existing channels with parentheses, such as `number!(Error \| string)` or `number!!(\| null)`. To mean an Effect or `null`, write `(number!!) \| null`. |
| A nested Effect error pattern used class identity, such as `Csv.CsvError`. | It now uses the module guard. `vibelang --fix --fix-migration-only` preserves the old class matcher through fresh constructor aliases and call-only extractors, with the same constructor, matcher observations and declared types. |
| `effect@4.0.6` and `@effect/*@4.0.6` | Effect 4.1.1 is now the minimum supported version, pinned exactly: install `effect@4.1.1` and `@effect/*@4.1.1`; the runtime refuses any other version. Effect 4.1 removed `effect/Crypto` and `TestCrypto`, so `Crypto` in a `.vibe` file is the DOM's again. Use `effect/crypto`'s services: `SecureRandom.randomBytes(16)`, `SecureRandom.uuidV4()` and `SecureRandom.intBetween(min, max)` for `Crypto.randomBytes`, `Crypto.randomUUIDv4()` and `Crypto.randomIntBetween`; `Digest.digest(Digest.sha256, bytes)` for `Crypto.digest("SHA-256", bytes)`; `Mac` and `Signature` for HMAC and signatures. `NodeServices.layer` and `BunServices.layer` no longer provide a crypto service: provide `NodeCrypto.layer`, `BunCrypto.layer` or `BrowserCrypto.layer`. `Experimental.Crypto` keeps its members, and its platform layers provide Effect's crypto services too. Node.js 22.19.0 is the minimum for `@effect/platform-node`. A test terminal built with `Terminal.make` must now supply `size`, a scoped queue of resizes, such as `size: Queue.unbounded<Terminal.Size, Cause.Done>()`. |
| A schema tuple rest uses a local type named `Array` or `ReadonlyArray` | The generic must resolve to the TypeScript library array. Run `vibelang --fix` to preserve an old accepted decoder as explicit `Schema.TupleWithRest` codecs. |
| `Readonly<Record<K, V>>` with a shadowing type or a canonical `Readonly` alias that selects an array | Library bindings now select the mapped codec. Run `vibelang --fix` for rejected shadows or `vibelang --fix --fix-migration-only` to keep a previously accepted decoder explicit. |
| A library `Array` imported as `Record`, then used as `Record<K, V>` | The library binding must match the mapped form and arity. Run `vibelang --fix` to retain the previous record decoder through explicit `Schema.Record` code. |
| `Array<T>` imported as the library `ReadonlyArray`, or the reverse | Normal compilation now uses the library binding. Run `vibelang --fix --fix-migration-only` to retain the previous decoder and public type through explicit Effect codecs. |
| A value after `catch`: `x catch "guest"`, `x catch onErr`, `x catch effect { … }`, `x catch async (e) => 7` | A `catch` handler is a function literal (VIP-5, amended 2026-10-29); anything else is `EK0509`. `vibelang --fix` writes `x catch () => "guest"`, `x catch (e) => onErr(e)`, `x catch effect () => { … }` and `x catch (e) => 7`; a value that is an Effect, such as `x catch Effect.succeed(1)`, becomes `x catch effect () => try Effect.succeed(1)`, which runs it as the old fallback did. In a chain or a conditional's test it parenthesizes the inner `catch`: `(a catch () => b) catch () => c`. |
| Commas between `schema` declaration fields | Separate fields with `;` or a new line. `vibelang --fix` replaces commas with semicolons (`EK1013`). |
| `import { Path } from "effect"`; `Path.Path.join("a", "b")` | Every unambiguous Effect module is global; write `Path.join("a", "b")`. Existing imports still work. `--fix` removes redundant imports and shortens the module's same-named export. |
| The type `Option.Option<number>` | Write `Option<number>`; the long form remains valid. A module's own exports still win over its same-named export. |
| A DOM type named `Cache`, `Console`, `FileSystem`, `Scheduler`, `Transferable` or `Worker` | Bare type names retain their ambient meanings. Values and namespaces name Effect modules; qualify an Effect type, such as `FileSystem.FileSystem`. Emitted declaration imports use fresh aliases. |
| `console.log("hello")`, or holding `const logger = console` | The call was already EK4402; holding the value is newly rejected. Use `Console.log("hello")`; the map lists the Effect service for each platform global. Node/web I/O globals are out of scope outside TypeScript escapes. |
| A value import such as `import { join } from "node:path"` | EK4402, even before a call. Use `Path.join`; for an uncovered API, import it in a named `module` block or a `.ts` file and call through a hatch. A type-only import remains allowed. |
| An entry that manually provides `NodeServices.layer` around `FileSystem.FileSystem.readFileString(path)` | It can start with `import "vibelang/platform/node"` and call `FileSystem.readFileString(path)`; the entry provides the required platform bundle. This spelling is provisional. Existing explicit providers keep working; no import is required for a main with no platform needs. |
| Early 0.0.11 experimental layer imports named `NodeServices`, `NodeCrypto` or `BrowserLocks` | Exports from `vibelang-runtime/experimental/platform-*` now start with `Experimental`: import `ExperimentalNodeServices`, `ExperimentalNodeCrypto` or `ExperimentalBrowserLocks`. Rename the other experimental layers the same way. Imports from Effect's `@effect/platform-*` packages keep their names. |
| Both `import "vibelang/platform/node"` and `import "vibelang/platform/bun"` in one file | EK3206 rejects conflicting imports. Keep one platform import per file; use a separate entry file for each host. Repeating the same platform is allowed. |
| A platform API in a hatch because Effect has no equivalent | Prefer the new `Experimental.FileSystem`, `Experimental.Crypto`, `Experimental.Process` or `Experimental.Locks` where covered. Their layers and platform limits are listed below; an uncovered API stays in TypeScript. |
| `interrupt` alone as a statement | EK4801: it previously ran nothing. Write `interrupt()` (the quick fix), likewise `yieldNow()` and other zero-argument program references. |
| `return x ?? throw c ? a : b` | EK1010: it previously parsed as `(x ?? throw c) ? a : b`, throwing only `c`. Write `return x ?? throw (c ? a : b)`. |
| `throw cause` where `cause` is a `Cause`, as in `when Exit.Failure(let cause): throw cause` | It now fails with the Cause object itself as an expected failure, as `Effect.fail(cause)` does: `throw` fails with the value it is given (VIP-4). It previously rethrew every reason the cause held. To keep that, write `return Effect.failCause(cause)`, as Effect code does. |
| A Stream that needs a control operation, such as a producer that performs one, held in a binding or used with a Stream method, as in `const s = asks(); Stream.runCollect(s)` or `s.take(1)` | EK4201, as passing the producer call itself already was: a Stream consumer pulls it on a fiber of its own, where the operation's handler cannot be reached. Loop over it with `for...of`, or handle the operation inside the producer. |
| `return value` in a producer, as in `function* upTo(n) { …; return n }` | `EK2128` (VIP-21): a Stream has no return value, and the value was dropped. `--fix` writes `return`, or `{ value; return }` where evaluating the value runs code. |
| `error Sub extends Base { path: string }` when Base's constructor takes a primitive or list | EK2118 at the declaration; before, construction usually failed later with TS2345. Write a constructor that calls `super` with the arguments Base expects. |
| `module { export const value = 1 }` | EK4408 replaces misleading platform/call errors. Name it: `module helpers { export const value = 1 }`. |
| A `module` declaration whose code relies on running before the file's other imports, or an importer that relies on an exported `let` keeping its first value | Each module declaration the file imports is now a JavaScript module of its own, `main.vibe.text.js` beside `main.js`. It runs in its place among the file's imports, after its own imports, and imports of its exports are live bindings; before, every module's imports ran first and an import kept the value the export had when the module ran. Its `import.meta` is its own file's. Order the imports as the code needs them, and ship the `main.vibe.*.js` files with `main.js`. |
| An `await` binding such as `const await = 1` | Rejected in a VibeLang module; rename the binding. It previously compiled despite the reserved word. JavaScript `await` remains available inside TypeScript escapes. |
| A plain object, default or parameter typed with a service's name, such as `const impl: Users = { … }` or `function f(users: Users)` given `Users()`, or a TypeScript class that `implements Users` | TS2739 or TS2420: a service's name is now its identifier, Effect's `Context.Service` instance type, which carries its key, so another service with the same members or a structural type no longer stands for it. Type the implementation `Users.Shape`: `const impl: Users.Shape = { … }`, `static readonly default: Flags.Shape = { … }`, `function f(users: Users.Shape)`. `Users()` has the type `Users.Shape`, as `yield* Users` has. TypeScript writes `implements Context.Service.Shape<typeof Users>`. |
| A package compiled by 0.0.10 that exports a `service` declaration | Its declaration file declared `interface Users`, a key typed with the runtime's `ServiceKey` and a `namespace Users { interface Shape }`; it now declares what Effect TypeScript does, `declare const Users_base: Context.ServiceClass<Users, "<key>", { … }>` and `class Users extends Users_base`, and a service with only a default `const Flags: Context.Reference<{ … }>`. `.vibe` code doesn't change. Recompile the package; TypeScript that wrote `Users.Shape` writes `Context.Service.Shape<typeof Users>`. A `Context.Service` class migrated to a `service` keeps its key with `static readonly key = "…"`. |
| A `match` without `default` whose arms name classes that are not error classes (classes that don't extend `effect`'s `YieldableError`), `Error`, or a class with its own `[Symbol.hasInstance]` or `[customMatcher]` | EK4701: such an arm no longer proves the match covers its subject, and the diagnostic's note names each arm that did not count. Add a `default` arm, or declare the classes with `error` or `Data.TaggedError`. An error class counts wherever it is declared, a `.ts` file or a declaration file included. |
| A package compiled by 0.0.10 that exports an `error` declaration | Its declaration file now declares exactly what `class E extends Data.TaggedError("E")<{ … }> {}` declares. `.vibe` code doesn't change. Recompile the package so its `.d.ts` matches. |
| A trailing block, such as `Layer.effect(Users) { … }`, `it.effect("loads") { … }` or `Effect.scoped { … }` | `EK1101`: Code that compiled before now has a compile error: VibeLang has no trailing blocks (VIP-11). `vibelang --fix` writes the block as the call's last argument, `Layer.effect(Users, effect { … })`, `it.effect("loads", effect () => { … })`, `Effect.scoped(effect { … })`, or `f(x, () => { … })` for a plain callback. Runtime behavior is unchanged; comment printing and equivalent arrow layout can differ. |
| A block after an Effect dual, such as `withSpan("load") { … }`, `timeout("1 second") { … }` or `semaphore.withPermits(1) { … }` | A block is always its call's last argument, so the callee's type no longer moves it. Write the program first, `withSpan(effect { … }, "load")`, or use the curried form, `semaphore.withPermits(1)(effect { … })`. `vibelang --fix` rewrites each site. Where the appended call still type-checks, it is EK1023. |
| `() => fork p()`, or a `fork` in an `if` branch or a bare block | A fiber belongs to its innermost named region: a function body (an arrow's expression body included), one loop iteration, a `try`, `catch` or `finally` block, a block that declares `using`, or a `provide` or mask block. `if` branches, bare blocks, `do` blocks and `match` own nothing. Passing an owned fiber out of its region (returning, storing, assigning outside it, or capturing it) is now the error EK4838. Use `Effect.forkScoped(() => p())` for a child the caller's scope owns, or `detach(() => p())`. |
| A function that is an Effect function because of its body or its return annotation, such as `function load(id: string) { return try getUser(id) }`, a method like it, or a function literal passed where an Effect function is expected, as in `forEach(ids, (id) => getUser(id))` | Mark it `effect` (VIP-1), which goes exactly where TypeScript allows `async` (VIP-39): `effect function load(id: string)`, `effect (id) => try getUser(id)`, or a method `effect find(id)`. A function literal with no parameters that became a program where an Effect was expected, `retry(() => save(x), policy)`, is an effect block (VIP-2): `retry(effect { return try save(x) }, policy)`. `vibelang --fix --fix-vip-only` writes both, with `try` before a value such a function runs, and keeps a function that compiles to plain JavaScript unmarked. Only `effect` makes an Effect function: a function without it is plain JavaScript, returns an Effect it builds unrun, and gains no Effect type from its body or from where it is passed; `try` in it is `EK0501`, and a return type written on an `effect` function is an Effect type, `User!NotFound`, where `User` alone is `EK0106`. Run the codemod before you upgrade: this release no longer infers which functions to mark. A declaration without `function`, `effect load(id) { … }` or `async get(url) { … }`, is `EK0101`; its quick fix writes `effect function load(id)`. |
| A call of an Effect value: `Users()` for a service, `Port()` for a Config, `body()` for an Effect parameter, or `Journal.read()` for a service member that is an Effect | `TS2349` or `TS2348`: an Effect is not a function, and only `try` runs it (VIP-5); a service is read with `try Users` (VIP-10). `vibelang --fix --fix-vip-only` writes `try Users`, `(try Users).find(id)`, `try body` and `try (try Journal).read`, and drops the argument list from `try Users()`. |
| `async function load() { … }`, and `await` inside it | No longer EK1003: an `async` function means what it means in TypeScript (VIP-1), and `await` there waits for a promise. Awaiting an Effect there is EK4617: write `await runPromise(program)`. |
| `using h = Effect.acquireRelease(() => openDisposable(), release)` with a plain-holder workaround | The acquisition's release is now the only release, so `using` no longer also calls `[Symbol.dispose]()`. Bind the Disposable directly and drop the holder. |
| A package compiled by 0.0.10 that exports a `schema` declaration | Its declaration file declared the type as `interface User extends Schema.Schema.Type<typeof User> {}`; it now declares what Effect TypeScript does, the constant and then `type User = typeof User.Type`. `.vibe` code doesn't change. Recompile the package so its `.d.ts` matches. A TypeScript consumer can no longer merge declarations into the type, as with Effect's own alias. |
| `using n = count()` where the value has no disposal method and the initializer needs no `Scope` | TS2850. Bind it with `const`, or acquire it with `acquireRelease` so its release is recorded. |
| `const spawn = fork`, `const run = sync`, an import that renames `fork`, `join`, `sync`, `try` or `callback`, or `R.fork(x)` through a namespace import of the runtime | EK4410: a call spelled otherwise read its first operand by a binding its reader cannot see, so `spawn(work())` deferred `work()`. Call each under its own name where it runs; to pass forking as a function, write `(job: () => A!E!R) => fork job()`. In a `module` block the runtime's functions stay ordinary values. |
| A pause in a `using` initializer, such as a wait in the function that opens the resource | Cancellation now follows Effect. Every initializer runs with the interruptibility in force where the `using` stands, whether or not it requires `Scope`, so cancellation reaches its waits and `using` registers nothing. A `timeout` around `using db = openDb()` now ends at its deadline instead of waiting for `openDb`. To wait one out, write `using db = Effect.acquireDisposable(() => openDb())`: its acquisition holds cancellation off, and `using` adds no second release. |
| A package compiled from VibeLang whose consumers call its plain functions from Effect code | Its build now writes `vibelang.manifest.json` beside its declarations, listing each declaration file emitted from a `.vibe` file. A consumer trusts each listed module as a package in `trustedPackages`, so a call of its plain function is no longer EK4401. Publish the manifest with the declarations: add it to `files` in `package.json`. Stock TypeScript ignores it. |
| An Effect function held where a declared type makes it plain: `runAll(fs)` with `fs = [tick, tick]` and `runAll(fs: ReadonlyArray<() => unknown>)`, `const cb: (n: number) => void = logged`, an object such as `{ onSave(doc: string) { … } }` passed as `{ onSave(doc: string): void }`, or `const r: Resettable = new Counter()` whose unannotated `reset()` is an Effect method | EK4301: the caller of the plain type would drop the program unrun. These compiled before; only an Effect function passed by name or in an array written at the call was caught. Annotate the function or method with its plain return type, `(): void`; write `class Counter implements Resettable`, which makes `reset()` plain; or declare the destination to return an Effect, `() => void!!`. |
| A TypeScript caller of a `trusted(impl, [Errors])` value, such as `Effect.runSync(rows())`, or a `.vibe` file that passes one to `map` | `trusted` now returns one plain function of `impl`'s type, carrying its classes as `f[$errors]`: a TypeScript call returns what `impl` returns and throws what it throws, so drop the `Effect.runSync`. A VibeLang call still makes a listed exception an expected failure. `lines.map(slugify)` passes a value with an empty list and is EK4301 for one with listed classes; use `Effect.forEach(lines, slugify)` there. |
| `fork(() => work())`, a `fork` whose operand is a function | `EK1703` (VIP-17): `fork e` is `Effect.forkChild(e)`, so its operand is an Effect. Write `fork work()`, or `fork job` for an Effect `job`. |
| `await.all [a(), b()]`, `await.race`, `await.any` or `await.allSettled`, or `await.all { a: a(), b: b() }` | EK1802 (VIP-18): the await operations are retired. `vibelang --fix` writes `try.all`, `try.race`, `try.any` or `try.allSettled` over explicit Effects, so each element still runs when the operation runs, and an object becomes `try all({ … }, { concurrency: "unbounded" })` with its keys in the order written. `try.allSettled` gives each element's `Exit`; where the old operation gave a `Result`, `--fix` writes `all(…, { concurrency: "unbounded", mode: "result" })`. |
| A `schema` field typed `unknown`, `any`, `never`, `object` or `void`, such as `schema Event { payload: unknown }` | EK2109 (VIP-15): among keyword types only primitives map to a schema. Name the schema instead, `payload: Schema.Unknown`; `--fix` writes it. |
| An abstract class used as a service | EK4854 (VIP-9): write a `service` declaration. `--fix` removes the class spelling and preserves its members and key. Abstract classes now have ordinary TypeScript semantics. |
| `static readonly default = shape` on a service | EK4855 (VIP-9): write `static readonly defaultValue = () => shape`. `--fix` renames the member, wraps its type and value in a thunk, and updates its value and type reads (`typeof S.default` becomes `ReturnType<typeof S.defaultValue>`). |
| `A!E` on a function with a body inferred its requirements | EK4853 (VIP-3): every omitted slot is `never`, exactly as in `Effect<A, E, R>`. `--fix` writes the requirements previously inferred from the body. Leave out the annotation to infer the whole contract. |
| `for (const x of stream)` or native `for await (const x of stream)` | Native loops keep JavaScript iteration and TypeScript operand diagnostics. Choose `for try (const x of stream)` explicitly for `Stream` consumption inside effect code; `for await` in effect code is `EK0102`. |
| `try do { …; value }` in effect code whose value is not an Effect, such as `try do { try sleep(d); "late" }` | The `do` was a program that `try` ran; it now runs where it stands and `try` runs its value (VIP-2), so a value that is not an Effect is `EK0502`. `vibelang --fix` writes `try effect { return do { … } }`, which runs the block when `try` does and keeps its completion value. |
| A `do { … }` passed where an Effect is expected, such as `exit(do { 1 })` | `do` always runs immediately (VIP-2). `vibelang --fix` writes `exit(effect { return do { 1 } })`, delaying the block until the Effect runs and keeping its TC39 completion value. Ordinary `do` expressions stay immediate. |
| Nested `schema` aliases using `unknown`, `any`, `never`, `object` or `void` | Run `vibelang --fix` to write `Schema.Unknown` and keep the previous decoding and public declaration. The editor also offers the keyword’s explicit schema when that change is intended. |
| A `schema error` payload referencing a mutable-key codec, or a required payload referencing an optional-key codec | `EK2109`: run `vibelang --fix` to retain the codecs and decoding in an explicit Effect TypeScript class. |
| Nested `schema` aliases containing named, optional or rest tuples | Normal compilation now maps the tuple positions. Run `vibelang --fix --fix-migration-only` to retain the previous `Schema.Unknown` placeholders and public declarations through explicit Effect codecs. |
| Generic `data` with a default, such as `data Box<A = string>` | `EK2803`: run `vibelang --fix` to retain the default on an equivalent Effect TypeScript type alias and preserve the constructors. |
| A non-schema object used as a `schema` alias | If it has a public `Type` member, run `vibelang --fix` to expand the alias into its original `const` and `type` declarations. |

Direct platform calls such as `console.log` and `process.env.NAME` were
already EK4402 in 0.0.10; holding their values and importing Node values
are newly rejected. The trailing-throw example compiled with an inferred
return in 0.0.10 and is now EK1010; a restrictive return contract could
already reject it with EK2001. A nameless module already failed with less
useful diagnostics. The DOM type example, bare program statements,
primitive-base declaration, effectful method under a plain annotation and
`await` binding compiled then and are rejected now.

With npm:

```sh
npm install --save-exact vibelang-runtime@0.0.11 effect@4.1.1 @effect/platform-node@4.1.1
npm install --save-dev --save-exact vibelang@0.0.11 vibelang-vite@0.0.11 @effect/vitest@4.1.1
npm run build
npm test
```

With Bun:

```sh
bun add --exact vibelang-runtime@0.0.11 effect@4.1.1 @effect/platform-node@4.1.1
bun add -d --exact vibelang@0.0.11 vibelang-vite@0.0.11 @effect/vitest@4.1.1
bun run build
bun run test
```

Move the existing override in `package.json` to 4.1.1:

```json
{ "overrides": { "@effect/platform-node-shared": "4.1.1" } }
```

Projects using another bundler update `vibelang-unplugin` to 0.0.11
instead of installing the Vite plugin. See the 0.0.10 notes below for the
Effect 4.0.6 defect-precedence and interruption migration.

### Effect globals

- Every export of Effect's `Effect` module is a global in a `.vibe` file
  ([VIP-6](https://github.com/smithersai/vibelang/blob/main/docs/design/vips/0006-effect-globals.md)),
  not only the 15 most used: `tryPromise`, `promise`, `map`, `andThen`,
  `result` and the rest need no `Effect.` prefix, and the emitted JavaScript
  imports each one used from `effect/Effect`. A local declaration or import
  shadows one. A name that is a reserved word, a JavaScript global or a
  VibeLang keyword stays `Effect.x`: `Effect.try`, `Effect.undefined`,
  `Effect.match`. Set `"vibe": { "effectGlobals": false }` to turn the
  globals off ([Effect's modules](../getting-started/008-importing-effect.md)).

### Configuration upgrade

| Before | Now |
| --- | --- |
| A schema field with a JavaScript initializer | `TS1247`: run `vibelang --fix` to remove the ignored expression. Choose an explicit codec default when a default is intended. |
| A required schema field whose referenced codec has optional or uncertain decoded key flags | `EK2109`: run `vibelang --fix` to keep the existing codec as an explicit `Schema.Struct` value. Written optional fields keep their optional behavior. |
| A `Record` value referenced optional decoded keys or a readonly `Record` referenced mutable decoded keys | `EK2109`; `vibelang --fix` preserves the existing codecs, declarations and decoding. Schema-error declarations retain their constructors and matchers. |
| A schema reference with an empty type argument list, such as `schema Name = Address<>` | `EK2109`: run `vibelang --fix` to remove the empty list. The codec, decoded values and declaration types stay the same. |
| A schema field with repeated `readonly` modifiers | `TS1030`: run `vibelang --fix` to keep one modifier and preserve its codec. |
| The `try` hatch, `try((text) => parse(text), (e) => new Bad({ e }), text)` | EK4616: `try` is an operator that runs an Effect (VIP-5), so `try(…)` is no longer a hatch. Wrap the code with Effect's own `Effect.try` or `Effect.tryPromise` and run it with `try`: `try Effect.try({ try: () => parse(text), catch: (e) => new Bad({ e }) })`. `vibelang --fix` rewrites each hatch, writing an arrow's body as the thunk with its inputs bound to its parameters, or else passing its inputs to its function, and refuses one whose inputs run code. A function that is not `async` but returns a promise is no longer awaited: write it `async`, or wrap it with `Effect.tryPromise`. The function `Effect.try` or `Effect.tryPromise` wraps is TypeScript, as a hatch's is: a `throw` there is JavaScript's, for the wrapper to catch, and platform APIs such as `fetch` are allowed there, where they were EK4402 before. `import { try } from "vibelang-runtime"` no longer resolves. |
| `/** @throws {E} */` or `@rethrows` in a `.vibe` file | `EK0406` (VIP-4, amended 2026-10-31): VibeLang functions never throw. Run `vibelang --fix` to remove the tag, and write an `effect` function's failures in its error type, such as `number!NotFound`. |
| `vibelang.diagnostics` | Run `vibelang --fix` to move configurable warning settings to `vibe.severities`. Remove obsolete legacy policy entries before rerunning `--fix`. |

### Diagnostic codes

| Before | Now |
| --- | --- |
| Old diagnostic numbers, including `EK4617` | Appendix B numbering, including `EK0103`. Diagnostic triggers are unchanged. See the [old-to-new map](../vibelang-features/diagnostic-code-map.md). |

### Bugs fixed since 0.0.10
- The ESLint corpus check rejected deliberately constant source literal conditions as generated code; it now checks each reported literal against its source while continuing to detect unwritten constants.

- Stock-oracle and package-load migration checks could fail while reading an absent legacy setup receipt. Their fixtures now record complete public declaration metadata and real upstream packs before testing certification and load regressions.

- Service declaration checks still expected an implicit namespace for a written shape and omitted the legacy `Effect` migration warnings; they now enforce the direct written type and the current migration output.

- Converting an ambient `schema error` to a native class inserted static initialization that TypeScript rejects. The editor repair now keeps the ambient class erased and valid while runtime class repairs retain their matchers.

- An `EK4833` warning on an Effect type with a union slot lost its concrete shorthand suggestion when the automatic fix was unsafe; it now shows the required parentheses while retaining the refusal to change grouping or declarations. Legacy `Effect<…>` annotations in callback and service cases also retain their required `EK4856` warning coverage.

- Migration oracle regression tests treated changed documentation as harmless spelling and overlooked unchanged declarations in a failed API proof; they now check documentation and the full comparison closure.

- Private-declaration and one-pass record regression checks could fail on a missing upstream pack receipt before reaching their intended assertions. Their fixtures now record actual package archives, keeping publication policy independent of declaration privacy and final generated-byte checks.

- Loop-head regression checks now use explicit outer `let` bindings where `var` was retired, preserving shared cells and TDZ checks under VIP-1.

- Migration tests could hit their aggregate deadline while declaration workers still made progress. The complete suite now has a bounded 90-minute budget and reports selected files, progress and full assertion details; failed or interrupted runs keep their nonzero outcomes.

- Forced-record migration checks could stop on obsolete partial fixture receipts before writing their PR proof. The fixtures now capture real packs, run verification and retain each case's intended compiler or formatter, so protected edits and proof reporting are tested together.

- The JSX formatter regression used a regex where the pinned relational-pattern grammar requires a literal or member operand. It now checks a valid member operand containing a regex and separately verifies that the invalid raw-regex form is refused.

- The legacy Effect-alias fuzz check compared a current mutable type with the explicit source upgrade's former readonly defaults. Its fixtures now distinguish upgrade and ordinary-fix modes while retaining strict declaration identity checks for both.

- Repository build checks could fail before inspecting compiler inputs after target declarations changed. Their isolated fixtures now retain the native source group and imported parser data while checking dependency and cache behavior.

- A `do` expression with no normal result suppressed native iterator errors in loops, destructuring, delegated yields and call spreads, so migration missed a required cast. These uses now retain TypeScript's `never` protocol checks; array literal spreads keep their native behavior.

- Migration checks rejected a valid Knip configuration that registered both `.vibe` and `.vibex`. The check now loads the generated module and verifies both compiler bindings and sidecar excludes.

- The formatted-declaration certification property suite could not load because an assertion lacked a closing parenthesis. All declaration and formatter-mutation cases now execute again.

- The direct-consumer migration regression expected its specification comments to disappear and failed the compiler gate. Its fixed example now preserves those comments and checks diagnostics at the corresponding source lines.
- Upgrade regression checks could stop at an invalid fixture lockfile, missing package version or text placeholder used as a toolchain archive. Valid package fixtures now reach the upgrade gates and verify public release dependencies alongside exact staged development pins.

- Source-map fuzz checks could confuse a loop's shadowed binding with an outer declaration of the same name. They now distinguish written binding sites while retaining strict checks for misplaced mappings of real declarations.

- Computed assignment keys around `do` now have native-JavaScript differential coverage, including compound and logical assignments, coercion side effects and abrupt completion.

- Inferred `FileSystem` service identity lacked regression coverage beside ambient host types. New native-twin tests cover function, arrow and layer annotations, including sidecar resolution.

- Migrating an SSR entry left Vite's `/src/…` `serverEntry` or `clientEntry` URL pointing at the renamed TypeScript file. The codemod now follows those URLs in owned Vite configuration variants and records exact reversible edits.

- Migration checks for reserved schema-error payloads now require tag matching: a child with a different `_tag` misses the base pattern, and its class upgrade preserves the same result.

- Upgrading a `schema error` to a class could refuse the migration with `EK0704` at its extractor patterns. The checker now recognizes the own matcher that the migration installs, while inherited matchers remain excluded.

- Nested Effect types keep their qualified spelling when shorthand would need new grouping; migration checks now cover both direct nesting and array boundaries.

- Vite coverage counted private tail-delegation wrappers as extra functions or uncovered statements, especially in callbacks and throwing catch handlers. It now counts the authored functions and statements through the composed source map.
- Repository migration checks could stop at invalid fixture lockfiles or package metadata before checking build provenance, declaration exits or test regressions. The fixtures now retain valid publication prerequisites and reach those checks.

- A native checker reported `TS2307` when it reached a package whose VibeLang declarations were hidden under `vibe.sidecarDir` through another package’s TypeScript sources. Setup now supplies private type routes to the physical declarations, preserving loader identity and the normal built JavaScript and declaration paths. Bun’s native `bun check --no-script` keeps its existing command.
- The service-read migration check rejected the simplified tooling specification because it quoted retired wording. It now checks the current requirement to preserve types, behavior and declaration output.

- Fuzz validation still treated eight module and diagnostic registry examples and a recovered malformed layer input as compiler gaps after their fixes landed. Those retained regression inputs now run as strict checks.

- Regression coverage now checks ambient `error` and `schema error` quick fixes across explicit and inherited declaration contexts, so a repair that introduces executable class code is detected. Known compiler gaps remain tracked separately.

- The new catch-handler projection fuzz target omitted its CPU-budget registration. It now participates in the same short-seed budget check as every other target.
- The editor stopped offering "Run it with try" on a direct Effect argument that `EK4802` reports at a plain generic call. It offers it again when the enclosing contract accepts the Effect; a returned program stays data and gets no action.
- The TS7 mapper stopped parsing every `for try` loop after its head began lifting the Stream into a separate scope. The mapper now keeps the loop as written.
- The TS7 mapper crashed on `x catch function (e) { ... }`, because it read every handler as an arrow function. It now projects a function expression handler.

- Release checks used the old API comparison helper set and Go package census. They now include the split ambient helper and language-service package.

- Catch-repair checks also failed on obsolete throws annotations in their VibeLang fixtures. Their sources now follow the no-throw rule while retaining the repair and comment assertions.

- The ESLint tree check missed source functions inside an effect block. It now visits the generated builder call and checks those functions.

- Chapter 7 compiler tests could not find the pinned Effect package without an external environment setting. They now use the installed package beside the runtime.

- Specification validation rejected accepted matching, catch and declaration rules because their diagnostic authorities were missing or a retired code looked current. The registry now names the accepted VIPs and marks `EK0511` as historical.
- The exception-boundary regression case no longer fails on the required `EK4856` migration warning for a legacy `Effect<A, E, R>` return annotation; it now checks that warning alongside the existing exception diagnostics.

- The browser Window example was still marked pending, and the JSON logging example failed its output check under the no-throw rules. The Window example now compiles as supported, and the logging fixture wraps each JSON parse in `Effect.try`.

- An error accessor with a forbidden `effect` modifier and a reserved `_tag` name reported an extra tag error; it now reports the modifier error without the extra reserved-tag error, preserving independent TypeScript errors.

- The compiler regression suite rejected accepted service defaults, readonly schema migrations, declaration sidecar imports and legacy trailing-block repairs after the language rules changed; those checks now use the current syntax and preserve their original migration and rename assertions.
- `vibelang --fix` resolved every import of a large project again for each checking program. It now reuses module resolutions while the set of created files stays the same, reducing the time spent finding unchanged modules.

- Vite, Vitest, source loaders and typed ESLint rejected `.vibe` modules included only by a sibling `tsconfig.json`, sometimes preventing tests from starting. They now find a containing project within the package and use its compiler options. Overlapping projects follow nearest-config and project-reference selection; modules no project contains still fail clearly.

- A build that the migrate flow's setup moved from plain `tsc` to `vibelang` failed when its only diagnostics were Effect warnings, though `tsc` ignores the tsconfig's `@effect/language-service` entry and passed: opencode's `@opencode/http-recorder` build exited 2 on `unstableApiUsage` warnings, so its `script/pack.ts` published nothing. In a repository whose package scripts never run `effect-tsgo` or `effect-language-service`, setup now adds `"ignoreEffectWarningsInTscExitCode": true` and `"ignoreEffectErrorsInTscExitCode": true` to each `@effect/language-service` entry in its tsconfigs, keeping any value the entry already sets. `vibelang` honors them, so those diagnostics still print and no longer fail the build. A repository that patches its compiler keeps the Effect exit policy.
- Migration verification tests failed after the pack gate began requiring an upstream receipt. Their fixtures now record real pack baselines; missing receipts and unauthorized edits still fail.

- A plain generic call such as `expect(awaited())` could report `EK4802` without its direct-argument repair. The editor and `--fix` now offer `try` when the written contract accepts it; returned Effects retain their existing repair policy.

- The VIP migration could refuse a generic call with an Effect supplied by another argument, reporting `EK0502` after running a program the old call held. It now preserves that sibling-established program context.

- The compiler's keyword coverage check treated a quoted `"constructor"` member name as a VibeLang keyword and failed the parser suite. It now distinguishes guarded string-literal data from keyword comparisons and ignores examples in comments or test fixtures.
- The grammar admission check no longer reports the compiler helper for `super` method and tag receivers as undocumented; it now cites the existing Effect callable bindings rule.
- Grammar admission checks still expected the old interruption-placement bug after the compiler fixed it. Their saved witnesses now verify rejection and no longer report an obsolete pending gap.
- Newly published Effect-type lookahead and call-time parameter helpers could fail the grammar admission inventory gate. The inventory now records their existing language authority.
- The grammar admission fuzzer could mistake an invalid `for await` placement for accepted undefined syntax. It now recognizes TypeScript's `TS1103` rejection and keeps a minimized replay.
- Reordering the grammar admission inventory could incorrectly report a duplicate hook when a legacy branch row preceded its base row. The census now accepts either order while still rejecting repeated rows.
- The grammar admission inventory stopped accounting for every compiler helper after a hatch operand helper was extracted; that helper now has an explicit pending row under the existing hatch audit.
- The fuzz suite refused an editor regression’s pending record because it lacked a specification reference; it now cites `VIP-34` and retains the same reproducer.
- The grammar admission audit could mistake TypeScript’s `for await…of` loops for undefined VibeLang syntax; its grammar now derives those loops and checks malformed heads separately.

- `fork` and `join` in plain functions, nested callbacks, initializers and parameter defaults could compile or report an operand error. They now report `EK1701`; `vibelang --fix` preserves the old cold program construction with an explicit API call.
- `Effect.forkChild(e)`, `Effect.forkDetach(e)` and other calls whose type parameter is constrained to an `Effect`, such as `<Arg extends Effect<any, any, any> | Options>`, warned `EK4802` that the call receives the unrun program. Such a parameter declares that it takes a program, so it no longer warns.
- A function whose only statement is `return try value` showed V8 coverage, and tools that read it, a second function for the generator the compiler makes. That generator now maps to no source position, so coverage counts one function, as before tail `try` kept native delegation.

- Migration setup added star imports to source-child launchers and triggered their existing lint rules. Helpers now reuse runtime imports or add unaliased named imports, including inside private TypeScript modules, while retaining authored bindings and comments.

- A one-pass migration stopped when a selected module's import closure exceeded `240` modules, such as t3code Mobile's `369`-module closure. The fix pass now uses the original whole project and its compiler safety gate, keeps only selected rewrites, and records why it fell back.
- Migration verification rejected package scripts that the codemod had repointed to migrated entrypoints. It now accepts exactly the recorded replacements, while extra flags, changed test scripts and unrelated manifest edits still fail.
- Migration verification mistook its emitted JavaScript fixtures for newly added tests. It now recognizes newly generated files by recorded byte digests; real fixtures and later output edits stay protected.
- Migration verification lost valid `./x.ts` to `./x.js` spelling receipts when another declaration target was absent. It now records each proven pair independently and still refuses unresolved or changed APIs.
- Migration verification marked every opted-in private module unproven because setup skipped its stock declarations. Setup now captures and checks their API identity, while changed or unavailable APIs still fail.

- The Go fuzz package could fail to build when tests for `do` completion reused the same names. Both independent spec checks now compile and run together.
- `EK4834`, `EK4835` and `EK4836` warned on `try Effect.succeed(1)` and the other form spellings in plain functions, where `try` is already `EK0501` and runs nothing. These warnings now appear only in effect code, as the specification requires.
- `--fix` left `try (x |> Effect.catch(%, h))` as written after a pipeline migration. It writes `x catch h` again; the `EK4835` warning still reports only a direct `try` operand.

- Editor conformance checks now cover local, exported and namespaced error declarations, requiring completion answers at real references while accepting TypeScript declaration-name behavior.
- Repeated test-harness runs reported `declaration API comparison unavailable` ("Ambient declaration load order differs") for Chapter 4 and VIP-7 match cases: a case's runner left `typescript/node_modules/effect` linked to its pinned reference Effect, and the next run compiled the TypeScript twin against it. The harness now removes that link, so the twin compiles against the case's Effect on every run.
- `vibelang --fix` rewrote every qualified call such as `Effect.succeed(1)` to the bare global `succeed(1)` once VIP-6 made every Effect export a global, so the fixed forms of the TypeScript-form and migration examples changed again on a second run and `--fix` built more checking programs than its bound allows. `--fix` again leaves qualified `Effect` calls as written.

- Fixing several modules could stop with `fatal error: concurrent map writes` while checking declaration imports, leaving a partial result. Parallel declaration collection now synchronizes its writes.


- Module body declarations could escape discovery regression checks; fuzz coverage now compares rebuild input selection and overwrite protection with native TypeScript.
- Editor fuzz checks treated a `schema error` declaration name as a reference and could reject empty completion replies; declared-reference probes now exclude those names and deduplicate source positions.
- The grammar inventory could fail after the escaped `effect` keyword repair because its helper lacked an authority entry; the inventory now records the existing lexical rule.

- Throw-expression checks previously had regression coverage focused on grammar and runtime behavior. The fuzz suite now also checks `EK0401` placement across plain callbacks, caught throws, eager defaults and `.vibex`, with async and effect controls; compiler disagreements remain explicitly tracked.

- Bun emitted-source forwarding preserves live bindings and native TypeScript export erasure; its export inspection now has independent native-namespace regression coverage without executing source modules.
- `var` declarations silently compiled despite the language restriction; every source `var` now reports `EK0107`, while ordinary property names and strings remain valid. Rewrite the declaration with its scope in mind; there is no blanket `var` to `let` quick fix.

- Nested object properties and method types inside an `error` or `schema error` were implicitly readonly, so ordinary TypeScript writes failed. Nested types now keep their written mutability; payload keys remain readonly.

- A generated grammar census was mistaken for hundreds of new language rules by the evidence gate. Valid census metadata is now recognized without exempting adjacent or handwritten rules.

- A literal `__proto__` key in a `match` or `is` pattern could report `EK0707` twice; it now reports one error per invalid key.

- A `match` could miss cases after a guard narrowed a broad subject to a finite type. `EK4701` now checks the type at the match expression, including narrowed properties and assigned values.

- Regular-expression and relational patterns, such as `when /^a/:` and `when >= 10 and < 20:`, reported `EK4704` or a syntax error; they now run as the pinned proposal says, including stored `RegExp` values, and a regular expression with an argument list extracts its match.


- Private service-shaped `control` handlers previously required manual migration. `vibelang --fix` now rewrites a provably safe tail-`resume` subset to ordinary services, preserves its existing key in scopes without a derived key, and reports unsupported continuations without changing them.
- Error recovery could leave an assigned value possibly `undefined` and lose an unhandled error type. Running calls now keep omitted generic branches at their defaults while still inferring supplied arguments.

- Binding a computed property from an `unknown` match subject could report `TS7053`; the binding now has type `unknown`, while typed records and source-written accesses keep their checks.

- A service with a written shape annotation gained an extra public `Shape` namespace in its declarations. It now keeps the written shape directly and exposes no implicit namespace outside its own body.
- Formatting a generated subprocess helper could make migration setup treat it as hand-edited and retain unused loader imports. Setup now recognizes formatting changes while preserving edited code, types, comments and documentation for review.
- Migration setup could add source-loader helpers to JavaScript CLI launches merely because later arguments were dynamic, introducing unnecessary install-time dependencies. Proven JavaScript entrypoints now keep their native launch; unknown and typed source entrypoints retain loader handling.
- Reverting converted Mobile dependencies keeps the original import spellings in converted consumers; a named T3code corpus now protects this across both migration record formats.
- Rerunning migration setup could leave obsolete subprocess loader helpers in shell launchers. Setup now writes the validated cleanup even when no source child remains, preserving the native launch without adding loader dependencies.
- Documentation checks missed code-formatted Effect pins; regression coverage now exercises both spellings and reports missing or malformed pin decisions.
- Parameter-default coverage missed outward `return` in `do` expressions; tests now check early exits before later defaults and body execution across functions, arrows and methods, with compiler gaps tracked explicitly.
- The pin regression suite stopped after the specification explicitly named the previous patch; its citation now matches the accepted rule while retaining all version checks.
- Resolution coverage omitted explicit native imports whose sibling has the other source extension; regressions now compare both directions with stock TypeScript and declaration-file decoys.
- Bundler sidecar checks failed on an obsolete specification quote; they now read the current declaration-output contract.

- Migration regression checks could reject a preserving empty-trust rewrite after prelude cleanup shortened `Effect.orDie` to `orDie`. They now accept either spelling while retaining declaration and execution checks.

- Packed packages could leave private emitted imports pointing at compatibility declarations that were absent from the archive. Publication now maps each exact source to the package’s regular built declarations while preserving its runtime targets.
- No-throw documentation and fuzz checks failed after VIP-41 clarified `throw` expressions; their citations now match the current rule.
- The `effect` quick fix was missing for arrows with one bare parameter; it now adds the required parentheses and preserves comments.
- A `match` array or extractor pattern with something after its rest element that starts no pattern, such as `when [...a, *]`, hung the compiler and the editor until they ran out of memory. The parser now reports the misplaced element once and continues.
- A `layer` body holding a token that cannot start a statement, such as `layer L: S { default }`, hung the compiler and the editor until they ran out of memory. The parser now reports the error once and continues.
- The specification evidence check rejected deleted rules and unchanged rules with shorter wording. Deletions now add no obligation, and repointed test citations retain their existing evidence; new or changed rules still require evidence.

- Broken relative imports in module-body sidecars could escape regression coverage; independent TypeScript consumers now check both declaration layouts.

- Compiler checks for `unknown`-operand repairs could fail on an invalid `@throws` annotation in their input. They now use a valid declaration while preserving the diagnostic and error/service-channel checks.

- `do` blocks could report implicit `any` errors on generated names, widen literal alternatives to `number` or erase `never`; `match` on `[]` could report implicit `any[]`. Generated bindings now keep the source expression's checked type, including in unreachable code.

- `--fix` and the editor could make `Match.instanceOf` accept primitive values it previously rejected; unproven constructors now retain the `EK4839` warning without a repair, while proven ordinary classes still convert to `match`.
- Documentation checks accepted throws in synchronous arrows whose parameter was named `effect`; they now apply the same rule after parameter renaming.
- No-throw validation incorrectly failed after a plain catch handler became an effect handler; its regression fixtures now use catch's existing join point without a redundant `try`.
- Migration setup could leave a nested workspace consumer on `tsc` when a semver peer or npm alias resolved to migrated workspace sources. Setup now follows installed workspace links for compiler, test-runner and worker wiring while respecting nearer registry packages.
- Automatic repairs dropped service declaration imports when ordinary declaration output was disabled. They now apply the same import checks with sidecars and keep source unused-import checks effective.
- The Go validation graph omitted the language-service tests, hiding stale trailing-block fixtures. It now runs that package, checks ordinary Effect arguments, and retains the retired forms as rejection tests.

- VibeLang could treat a namespace re-export in a `.d.vibe.ts` file as untyped and report `TS7006` in TypeScript callbacks. Explicit `.vibe` imports now find compatibility declarations when no source exists, preserving contextual types and real callback errors.

- The failure-spec fuzz suite still marked seven working Promise-wrapper and typed-failure rules as broken. Their stale pending markers are removed, so those regression cases now run normally.

- A method decorator named `effect` confused the no-throw documentation check with an `effect` modifier. Method bodies and async parameter defaults now keep their own declared context regardless of decorator names.

- `EK0401` offered no TypeScript-file migration and `--fix` skipped safe no-throw repairs. The editor now moves self-contained declarations with their imports and re-exports, preferring that option for published exports; `--fix` repairs plain handlers and unused local functions.

- The no-throw documentation check rejected a field decorator inside `async` or `effect` code as though it were a field initializer. It now checks decorator expressions in their surrounding context and field values in their own synchronous context.

- A legacy typed catch with no written `throw` failed the no-throw documentation check when another function threw. The check now distinguishes source throws from generated fallback rethrows.

- The no-throw documentation check rejected a legal `do` expression in an `async` parameter default; it now uses VibeLang’s parser and preserves the source callable context.

- Editor validation still reported four repaired wide `Option` handler cases as failing. They now run as normal passing regression cases.

- The specification linter failed to load after independent updates repeated its declaration-retirement fixture; the fixture and its exact repeated tests are now declared once.

- A build with only an imported Effect warning, such as `promiseInEffectSuccess`, incorrectly exited successfully and could emit under `noEmitOnError`. Imported diagnostics now follow the pinned Effect TypeScript compiler's exit and emission options, including ignored warnings and explicitly enabled suggestions; VibeLang's own warnings retain their existing policy.
- Migrating a discarded `yield*` result that was itself an Effect could leave a bare program statement and prevent the migration from compiling; the fixer now writes `void try`, preserving the discarded value and keeping the inner program cold.
- Migration returned modules containing TaggedError classes the compiler deliberately kept to preserve their published tags. The style gate now accepts those explicit refusals while retaining other style checks.
- Two calls of a plain TypeScript function in one effect function, each with an Effect operand, made `vibelang --fix` refuse both with `TS2451`, because each fix named its operand's `const` the same; each now gets its own name, and `EK4401` is fixed.
- Coverage parity's own negative controls were absent from the test graph and failed the test-discovery guard; a dedicated target now runs all five controls.
- A `match` array or extractor pattern with something after its rest element that starts no pattern, such as `when [...a, *]`, hung the compiler and the editor until they ran out of memory. The parser now reports the misplaced element once and continues.
- A `layer` body holding a token that cannot start a statement, such as `layer L: S { default }`, hung the compiler and the editor until they ran out of memory. The parser now reports the error once and continues.
- `for concurrent("unbounded")` and limits typed `Types.Concurrency` incorrectly failed with an argument type error; they now accept Effect's full concurrency domain.

- Old bare `fork { ... }` blocks, including `fork{}`, stayed behind during migration; `vibelang --fix` now writes explicit Effect construction while preserving the body and captures.
- Legacy `wire` calls kept their automatic dependency ordering after migration; `vibelang --fix` now writes explicit layer composition while preserving argument evaluation and public declaration types.
- Renaming a shorthand pattern binding could change the property it matched and add `TS2339`; rename now keeps the property key and writes an explicit binding.

- Rolldown entry globs could bundle generated `.d.vibex.ts` declarations as empty entrypoints; the plugin now excludes those sidecars and retains the JSX source entries and aliases.

- Published API checks rejected unchanged generic declarations when an import crossed a self-namespace export. Those copies now compare identically while changed exports and dependencies still fail.
- After the migrate flow moved a module-level `let` into a `.platform.ts` sibling, a kept function that assigned it failed `TS2632` ("Cannot assign to ... because it is an import"). The codemod now moves every function that writes the moved binding with it, or keeps the module in TypeScript when such a writer must stay exported.

- Declaration-twin checks missed async signatures; regression coverage now verifies their explicit `@throws {never}` contract while preserving authored documentation.

- Regression coverage now checks that typed lint projects retain real Effect requirement types through native imports and declaration sidecars, including nested tests and aliases.
- Running a parenthesized `effect { ... }` block with `try` was diagnosed as an old hatch; it now runs the block and preserves errors inside it.
- Generic `data` helper names used unstable suffixes and could collide with source names; they now use `$Name$Definition` and the first free numbered suffix.
- Async-to-Effect conversion could skip a returned object's `then` getter or its error; conversions now preserve that Promise-adoption read by declining accessors and aliased objects, while keeping fresh data-property literals available.

- The editor's `EK0401` fix using `die` could join the next statement to a return and leave a syntax error. It now preserves the written semicolon and comments.
- `vibelang --fix` kept the type name an `Effect.fn` fix left unread, and so left a new TS6133 or TS6196, whenever another fix in the project was refused: retrying the refusals took the unread name for one the author had left. It now removes the name as it does when nothing is refused.

- Identical namespace exports with private generic constraints could fail an API identity check; declarations proven to be the same module export now compare directly.

- API checks could reject unchanged packages using `vibe.sidecarDir` because imports in mirrored declarations resolved from the wrong directory. They now resolve from the physical declaration file, matching `tsc`.
- Find references on a `module` declaration's name returned only the declaration, and nothing from a specifier such as `from text`, while rename edited every specifier; renaming an imported type of the same name left `from M` naming the old module (`EK4006`). Find references now returns the declaration and each identifier specifier, and rename edits those specifiers in both cases.
- Find references on a `module` declaration's name returned only the declaration, and nothing from a specifier such as `from text`, while rename edited every specifier; renaming an imported type of the same name left `from M` naming the old module (`EK4006`). Find references now returns the declaration and each identifier specifier, and rename edits those specifiers in both cases.

- A quote inside a regular expression confused the no-throw documentation check; regex literals now retain their parser boundaries when projecting `effect` modifiers.

- The language-server smoke fixture used a plain function for a throw expression; its function is now `effect`, keeping the fixture free of unintended no-throw errors.

- The grammar inventory omitted the binding-preservation helpers used by retired hatch fixes; their migration authority is now recorded.

- The no-throw documentation check missed plain functions with an `effect` parameter or a nested function on one line; it now parses callable contexts and checks both forms.
- A service declaration could replace a written `Context` namespace alias with a new import in its public declaration. Generated service types now retain a visible namespace alias and preserve its import.
- Upgrading a `.vibe` module could remove `readonly` from interface and object-type declarations, changing its published API. `vibelang --fix --fix-migration-only` now writes the old modifiers explicitly and preserves those declaration bytes.

- Codemod conformance checks could report an unchanged private helper as a changed contract; their copied declaration probes now compare private signatures without assuming the original module exports them.

- Passing or storing a function returning an Effect at a TypeScript-compatible callback type could report `EK4301`; these values now follow native TypeScript assignability, and calls still return their Effects unrun (VIP-1, detail303).
- API checks invented ambient exports or hid an ambient type change when one input directory contained the other. Contributions now follow each snapshot’s dependency closure, and nested private-class origins remain distinct where required.

- The editor outline merged separate `module` declarations as TypeScript namespaces and hid a later declaration with the same name; each VibeLang module now keeps its own outline entry and name range, including an invalid duplicate.
- API comparisons of packages installed with multiple pnpm peer contexts could report an ambiguous ambient origin; corresponding peer installations now compare separately.
- API comparisons could reject identical copies of classes that imported Node ambient modules; those imports now use the declarations TypeScript resolves.

- Grammar checks no longer report the private trailing-block migration helpers as unaccounted; they are recorded as recovery under `VIP-11`, while trailing blocks stay rejected.

- The documentation sent readers to the removed `vibelang-forms -legacy` command. It now describes supported forms checks, and the unused legacy inventory is removed.

- Throw expressions rejected unary nesting and allowed some ambiguous operator and comma positions; they now follow the pinned TC39 proposal, including its parentheses and line-break rules (VIP-41).

- After the migrate flow moved a module's platform code into a `.platform.ts` sibling, a private `const` it moved could fail `TS18047` ("possibly null") where kept code read it inside a closure under a guard. The module now binds the moved value to a local `const` of the same name, so the guard narrows it as before.
- The migrate flow never split a module that an earlier pass returned to TypeScript for reading a host global such as `window`, `process.env` or `setTimeout` (`EK4402`), so the module went back to TypeScript on every pass. A run now lists earlier passes' `settle-causes.json` or `reverted.json` as `"platformCauses"` in its `config.json`, and the codemod moves the declarations that read each named global into the module's `.platform.ts` sibling.
- Plain function expressions after `catch` were returned as values instead of called; they now receive the failure, keep the result as data and allow ordinary typed parameters. Invalid generator handlers retain `EK0509` without artificial callback type errors.

- Specification table and authority checks rejected the historical explanation that accepted `VIP-40` supersedes denied `VIP-25`. They now verify the accepted successor while continuing to reject positive authority claims based on the denied proposal.
- API checks lost referenced ambient or library types when a declaration also contained a private class. Nominal alignment now preserves leading reference directives, and referenced type changes remain visible.

- Migration verification rejected unchanged programs whose original declaration emit already reported errors; it now compares with the saved original diagnostics and rejects new or unexplained emit failures while retaining the declaration identity checks.
- ESLint rules could mistake an `effect { ... }` program passed to `Effect.catchCause` for a handler that ignored its cause. Program blocks now appear as program values while real handlers retain their parameters and scope checks.
- A plain callback passed from Effect code could be rejected with `EK1005` when it called a captured root runner. Plain callbacks now retain their TypeScript body, just like assigned and returned functions.
- Imports left as `./x.ts` after a module became `.vibe` depended on a compatibility fallback; `vibelang --fix` now repairs those stale imports using the project's tsconfig (including `rootDirs` and `moduleSuffixes`), and the migrate flow selects source or runtime names by the same rules before that fallback is retired.

- A type assertion ending in `!!` followed by `<` was rejected as a malformed generic function type; it now parses as an ordinary comparison and keeps the usual operand checks.

- `eval`, the `Function` constructor, `arguments`, `with`, the `.constructor` of a function value and a string-literal `data:` or `blob:` import specifier compiled silently in `.vibe` files despite the language restriction; each now reports `EK0107`, while `x instanceof Function`, `Function.prototype`, the type `Function` and ordinary property names such as `o.eval` stay valid.
- `vibelang --fix` refused an `Effect.gen` or `Effect.fn` whose body held a `.pipe` that changes type as `|>`, such as `.pipe(HttpEffect.toWebHandlerWith(context))`, whose stage takes its requirements from the `.pipe` (TS2345), and then wrote that `.pipe` as `|>` inside the generator it left, so the generator never converted. EK1002's fix now retries keeping the body's `.pipe` calls.
- `vibelang --fix` refused an `Effect.fn` whose parameter annotation was the last read of an imported value binding that only types read, such as a namespace in `SessionSchema.ID`, with TS6133, so the module stayed on `EK1002`; the fix now removes that binding too, and keeps a bare import under `verbatimModuleSyntax`.

- Configuration fuzz checks rejected valid `vibe.sidecarDir` strings and cited an obsolete sidecar layout. They now accept directory strings, reject other JSON types with `EK3007`, and quote TypeScript’s declaration source root rule.
- API checks rejected valid packages with `rootDir` or composite builds because their generated probe was outside the project. The virtual probe now stays inside the effective project root, while real outside-root source errors still invalidate the comparison.

- Identical recursive generic type exports could fail an API identity check because each side received a fresh comparison alias; proven equivalent declarations now share that alias.
- An object pattern whose `_tag` is an enum member or a unique symbol, such as `when { _tag: Kind.A }:`, covered no case, so a `match` naming every enum member still reported `EK4701`. Each such pattern now covers its tag case.
- A `match` over tagged members that share a tag, such as `{ _tag: "A"; x: number } | { _tag: "A"; y: number }`, or whose `_tag` is a union of literals, reported `EK4701` even when its arms covered every tag case. Coverage now counts each member's tag cases one at a time, as chapter 4 requires, and still reports the member or tag case an arm leaves.

- A generic plain call such as `expect(awaited(p))` silently received an unrun Effect. In effect code it now reports `EK4802`; `--fix` writes `expect(try awaited(p))`, and explicit Effect type arguments keep the program as data.

- Migration verification reported passing React Compiler coverage cases as missing after their source paths changed from `.ts` to `.vibe`; test titles now follow recorded source renames while retaining case counts and failures.

- `vibelang -p` panicked with `path must be rooted and normalized` on a `.d.ts` file whose directory or own name starts with or contains a dot, such as `/work/.hidden/proj/env.d.ts`, `.env.d.ts` or `..d.ts`, when an `include` pattern selected it; the compiler took the text before the last dot for a module body declaration source (`x.vibe.name.d.ts`) and now checks for a `.vibe` file name within the file name first, so these files are inputs as in tsc.
- Migrate setup pinned a Bun project's staged toolchain in root `resolutions`, which Bun ignores when the root `package.json` has `overrides`, so `bun install` asked the registry for an unpublished `vibelang-runtime` and failed. Setup now adds Bun's pins to an existing `overrides`, keeps `resolutions` otherwise, and removes a pin table it created when the pins are removed.
- `vibelang --fix` refused to remove `try Effect.void` from a `match` arm because its rewrite deleted the required arm expression and introduced `TS1109`. It now keeps a value in the arm, preserving inferred `void` types, comments and locally shadowed names.
- `vibelang --fix` left `Effect.fn(…)(function* (path) { … }, (effect, path) => …)` on `EK1002` when a stage read the function's arguments, or when a comment stood in the generator's parameter list or before a stage. It now passes the effect function's parameters to that stage, `|> ((effect, path) => …)(%, path)`, and keeps those comments in place. A stage that names an argument otherwise, `(effect, _path)`, keeps `EK1002`, because `Effect.fn`'s declaration takes the stage's name. A stage that reads an outer name that a generator parameter would hide, which the rewrite used to rebind silently, now keeps `EK1002` too.
- A line break after `try` caused parse errors for expression operands; member calls and other operands now compose across whitespace and comments.
- The migrate flow accepted a local object named `Effect` as a cold constructor and missed work in `Effect.gen` arguments. Its run-phase check now verifies import bindings, reports unknown constructors for review and blocks work that would move from the call to the Effect run.

- Forms-decision snapshot changes unnecessarily rebuilt the native compiler, mapper and forms generator. Their build keys now ignore those runtime inputs while checks still track them.

- Changes to fuzz-test helpers unnecessarily rebuilt the native compiler, mapper and forms generator; their cache keys now keep production inputs separate while Go tests still track the changed helpers.

- Identical recursive generic declaration APIs could fail with `TS2589`; exact resolved type identity now proves those comparisons.
- API checks treated identical JSDoc links as different when a private target resolved in only one snapshot. Link targets and labels now compare consistently while real comment changes remain differences.

- Editor consistency checks could report that renaming a TypeScript module block added or removed errors because its virtual filename changed. The checks now compare diagnostics under the original `.vibe` document, retaining every diagnostic (VIP-40).

- Conformance checks kept stored-generator migrations marked unfinished after one `vibelang --fix` run already converged. They now reject stale idempotence markers and exercise the fixed migrations without them.

- Acceptance cases could pass when `stdout` matched after their runner failed. A runner must now exit with status `0`, and failures retain its output and exit status.

- Spec changes with explicit pending tests were rejected as having no rule evidence. The checker now accepts a changed `test.todo` for its exact rule and reports pending obligations separately from executable coverage.

- A pre-VIP-1 `fork(program, options)` left inside an already marked `effect` function made `--fix-vip-only` refuse the file with `EK1703`. It now writes `try Effect.forkChild(program, options)`, as it already did when adding the `effect` mark itself.
- A source-child helper inserted by migration failed with `EK4402` after its file became VibeLang. The codemod now keeps the helper in a private TypeScript module body, preserving loader arguments and declarations without adding public exports.

- Optional schema fields and tuple elements accepted explicit `undefined` even with `exactOptionalPropertyTypes` enabled. They now use `Schema.optionalKey` under that setting; an explicit `| undefined` keeps the previous acceptance.

- Incomplete matches on finite generic constraints could compile silently; they now report `EK4701`. `vibelang --fix` can preserve the previous no-match `TypeError` with an explicit default arm.
- API identity checks rejected two identical copies of a generic function using an `import()` type with literal type arguments. Copies now compare identically, while changed literal arguments and dependencies remain differences.

- Publication checks for source-child packages could not install an already-published Effect dependency while simulating an unreleased VibeLang SDK. Their registry fixture now serves the pinned Effect release while continuing to withhold the SDK.


- Specification checks for generic data helpers failed after the public wording dropped an internal decision reference. They now cite the current public rule; the existing collision-suffix compiler gaps remain tracked across all four generic arities.

- Declaration fuzz checks still rejected harmless spacing, member order and import spelling changes in migration output. They now compare complete declaration trees by exported names, types and comments.
- Migration verification rejected unchanged published APIs because their declaration text or private file layout differed. It now uses the shared API checker for published packages, stock compiler proofs and earlier sidecars, preserving publication names and reporting unavailable probes separately.

- JavaScript launch scripts could fail strict `checkJs` after setup inserted a source-child helper. Generated JavaScript now keeps the helper’s parameter and tuple types, preserves native declarations, and retains readable spacing.

- A denied trailing block reported `TS1005` beside `EK1101` at the same brace; the compiler now omits that duplicate separator error while retaining independent syntax errors and preserving quick fixes.
- After the migrate flow set VibeLang up, a test that plain `node --test` ran failed with `ERR_UNKNOWN_FILE_EXTENSION ".vibe"` once it reached a migrated module, as in Smithers' `NodeTest` targets. Setup now preloads `vibelang/register` in each `node --test` package script and in each literal Smithers `Runtime.Node({ ... })` of a package that reaches migrated sources.

- Release validation rejected the VIP-7 reference tests because they had no runner; `//:release` now checks parallel installation and cleanup after a failed install.

- The migration namespace corpus quoted a declaration-import-style guarantee removed from the specification, so its citation check failed. It now cites the current module-identity wording.


- ESLint corpus checks could miss lost function names or parameters named with contextual words such as `match`; those bindings now require their written identifier nodes, including after the final parameter is removed.
- The migrate flow stopped before `--fix` when program discovery reported a repairable `EK0301` union-slot error. It now discovers the full file scope, repairs the spelling and lets subsequent checks report type errors that parsing had hidden.
- Migration could leave a path held as data naming a renamed module, which failed only when the program ran it; batched codemods now rewrite more static forms, and `verify` refuses the rest by module, file and line.
- Migration could miss a module a build selected by `.ts` and silently left out of `dist`; `verify` now builds from clean output before and after each batch and refuses each file the build no longer writes.
- Migration could pass a package that did not install or load outside its workspace, such as a `file:` dependency in the pack or `export * from "./x.vibe"` under Bun; `verify` now installs each batch's packs in an empty directory, imports every export under Node and Bun, and refuses each regression by package, specifier and runtime.

- With `jsx: preserve`, `.vibex` inputs emitted preserved JSX in `.js` files. They now emit `.jsx` files and `.jsx.map` source maps, including files with no JSX elements, as `.tsx` does.
- Release notes repeated the upgrade and bug-fix sections, hiding later fixes from readers and documentation tools. Each section now appears once, with the unique fixes and upgrade repairs retained.

- The source mapper crashed with a stack overflow on a regex pattern with an extractor, such as `s is /(\d+)/(let m)`, in a file it projected. It now projects that file.
- `vibelang --fix` rewrote `return value` in a plain `function*` into `{ value; return }`, so a JavaScript caller that read the generator's return got `undefined` and the output reported no error. The EK2128 quick fix now applies only to a function marked `effect`; on a plain generator it leaves the file unchanged. A site `--fix` refuses now keeps its file byte-identical: if any rewrite in the run changed a refused site, that file keeps its original text, and each refused site is reported with its span and reason.

- `vibelang --fix` stopped with exit 3 ("a rewrite changed a refused site") and kept a file's old text when a later rewrite, such as shortening `Option.Option` to `Option`, touched a diagnostic it had declined. It recorded declined diagnostics from the program before the run, so a site a rewrite had repaired or moved read as changed, and its module-export rewrite never checked refused sites. --fix now records declined diagnostics from the final program and drops a rewrite edit that would touch a refused or declined site, reporting the edit as a refused site; the file's other fixes still apply and the run finishes. Exit 3 remains only for a site that changes despite these checks.

- The migrate flow's setup and codemod missed a Vite config named like `vite.config.playground.ts`: it got no `vibelang()` plugin, and a `serverEntry` it named kept the old `.ts` path, so that build failed once the entry was migrated. Both now treat `vite.config.<name>.ts` like `vite.<name>.config.ts`.
- When the migrate flow sent a module back to TypeScript, a consumer converted in the same batch named it with an added extension: t3code Mobile's `./runtime` became `./runtime.ts` in 53 files, which changed the declarations that print those names. Revert now restores the specifier the repository wrote in every consumer.
- The migrate flow sent a module back to TypeScript when a private helper threw, such as t3code's `knownTags` in `packages/contracts/src/baseSchemas.ts`, which checks a schema invariant at load; that kept it and `orchestrationV2.ts` in TypeScript. The codemod now moves each top-level declaration that throws in plain code into a VIP-40 `module throwing { }` body in the `.vibe` file and migrates the rest; the module's declarations are unchanged.
- A Node builtin imported as a value but read only as a type, such as `import { AsyncLocalStorage } from "node:async_hooks"` used in a parameter type, had no quick fix for `EK4402`. `vibelang --fix` now writes `import type`. Any value read or re-export keeps the import and its error.
- `Buffer.byteLength(text)` in a `.vibe` file had no quick fix, so migrating a module that only counted a string's bytes sent it back to TypeScript. `vibelang --fix` now writes `new TextEncoder().encode(text).length`, which returns the same number. A call with another encoding, or a value that is not always a string, keeps `EK4402`, and its note says why.
- A local binding named `fork` or `join` in effect code compiled with no error, and its calls silently became the fiber operation: `const fork = try FiberSet.makeRuntime(); fork(job)` waited for the fiber's cleanup instead of running the callback. Effect code that binds either name now reports `EK1702` (VIP-17), which it did not before, and `vibelang --fix` renames the binding and its calls. The fix also renames a `fork` or `join` that an `Effect.gen` or `Effect.fn` it rewrites reaches. An exported binding keeps its name through `export { fork2 as fork }`, an imported one through `import { join as join2 }`, and an object key stays `{ join: join2 }`.
- Under the `vibelang/bun` preload, a `module` body importing a package, an `imports` map entry or an extensionless relative `.ts` file, such as `import { theme } from "../theme"`, failed with `Cannot find module` from a `vibelang-module:` path. It now resolves as it does in a `.ts` file beside the `.vibe` file.
- The migrate flow's batch commits listed files on lines up to about 200 characters and named every file in the subject, so a repository with a commit-message wrap gate, such as Foldkit's 80-column check, failed on every batch. The flow now wraps commit bodies at 72 columns and shortens a long subject to `…, and N more`; the body still lists every file.
- The migrate flow left a Vitest `coverage.include` such as `src/**/*.ts` as it was, so each migrated `.vibe` module silently left the coverage report and its `.d.vibe.ts` sidecar joined it at 0 of 0 lines, while thresholds still passed. Setup now widens those globs to `{ts,vibe}` and excludes `**/*.d.vibe.ts`.
- The migrate flow's rules taught only `import { Array as Arr }` for `EK4842`, which a repository's lint can reject, as Foldkit's `prefer-effect-module-names` does. They now also teach `Effect.Array.map(xs, f)` with no import of `Array` or `Effect`.
- `vibelang --fix` over a package rewrote every module of it, and on a large package could run past 30 minutes with most fixes unapplied, so a migration of a few modules could change others or never finish. `vibelang --fix --only <files>` now repairs only the listed modules and checks only them, as a partial repair: the compilation after it still reports the whole project.
- Compiler test cases added after the Effect `4.1.1` pin still pinned `4.1.0`, and `interruption-restore-regions` read a service with the retired call form, `try Svc()`, so the repository's own checks failed. Every case now pins the runtime's Effect version and reads the service as `try Svc` (VIP-9).
- A file added to a project whose `include` writes a leading dot, such as `.source-collector-*.vibe`, was invisible to the compile cache, so the Node loader reported that the project excludes it until something else changed. The cache now sees it, and still ignores dotted files a pattern does not name.
- `vibelang --estree` wrote `try` before a tagged template, such as ``try sql`VACUUM INTO ${target}` ``, as the bare template, so ESLint's `no-unused-expressions` reported the statement. It is now the `$try(...)` call `try` writes before any other operand that is not a call.
- The migrate flow's `.vibelang/eslint.config.mjs` ran `getter-return` and `no-dupe-class-members` on `.vibe` files, which Oxlint skips on `.ts` files because TypeScript's checker reports them, so a getter whose `switch` covers every case got a warning its `.ts` original never had. The `.vibe` config now skips the same two.
- `vibelang --estree` declared the temporary a `do` expression assigns as `const`, so ESLint's `no-const-assign` reported `'$do1' is constant` at `do` expressions in `.vibe` files. It is now `let`. An author's pattern binding stays `const`.
- The migrate flow's style gate rejected `EK4804` on a private function whose original only inferred its global `Error` channel, so `packages/node` in Foldkit could not migrate without new annotations. It now accepts the advisory when the original function failed with a `new Error` with the same message; any other global `Error` stays rejected.

- The migrate flow could record a conversion in which a plain function lost an Effect wrapper, such as `Effect.succeed(xs)` becoming `xs` behind an `as` cast or `Effect.fail(e)` becoming `throw e` (Smithers' `Plugins` and `Refusals`), while types, declarations and the tests a batch reran could all pass; `verify` now compares each function of the original with the emitted JavaScript and fails the batch unless the run's `lost-wrappers-allow.json` names that function with a reason.


- Composite-project migration checks still expected JSX files to become `.vibe`. They now check the required `.vibex` mapping, `.mts` sources, and both include and exclude patterns while retaining declaration globs.


- Upgrade commits could split the VIP migration notice across the preceding paragraph when the body was wrapped. The notice now has its own paragraph while retaining the command, migrated-file count and body-width limit.


- API comparison could incorrectly prove different exports identical when a project disabled type checking; semantic checking now remains enabled for the comparison and invalid inputs still fail closed.

- Valid declarations could fail API comparison when the project checked unused code, because generated identity helpers were reported as unused; those checks now apply to the original inputs while synthetic probes remain exempt.

- Converting a retired `catch (cause: Cause)` could widen a public literal result such as `1 | 2` to `number`. The CLI and editor now leave that case unchanged unless an explicit return contract keeps its type.

- The `EK1202` provider-separator fix could flatten line breaks inside a comment. It now leaves that site unchanged and still joins whitespace around comments that fit on one line.

- Find references on a `module` declaration's name returned only the declaration, and nothing from a specifier such as `from text`, while rename edited every specifier; renaming an imported type of the same name left `from M` naming the old module (`EK4006`). Find references now returns the declaration and each identifier specifier, and rename edits those specifiers in both cases.

- Compiler regression tests could miss quick fixes that changed values read by JavaScript callers. The checks now observe Promise results, generator completion values, thrown values, public types, comments, and refused source spans.

- The editor's `EK4802` repair could run an Effect that the function returned as data, changing its result, type and side effects. It now leaves that return unchanged and explains the manual choices.

- The editor could replace `Layer.mergeAll` with `wire`, switching a dependency from the caller's layer to a sibling layer. It now leaves the composition unchanged and explains that the provider must be chosen explicitly.

- Private `trusted(impl, [])` wrappers had no migration away from the legacy trust form. `vibelang --fix` now rewrites safe direct calls through `Effect.try` and `Effect.orDie`, preserving the exact defect value and public declaration API; function values that escape remain for review.
- Removing an Effect type assertion in the editor could widen a public failure or requirement channel. The action now refuses instead of changing the exported contract.

- A `do` expression whose paths all leave outward could be typed as `any` or `undefined` and fail a `never` annotation; it now has type `never`. For calls or property uses that relied on the old `any`, `vibelang --fix` adds an erased assertion that preserves the outward jump.

- Existing optional schema decoders in projects with `exactOptionalPropertyTypes` had no compatibility upgrade. `vibelang --fix --fix-migration-only` now adds explicit `undefined` unions to keep their previous decoding behavior.

- Migration loader-record receipts looked validated when the installed project module or checker was unavailable. They now distinguish completed, unavailable and failed validation while retaining the original write details.

- Existing optional schema decoders in projects with `exactOptionalPropertyTypes` had no compatibility upgrade. `vibelang --fix --fix-migration-only` now adds explicit `undefined` unions to keep their previous decoding behavior.

- The migration checks generated callback failure unions without their required parentheses and failed to parse them. They now write valid compound slots while checking the same preserved channels and refusal controls.


- Schema conformance checks rejected the dangling aliases that TypeScript itself emits with `stripInternal`; these cases now verify exact native output and the same TypeScript diagnostics.
- `vibelang --fix` refused an `Effect.fn` whose parameter annotation was a type name's last read under `noUnusedLocals`, because writing the checked parameter type left the name unused (TS6133, TS6196), so the module stayed on `EK1002`; the fix now also removes that type-only import binding or module-local type alias.

- Generated child-process launchers added runtime type checks, redundant assertions and dense spacing that failed existing lint rules. Setup now uses the toolchain’s `Schema.String` boundary, keeps native argument behavior and safely refreshes owned helpers.

- Published declaration checks rejected even an unchanged namespace re-export when a generic type alias had the same name. They now resolve the namespace members through their module and still report changed names, types and comments.

- Setup needed a second run to finish refreshing a source-child loader helper when one call launched a typed source and another only probed a shell. It now removes the unnecessary wrapper and refreshes the retained helper in one pass.

- CI-health reports mistook missing Node packages for test assertions; reports now identify package-install failures and point to the requesting module's installation and module root.

- The pattern-matching reference example dropped callable objects with an `id` property; its TypeScript counterpart now includes them.

- Migration setup enabled `rewriteRelativeImportExtensions` when it was absent or inherited `false`; setup now preserves the project's native option and its inheritance.

- `vibelang --fix` refused `EK4401` on a plain TypeScript call that reads a property a guard narrowed, such as `o.p ? f(o.p) : 0` or `if (!o.p) return 0; return f(o.p)`, because `Effect.try`'s function no longer knew what the guard proved (`TS2345`). The guard now joins the call in that function, or a `const` under the guard keeps the read; a call that runs before the read still blocks the move.

- Release validation rejected the stock-reference control suite because it had no test runner; `//:release` now runs checks for `Exit` values, public types, and version pins.

- An `effect` function passed where a call infers its success, as in `Effect.suspend(effect () => sql`...`)`, succeeded with an Effect subtype it returned (a `sql` statement, an `Exit`, a `Config`) and never ran it, with no diagnostic, though the same code with `Effect.Effect` drew `EK4802`. It now draws `EK4802`, and `--fix-vip-only` writes the `try` that keeps it running as it did before VIP-1. A plain function that returns such a subtype where an Effect is expected, as `Effect.suspend(() => make())`, already ran it, and `--fix-vip-only` now leaves it as written instead of marking it `effect`.
- The migrate flow's codemod rewrote a test's extensionless import, `../src/x`, to `../src/x.vibe`, an edit the test verifier refuses, so Smithers' `apps/mvp` lost 120 test files and `ui` a module. A test now keeps its extensionless import as written; a `.ts` or `.js` specifier of a renamed module still changes, and so does a Bun `mock.module`, which does not reach `x.vibe` without it.
- The `is` guide implied that every skipped pattern binding reports `TS2454`. It now documents TypeScript's exemptions for `any`, `unknown`, `void` and types containing `undefined`; conformance cases check both exempt and checked types.

- Release notes exposed an internal decision identifier while explaining curried service provision; the explanation now uses only the public API names.

- The migrate flow's Alchemy namespace check failed after the source-sidecar specification was reworded. Its corpus now quotes the current contract and identifies a stale quote when one changes.


- Declaration comparison could reject a package compared with itself when a wildcard export combined built declarations with an unselected source condition. It now checks the concrete published names without inventing a literal `./*` module.

- Editor regressions around `Schema.optionalKey` references now have named migration cases across aliases and `schema error` fields.

- A method called through a TypeScript assertion, `satisfies`, or `!` lost its receiver when an argument contained `do`; these calls now keep JavaScript receiver and evaluation order, and preserve the asserted function type.

- Contributor release checks could omit fixture tests or fail cancellation checks on a host running one Go test slice; launcher fixtures now run their complete intended suite independently of the host slice.

- Compiler conformance and editor formatting checks could fail on a fresh checkout because the dprint plugin was missing; their build targets now prepare the compiler package before running.

- Comparing declarations that re-exported generic global types could report missing standard library types; API checks now preserve the global library while checking those aliases.

- Custom compiler-case runners could fail before invoking the compiler; they now receive the same compiler executable that checked the case.

- The specification checks failed after an approved module-resolution table edit left the generated reference stale. The reference now follows VIP-39 exactly, with a regression check against a fresh generation.

- A declaration comparison could lose an earlier blocking diagnostic while checking later entries and report a crash instead; it now retains that diagnostic and stops the unavailable comparison.

- Editor rename checks falsely reported a failure when TypeScript repaired duplicate declarations; checks now accept those repairs while still catching added collisions and unrelated diagnostic changes.

- Renaming a symbol in a file with an unfinished `module { ... }` declaration could crash the editor. Rename now skips the missing module name and still updates other bindings.
| A plain `error` method or getter with a computed key known to be `"_tag"`, including a branded singleton, template or string mapping | `EK2117` reserves the name. Run `vibelang --fix` to keep a compatible member in an explicit Effect TypeScript class; rename an instance member whose native override is invalid. |
| A typed `_tag` payload field in an `error` or `schema error` | `EK2117` reserves the generated tag name, including when the written type accepts it. Rename the field, or use `vibelang --fix` to retain a compatible contract in an explicit class. Fieldless plain bases with generated subclasses need a manual class migration. |
| An initialized `_tag` field, accessor or static member in an `error` or `schema error` | `EK2117` reserves the name; `--fix` retains previously valid members in explicit Effect classes. |

- Tests that started `bun test` from a fixture directory could not load migrated modules after setup. Setup now writes the native loader preload in that fixture's own `bunfig.toml`, leaving test code and other options unchanged.
- ESLint corpus checks reported missing names for valid `is` patterns in loop conditions and updates; checks now distinguish written declarations from generated temporaries.

- `vibelang --fix-vip-only` wrote no `try` for a call passed to a generic parameter with another parameter beside it, such as `expect(awaited(p))` with `expect<T>(actual: T, message?: string)`: the file compiled, and the test received the program instead of its value. It now writes `expect(try awaited(p))`, as the old compiler ran it. A sibling argument that independently fixes the same type parameter to an Effect still keeps the programs held.

- The module specification exempted unannotated foreign calls from the plain-code throw check, and prelude examples relied on that exemption. They now follow VIP-4: unknown throws require a bridge or a native caught call.
- An effect method that suspended before calling `super.method()` could invoke the method's own `call` property, and a `super.tag` template could read its own `bind` property. Both now invoke the inherited method with the source receiver, preserving optional calls and evaluation order (VIP-1).

- Call hierarchy showed a base-constructor call at a derived `error` declaration's name. It now shows written call sites and omits compiler-generated constructor calls.

- The sidecar documentation always based source paths on the config directory, which gave wrong paths when TypeScript inferred another source root. It now follows the declaration layout, with an explicit root in the config-relative example.

- A TypeScript consumer could accept a wrong argument or result type from a function re-exported through a `module` body because its type became `any`. The body declaration beside the source now preserves the function signature; regression checks cover exported arrow functions too.
- The Alchemy union-and-`pipe` inference check incorrectly demanded a `TS2345` error from TypeScript 7.1; it now uses the migration’s TypeScript 5.9.3 baseline and verifies that the provider retains requirement `B`.

- A schema struct repair could delete a custom associated type whose helper was also spelled `Schema.Schema.Type`. The repair now resolves the helper and preserves unrelated aliases and interfaces.
- Loading a `.vibe` module through `vibelang/register`, `vibelang/bun` or a bundler plugin failed with `TS6305: Output file '…/lib/x.d.ts' has not been built from source file '…/src/x.ts'` when its tsconfig `references` a project that was not built yet, as in a fresh clone before `vibelang -b`; the loader's compile now reads a referenced project's types from its sources, as the editor does, and a relative import into that project no longer reports `TS2878`.
- Interruption blocks in plain or `async` code were accepted, or `restore` reported a nesting error. All three forms now report `EK2201` outside effect code. `vibelang --fix` removes the ignored keyword and keeps the ordinary JavaScript block.

- Checking a large declaration dependency graph could exhaust memory before comparing exports; input diagnostics now use fresh checker groups and retain the complete dependency diagnostics.

- A declaration comparison could retain the input checker's generic instantiations while allocating another checker for its probes; preparation now releases that state before probe checking begins.

- Comparing many independent declaration entry points could exhaust the heap even with small type probes; published entry points now use fresh, bounded groups while preserving the complete comparison verdict.

- Repository API regression checks failed after JSON support landed because they still expected explicitly published `package.json` exports to be ignored; those exports are now included in the expected surface.

- `try` in an enum member initializer inside an `effect` function compiled to JavaScript that does not parse; it now reports `EK0501`, as a class field initializer does.
- In a `.vibe` file, `x.pipe(Effect.provide(layer))` failed with `TS2345` (`… is not assignable to parameter of type '(_: Effect<…>) => never'`) where the same `.ts` compiled: the type VibeLang gives a curried `Effect.provide(…)` lost its symbol, so `pipe` could not infer its result. Calling it directly, `Effect.provide(layer)(x)`, was not affected.
- The migrate flow left a module under a test directory out of a package's emitted JavaScript even when the package exports it, such as `"./test/TestDatabase": "./src/test/TestDatabase.ts"`, so plain Node importing it from another package failed with `ERR_UNKNOWN_FILE_EXTENSION` on its `.vibe` imports. The flow now emits and routes an exported test-directory module and what it imports relatively; `.test` and `.spec` files stay out.
- A nested Vitest project with its own `plugins` could miss the VibeLang loader even after setup wired the outer configuration. Setup now adds the loader to each inline project whose tests or setup files reach migrated sources, preserving the other project options.

- `EK4814` said decoding does not call a constructor that overrides a Schema class's, and its note said decoding builds instances without calling it. On Effect 4.1.1 decoding does call it, once per value. The message and note now say so.
- Service-call regression tests now cover catch heads, parentheses, computed members, and aliases, checking that retired static shortcuts are rejected while explicit service reads compile.

- Plain factory regressions could escape differential checks; generated cases now cover direct and curried Effect class construction, inheritance and call-time evaluation.

- Regression coverage now checks retained lint comment scopes, inert string/template lookalikes and equivalent severity settings; unresolved diagnostic gaps remain explicitly tracked.

- Published API checks merged ambient declarations across snapshots or rejected them as non-modules; ambient module exports and global contributions now compare in separate environments.

- The `EK1202` provider-separator fix could flatten line breaks inside a comment. It now leaves that site unchanged and still joins whitespace around comments that fit on one line.

- Nested `do` expressions hid forbidden loop-head jumps and reported parameter `var` declarations as `EK0204`; they now report `EK0205` and `EK0203` exactly once across nested blocks.

- ESLint and Knip passed on a `.vibe` module without reading it in a repository that runs ESLint itself or installs Knip package by package. Setup now gives such a repository's TypeScript lint blocks and `eslint` script globs to `.vibe` files, and writes `knip.config.ts` with the `vibelang/knip` compiler in each package.
- Formatting JSX in a `.vibex` file failed or skipped the file. The native formatter, `vibelang-format`, `vibelang/prettier` and the dprint plugin now select TSX mode and preserve JSX text, entities, comments and `<T,>` generic arrows (VIP-39).

- A `schema error` class pattern rejected errors with the same `_tag` from another package copy; bare and extracting patterns now match that tag and keep the original subject. Class upgrades made by `vibelang --fix` retain the same matching.

- A local type alias or interface named `KeyFormat` or `Transferable` hid Effect's namespace in expressions such as `KeyFormat.jwk`; the type and value meanings now resolve independently, including in nested scopes.
- Repairing a custom alias named `Effect` could change its success, error or required service types. The `EK4833` CLI and editor repairs now keep aliases whose written arguments do not match the underlying Effect slots.
- Host globals inside `Effect.try`, `tryPromise`, `sync` and `callback` bodies could bypass platform checks. They now report `EK4402` throughout the file; `vibelang --fix` extracts self-contained wrappers into a checked TypeScript adapter.

- Acceptance cases could pass when `stdout` matched after their runner failed. A runner must now exit with status `0`, and failures retain its output and exit status.
- Migrating an unrelated module could change an inferred native import type from `import("./view").View` to `import("./view.ts").View`. Native import types now retain TypeScript's ending preferences.

- Regression checks did not distinguish a plain `match` throw arm from an Effect failure or an `async match` rejection. Dedicated cases and fuzz coverage now exercise those boundaries, with compiler gaps marked pending.

- `try.allSettled` accepted heterogeneous named arrays and tuples and kept fixed lengths for named or spread tuples. Named operands now use the native `.map(Effect.exit)` callback check and array result; explicit literal elements keep their tuple positions, and `--fix` preserves earlier contracts (VIP-18).

- Old configuration reads in `catch` expressions still failed with `TS2349` after `vibelang --fix --fix-vip-only`; migration now removes the retired value call and preserves the catch boundary.

- `catch` could mix with `??`, `||` or `&&` without parentheses and accept a call or member access after a function handler. These forms now report `EK0512`; `vibelang --fix` preserves the earlier grouping and fallback evaluation.

- Logical assignments with a `do` right operand reread global accessors and could return a setter's transformed value. They now read once and return the original value when skipped or the right operand's value when assigned.

- Native home-directory lookups could fail with `HOME` unset when replaced by the environment-based `UserDirectories.home`. `Experimental.Process.homeDirectory` now preserves `os.homedir()` account fallback through the Node and Bun layers.


- Source-child loader wiring introduced a `fileURLToPath` import alias and failed repositories’ native import policies. Setup now uses a namespace import and refreshes its own previously generated helpers while preserving manually observed bindings.

- Rerunning migration setup left older publication helpers unable to pack nested import conditions, so package builds crashed with `value.replace is not a function`. Setup now upgrades those helpers while preserving their existing export paths.

- Node could load a native TypeScript wildcard export from a source folder and fail on its relative `.js` imports after a mixed package migrated. Routing now selects the compiled native component for those entries, preserving source type resolution and unrelated native exports.

- Packages migrated with a staged toolchain could pack runtime or source-child loader dependencies pointing into the migration checkout; setup now uses the artifacts' release versions in production dependencies and preserves staged builds for local development.
- ESLint corpus checks could overlook missing variable nodes when a name was also a contextual word, such as `match`; ordinary variable declarations now require their written identifier nodes.
- CI-health reports mistook missing compiled Go cache archives for undeclared source inputs; reports now identify cache-archive failures and recommend inspecting the cache.

- Stock TypeScript's experimental mapper treated `.vibex` as non-JSX TypeScript and broke JSX syntax; it now projects these files as TSX, preserves JSX source ranges, and includes JSX options in its cache key.

- The mapper's parity and end-to-end checks stopped at a missing `emit-main.go` after automatic tracing was retired; they now use the production mapper and verify Go overlay inputs before building.

- An `await using` declaration in an `effect` function, producer or block reported the legacy `EK1003` diagnostic; it now reports the assigned placement error `EK0102` at `await`. Nested `async` functions retain native asynchronous disposal.

- Declaration-oracle tests still rejected harmless published member reorderings and accepted changed export comments. They now check the same exported names, strict types and normalized documentation in compiler probes and published packages; the Foldkit counterpart keeps matching comments, with its original differing constructor comment retained as a rejection control.

- Unknown foreign calls in effect code reported the legacy `EK4401` trust error; they now report `EK0403`, with the existing preserving `--fix` rewrite still available.

- A `.vibex` source and its package or mapped sidecar import could be treated as different modules, rejecting identical private class types; both now select the available source, and `.vibex` sidecars keep the correct extension in either layout.
- Producer methods marked `effect` could be checked or emitted as JavaScript generators; they now return lazy, repeatable streams and preserve `this`, `super` and member modifiers.

- Defaults in `effect` functions ran again on every execution and parameter writes were reset. Parameters now bind once at the call, and repeated runs share their bindings; binding exceptions become defects in the returned Effect (VIP-1).

- An `effect` arrow or named function expression that compared its own callable value incorrectly reported a circular-inference error; value-only self references now infer the same return type as their `Effect.gen` equivalents.
- Pipe grammar no longer rejects a pipe after a closed catch arrow body; it applies to the recovered value.


- An `await` in a TypeScript `namespace` was accepted and emitted invalid JavaScript; namespace bodies now report native `TS1308`, while explicit `async` functions keep their own await permission.
- Migrated packages could publish declaration sidecars and expose them through source export globs. Migration setup now excludes `*.d.vibe.ts` and `*.d.vibex.ts` from packs, and verification rejects sidecars or unexpected changes to the published file list.


- A local declaration named `SchemaAST` could capture the `ParseOptions` qualifier in an inferred decoder declaration, leaving an invalid public type. Inferred library types now keep their library module, as TypeScript does.

- Declaration checks could compare an unused `types` export instead of an earlier matching package condition, hiding a real API change. Published entry discovery now follows TypeScript's conditional export order and preserves mirrored `.vibe` sidecar resolution.

- Declaration checks could miss a type change selected by an explicit `resolution-mode` import attribute. They now resolve each import using its own mode throughout the comparison.

- Declaration comparison treated every package `exports` fallback as a published entry point, producing errors for missing or unreachable alternatives. It now follows TypeScript's ordered fallback resolution and compares only selected declarations.

- Changing ambient overload import order could change an exported type while declaration comparison still passed. A changed ambient load order now makes the comparison unavailable, preserving the isolated types instead of merging away the difference.

- Wildcard package exports could make declaration checks compare private files blocked by `null` exclusions, or override an exact subpath with a broad pattern. Discovery now follows the most-specific `exports` key, so only published entry points count.


- Declaration API comparisons could overflow the stack on deeply nested exported objects and accumulate type relations across one large probe; they now walk iteratively and check bounded batches with progress and memory records.

- Comparing valid generic exports annotated with `in` or `out` could fail with `TS1274`, even for a package compared with itself. The generated probe now uses legal function type parameters while checking the original exported types.

- Published-declaration checks could accept a changed global type or doc comment because the two declaration trees merged their ambient declarations. They now prove ambient dependency closures and comments in isolation, and report an unavailable comparison when that proof fails.

- Migration setup moved existing declarations out of source folders but left package `types` pointing at deleted files, so TypeScript consumers could not resolve the package. Setup now refreshes owned declaration targets to the configured sidecar layout.
- Bun build scripts using `Bun.Glob("**/*.ts")` silently omitted migrated modules and could emit declaration sidecars as JavaScript entries. Migration setup now includes `.vibe` and `.vibex` sources and filters their declaration sidecars, including when refreshing an already wired build script.

- `vibelang --fix` could refuse a fix early in a run and not try it again after later fixes made it safe, so a second run changed the project; one run now retries refused fixes until none applies.
- The documentation checks reported new spec quote tests as missing even when the build gate selected them by name. They now check the gate’s actual test selector and package scope.

- `vibelang --fix-vip-only` refused a whole file when an argument passed by name was itself an effect block, such as `try (effect { return id(load(1)) } |> Effect.orDie(%))`, and reported the retired `try(…)` form (`EK4616`); it now writes `try` inside the block and leaves the block as it stands.
- A TypeScript `module` body had no editor action for moving it to a separate file; **Move module to a .ts file** now creates a sibling file and rewrites its imports and re-exports while preserving the program, without running from `--fix` (VIP-40).

- A TypeScript consumer of a `.vibe` sidecar that re-exported a `module` body's members could not resolve their declaration; body declarations now accompany the source, including with `--noEmit`, so stock `tsc` reads their types and `@throws` JSDoc (VIP-40).

- Setup stopped with `spawn E2BIG` when a large repository’s formatter file list exceeded Linux’s single-argument limit. Setup and record now split both formatter commands into bounded chunks, keep each command’s log and report failure if any chunk fails.

- Upgrade regression tests now track legacy service-call access across service, class, reference, and namespace tags; missing automatic repairs remain recorded explicitly.

- Editor regression tests now exercise qualified Option handlers around anonymous payload-size boundaries and verify that every input reaches its actual quick fix.

- `npm create vibelang` failed on Node 22, whose npm 10 crashes installing the pinned Vitest (`Cannot read properties of null (reading 'edgesOut')`), as do the install pages' `npm install` commands. The starter and those pages now pin Vitest 5.1.0, which npm 10 installs.
- The specification checks could overlook an obsolete setting in a folded detail. They now check every other detail and verify that the `trustedPackages` retirement note still requires removal, ignored values and a deprecation warning.
- Go test sharding could execute tests during discovery and again afterward when an argument stopped flag parsing; positional arguments, `-` and `--` now run the original binary once, preserving its arguments and exit status.
- ESLint corpus checks treated deliberately written dollar-prefixed names such as `$assertMatch` as compiler-generated bindings; they now check the reported source identifier and still reject synthesized or unwritten names.

- The migrate flow rejected a test’s allowed module-path rename in `vi.mock` when `vi` came from `vite-plus/test`, blocking desktop migrations. The codemod and verifier now share mock-loader recognition; local, shadowed and unproven bindings and edits to mock payloads remain rejected.

- Form warnings missed direct `try` operands wrapped in parentheses or erased TypeScript expressions and warned about Effects stored or consumed elsewhere. `EK4834`, `EK4835` and the provider forms of `EK4836` now follow only the direct bare-`try` operand, recognize import aliases, and explain when a safe quick fix is unavailable.

- A trailing block separated from its call by JavaScript whitespace such as a nonbreaking space had no automatic repair; `vibelang --fix` now writes the callback argument for every single-line whitespace spelling.

- `Symbol.customMatcher` in a `.vibe` file reported `TS2339`, though chapter 4 and these docs write it; it now names the runtime's key without an import, unless the file declares its own `Symbol`.
- A class that inherited a static `Symbol.customMatcher` from a superclass matched through it; a class now uses only its own matcher, and `class B extends A {}` tests `instanceof`. Error families keep their generated tag matcher.
- An `Option.match` repair could write an unqualified payload type or a shortened record type and then be refused; generated callback annotations now keep qualified names and complete types.

- Plain JavaScript runners such as `Effect.runSyncExit(program)` incorrectly reported `EK4301` when their returned `Exit` was discarded; plain functions, callbacks and module statements now keep TypeScript's call behavior.

- Specification checks treated retired `declarationImportStyle` notices as live settings and rejected the TypeScript declaration-spelling rule. They now accept retirement and reject stale live-style claims, with coverage for both historical configuration paths.

- The specification attributed the `using` warning `EK0801` to a denied proposal; it now cites accepted tooling requirements, with a regression check that preserves its warning severity and repair.

- Renaming a parameter in a predicate arrow could lose its declaration from Find References and leave names unchanged; references and rename now retain both the declaration and its uses at every name length.

- `Convert to a pipe` could turn a statement with an object argument into invalid syntax; object and class inputs now keep their expression context at the pipe head.

- Effect operand checks could reject `never` or `any` and accept types that only resembled an Effect. `try`, `catch`, `fork` and the elements of `try.all`, `try.race`, `try.any` and `try.allSettled` now use TypeScript assignability to `Effect.Effect<any, any, any>`; `unknown` needs narrowing first. `vibelang --fix` preserves previously accepted unchecked `try` calls and computed `catch` heads, making their behavior explicit.

- Completion near a `service` keyword could crash when editor requests visited tokens in a different order; declaration keywords now use a consistent navigation token.

- Signature help inside an `error` declaration could crash near its fields or closing brace; generated payload types now contain their field spans, including leading comments.

- Renaming a service left its `Shape` type uses behind and added namespace errors; rename now follows those uses, including namespaces and imported aliases.

- Diagnostic tools still listed `EK2116` after its implicit-factory check was removed; that unused registration is now gone.

- The diagnostic inventory could overlook errors from stock TypeScript’s mapper; it now checks those codes against the reference along with native compiler diagnostics.

- The diagnostic guide cited a retired unused-`main` warning; it now describes that migration without presenting the old number as a current code.

- Declarations such as `effect load() {}` and `async load() {}` reported `EK4618` instead of VIP-1's `EK0101`. They now report `EK0101`, and the quick fix and `vibelang --fix` still insert `function`.
- An `effect` function annotated with bare `any` or `unknown`, or an alias or union that resolved to either, bypassed the required Effect return container check. It now reports `EK0106`; `vibelang --fix` can remove the broad annotation and infer the function's Effect contract.

- The editor repaired `await fiber` inside an `async` function with an unrun Effect and offered no repair for `await deferred`. Both quick fixes now keep `async` and wait for the completion value through `runPromise`, preserving operand evaluation and shadowed names. Unions and generic constraints keep their warning when the bridge cannot typecheck.
- `new Request(url)` in a `.vibe` file drew a note advising `globalThis.Request` inside a hatch or a module block, which the compiler then refused with `EK4402`, and `x instanceof Response` drew no note; both now say the global is platform code that lives in a `.ts` file.
- An `effect` prefix on a getter, setter, or class constructor was parsed as unrelated members or an ordinary method; it now reports `EK0104` on the prefix, while ordinary methods with those names keep working. `vibelang --fix` preserves supported parameterless constructors with a cold Effect return; parameter initialization and constructor-specific bindings require manual migration.

- Source loaders could select an unrelated `.tsx` sibling for emitted `.js`; they now follow the output’s source mapping and the project’s `jsx` mode, preserving the selected module’s identity.

- Under the Bun preload, a live `default` export stayed at its initial value and a module without one gained a `default`; emitted-source forwarding now preserves the source’s live bindings and export names.

- Setup could call a local parameter or function instead of the `tsdown` plugin when it shadowed the imported name; it now uses an unshadowed import alias and preserves every existing plugin.

- Closures created in a `for try` Stream expression could read an outer variable with the same name as the loop head; they now retain the head's uninitialized binding and throw `ReferenceError`, as in JavaScript iteration.
- Schema repairs could reinterpret a value named `string` or another type keyword as a primitive schema; ambiguous aliases and fields now keep their library form.
- `vibelang --fix` left `Result.gen` in a `.vibe` file as `EK1002` with no quick fix and no reason. It now rewrites it to a plain function called in place, which stops at the first failure as `Result.gen` does, or says why it can't.
- Bun's release-age setting blocked newly published VibeLang packages in example projects; the examples now exempt their pinned VibeLang packages from that age check.
- `--fix` rewrote `.pipe(Semaphore.withPermits(semaphore, 1))` to `Semaphore.withPermits(%, semaphore, 1)`, which passes the program as the Semaphore, and then refused the whole `Effect.gen` with TS2740; a stage whose `self` is not the piped value now stays curried, as `Semaphore.withPermits(semaphore, 1)(%)`.
- A bare object after `fork` was interpreted as a legacy callback body; it now remains an object operand and receives `EK1703` when it is not an Effect.
- Editor fixes could write invalid annotations around `this` or `super`, a loop binding or a `finally` binding; they now decline edits that cannot preserve the program.
- Hover and rename missed references in match guards, `is` subjects, `and` patterns and error `extends` clauses; the editor now finds those original source references.
- An unfinished `catch` expression could produce document-outline ranges that ended before they started; outline entries now keep valid source ranges.
- Empty setting names or empty diagnostic keys in legacy compiler configuration could be silently ignored; they now report a configuration error.
- `--fix` wrote a `JSON.parse` or `new TextDecoder().decode` in an `Effect.gen` bare in the `effect` block, which turned a defect into a typed failure and changed the module's declared error channel, or failed with TS2375 against a written one; it now keeps the exception a defect through `Effect.orDie(Effect.try(...))`.
- An unfinished module declaration could crash the parser; it now reports syntax errors.
- An unfinished variable initializer or `catch` annotation could crash diagnostics or quick fixes; syntax errors now remain reported and unsafe rewrites are declined.
- `--fix` rewrote `.pipe(observe((o) => o._tag))`, a curried generic stage, to `observe((o) => o._tag)(%)`, where its type arguments fell back to their constraints and the program's type widened, failing with TS2375; such a stage now keeps its `.pipe`.
- `vibelang --fix --fix` reported `TS5023` instead of fixing the project; repeated `--fix` flags now apply the fixes once.
- The migration instructions omitted throwing synchronous helpers; they now explain when to use an expected failure, a defect or a retained TypeScript helper.
- The migrate flow's Effect upgrade left versioned pnpm selectors and patch metadata on the old release; matching selectors, patch filenames and `package.json` version references now move together while unrelated settings stay intact.
- When migration setup broke a Bun test suite, it threw before recording what failed; setup now records an issue with both exit statuses and the before-and-after logs.
- Migration instructions recommended a retired block-parameter form for tracing; they now show a program argument passed to `withSpan`.
- A call to a missing name or missing member could add a misleading warning about calling `any`; it now reports the original TypeScript error without that warning, while genuine `any` calls still warn.
- An interruption after `using` received a resource could arrive before its cleanup was registered; cleanup registration now completes before that interruption can escape.
- The migrate flow sent a module back to TypeScript when its platform code could not move to a sibling `.ts` file: an export that was no function with written types, a schema's value and type of one name, a default export, or a package with wildcard exports. With `"platformModuleBodies": true` in the run's `config.json`, such a module moves that code into a `module platform { }` body (VIP-40) and re-exports it, so the rest of the file converts.
- The Fibers, Basic Concurrency and Cheat Sheet pages showed `try interrupt`, which `EK0502` rejects because `interrupt` is a function, and the Schema page passed `withDecodingDefaultType` a function where Effect 4.1.1 takes an Effect. The examples now write `try interrupt()` and `Schema.withDecodingDefaultType(Effect.succeed(1))`, and compile.
- The migrate flow's generated ESLint configuration read only `.oxlintrc.json`, so a repository whose `vp lint` rules live in its Vite configuration linted `.vibe` files with almost no rules, and Oxlint's categories never reached `.vibe` files in any repository. It now reads the Vite configuration's `lint` section and takes the rules Oxlint itself resolves, and each run names the Oxlint rules that do not run on `.vibe` files. t3code goes from 21 rules to 91 of its `.ts` files' 188; the rest are Oxlint's own react, unicorn and oxc rules and typescript rules, which typescript-eslint does not provide under TypeScript 7. Where typescript-eslint cannot load, `no-unused-vars` no longer reports a type signature's parameters, names in a `declare` block, or an `effect` import kept for the declaration file.
- The Fibers, Basic Concurrency and Cheat Sheet pages showed `try interrupt`, which `EK0502` rejects because `interrupt` is a function, and the Schema page passed `withDecodingDefaultType` a function where Effect 4.1.1 takes an Effect. The examples now write `try interrupt()` and `Schema.withDecodingDefaultType(Effect.succeed(1))`, and compile.
- With `effect` not installed, `vibelang --fix` read the `function*` in `Effect.gen(function* () { … })` and `Effect.fn("load")(function* … )` as a producer and rewrote `return x + 1` to `{ x + 1; return }`, losing the value. A `function*` passed to a callee that does not resolve now draws no `EK2128` and no fix until the program resolves.

- A `.vibe` file could call `getComputedStyle` with no diagnostic, though VIP-33 bans it; it is now `EK4402`, which names `computedStyle` on `Experimental.Window`, which gives the live style.

- A `.vibe` file that passed `window` to an API that takes an event target, or read `window.location`, got `EK4402` with no service to use; `Experimental.Window` now gives the page's `Window`, `EK4402` names it, and `ExperimentalBrowserServices.layer` provides it.
- Service access written as a call, `try FileSystem.FileSystem()`, `try Path()`, `try ClassTag()` or `try Reference()`, compiled before explicit effects and now reports `TS2349` or `TS2348`. `--fix-vip-only` rewrote it, but plain `--fix` and the editor did not. A new quick fix, which `vibelang --fix` applies, writes `try FileSystem.FileSystem`, `try Path.Path`, `try ClassTag` or `try Reference`. A function that returns an Effect keeps its call.
- The specification gave the `EK4856` quick fix two triggers for the qualified `Effect.Effect<A, E, R>`: VIP-3 named only an interface heritage element, chapter 7 said "where the syntax requires it". Both now say it writes `A!E!R` where that needs no new parentheses and `Effect.Effect<A, E, R>` everywhere else, including `implements` clauses, unions and arrays of Effects (decided detail 260).
- The JSX specification (VIP-39) said `x ?? throw <E/>` is not VibeLang and told you to write `x ?? do { throw <E/> }`, though throw expressions follow the TC39 proposal (decided detail 284). It now says a throw expression is allowed wherever a throw statement is, with a JSX operand as in `.tsx`, and synchronous code still reports `EK0401`.
- Native lint could ignore an exact Unicode filename in an override or `ignorePatterns`, so rules ran on files that the configuration silenced. Literal glob text now keeps its Unicode spelling; wildcards, character classes and path separators retain their behavior.
- `vibelang --fix` left a `Schema.Struct` constant alone when its own type, `type X = typeof X.Type`, carried its own JSDoc, so the comment on the type could not survive the move to a `schema` declaration; it now writes the declaration and keeps the documented type beside it, which the declaration file prints with its comment as the native pair did (VIP-15, decided detail 256). An undocumented own type is removed as before.
- A `throw` in a plain function drew `EK4804`, `EK4811` or `EK4815`, the advisories about what an Effect function's typed failure fails with, as well as its error; only an Effect function's `throw` reports them now.
- The migrate flow's Smithers flow (`run.ts`) could not run the one-pass path: its plan step took only an agent, and a second execution planned the scope again after the rename and stopped with `scope module missing`; `run.ts --scope <scope.txt>` now plans one whole-scope pass with no agent, and a later execution keeps the recorded plan.
- The migrate flow's setup wrote a `test/tsconfig.json` that extends the package's test project, so typed lint finds the tests, and then its own verify rejected that file as a forbidden test edit, so `record` refused every batch of a package whose tests sit in `test/` beside a `tsconfig.test.json` (Smithers' `@smthrs/canonical`); verify now accepts each bridge setup wrote while its bytes are unchanged.
- The migrate flow's `record` formatted a batch's `.vibe` files with `vibelang-format`, which takes only the quote style and print width from a dprint configuration, so where that configuration loads VibeLang's dprint plugin, `dprint check` failed on them over settings such as `trailingCommas` and `arrowFunction.useParentheses` (Smithers: 258 files); `record` now runs the repository's `dprint fmt` on those files.
- A `do` expression after a spread, as in `[...items, do { … }]` or `f(...items, do { … })`, compiled to JavaScript that did not parse, and an elision before one, `[, do { … }]`, crashed the compiler. A `do` after an object spread, a computed object key, an untagged template substitution, a tag or a property constructor also ran too early: the spread's getters, the key's conversion, the substitution's `toString`, the tag's getter and the constructor's getter ran after the block. Each operand before a `do` now finishes before the block runs, as in JavaScript.
- A `do` expression ending in a declaration, a loop or an `if` without an `else` reported TypeScript's `TS1109`; it now reports `EK0201`, which names the statement (decided detail 247). A `do` ending in `break` or `continue` does not also report `EK0201`; a permitted jump keeps its enclosing target. A `do` ending in a labeled block, a `switch` (an empty case block included) or an empty statement is admitted, as the proposal's predicate admits them, and a `switch` clause ending in a loop, a bare `if` or a declaration is `EK0201`. A `do` ending in an empty interruption block, `do { uninterruptible {} }`, returned the block's marker call and failed to run; it is `undefined`.
- A `do` expression could fail with a value reported as assignable only to `undefined` when a pattern-binding type hook also typed its completion temporary; completion values now follow their branches while named `is` bindings retain their inferred types.
- An early `return` in a `do` expression, including a Foldkit-style `match` arm, was rejected or stopped at an artificial function boundary. It now returns from the enclosing function; nested `break` and `continue` keep their loop targets, and short-circuit operands retain their evaluation order. Method calls keep their receiver without reading a user-defined `.bind` property.
- A `return`, `break`, `continue` or `var` inside a `do { … }` element of `try.all`, `try.race`, `try.any` or `try.allSettled` was `EK0204`, because the compiler wrapped the element in a function. The element now runs where it stands, as every `do` does, so `return` leaves the enclosing function.
- Old `do` blocks used as Effect arguments stopped compiling when `do` became immediate; `vibelang --fix` now wraps them in explicit effect blocks while preserving their completion values.
- A `do { … }` passed as a call argument rejected `return` and `var`; these now reach the enclosing function, and method getters run before arguments while preserving `this` and the method's type.
- A `do` expression whose value is a conditional, an `if`/`else` or a nested `do` under a written result type, such as a `match` arm's `do { …; condition ? { _tag: 'SelectedEdge', value: 1 } : { _tag: 'IgnoredEdge', reason: 'GuardFailed' } }` in a function returning `Selection`, failed with `TS2322` because `_tag` widened to `string`: the completion value took no contextual type from where the `do` stands. The alternatives that produce the value now take the site's contextual type, as chapter 2 says, and the value keeps its literal types, so `const exact = do { 1 }` has type `1` and `(flag: boolean): 'a' | 'b' => do { flag ? 'a' : 'b' }` compiles.
- VIP-2: a `do` expression was a function called where it stood, so `var`, `return`, and a `break` or `continue` that left it were errors (`EK1019`, `TS1108`), and a `switch` or labeled block could not end it. It is now exactly TC39's do expression, pinned to the proposal's 2021-03-03 snapshot: its block runs in the enclosing function, so `var` hoists there, `await` in an `async` function waits there (it waited for nothing before), and `return`, `break` and `continue` reach the enclosing function or loop, and its value is the block's completion value. Reads before a `do` keep their earlier values, including property getters and object shorthand fields. TC39's early errors are `EK0201` (the block ends in a declaration, a loop or an `if` without `else`), `EK0205` (a jump out of a `do` expression in a loop's head) and `EK0203` (`var` in a `do` expression in a parameter list). Where no statement surrounds it, as in a parameter default, a class member, a `return`, `var`, jump out, `await` or `yield` inside it is `EK0204`.
- Migrating an unrelated module could change how a plugin host resolved its native provided modules; disconnected native exports now keep their source paths while shared runtime components still use one emitted instance.
- Bundling a mixed package's emitted native entry failed to resolve relative text assets such as `snapshot.txt`; migration now points those generated imports at the original assets, preserving bundle behavior and asset bytes.
- Mixed packages kept native source exports after a JavaScript emit reported `TS6059` in an external fixture, although their own output files existed; migration now routes the files actually written and records the emit errors for review.
- In a package containing both `.ts` and `.vibe` modules, an unchanged TypeScript export still sent `bun build` into a `.vibe` import, which it treated as a file asset. Migration now routes native runtime exports through the package's actual emitted files too; the source loaders resolve them back to their originals, preserving one instance.
- After the migrate flow renamed a package's module to `.vibe`, the `bun build` CLI, which loads no plugin, bundled it as a file asset and failed with `No matching export` (opencode's 90 `@opencode/schema` modules); the flow now commits each migrated package's emitted JavaScript under `.vibelang/js/` and points the package's `default` exports at it, while the loaders keep running the source.
- A package whose `default` export names its emitted JavaScript under `.vibelang/js/`, which the `bun build` CLI and plain `node` need, ran that committed JavaScript under `node --import vibelang/register` and the `vibelang/bun` preload too; both loaders now run its `.vibe` source, as one module instance.
- A listed platform global such as `setTimeout` or `fetch` passed with no diagnostic as a shorthand property, `{ setTimeout }`, and got `EK4402` in a type, `typeof setTimeout`, the opposite of an unlisted host global such as `WebAssembly`; both now follow the same rules: the shorthand is `EK4402`, and the type query is TypeScript's.
- A repository an earlier migrate flow set up kept `"moduleSuffixes": ["", ".d.vibe"]` in its tsconfigs, so `bun build` printed `moduleSuffixes is not supported yet` where the TypeScript twin printed nothing (Smithers: 76 tsconfigs); rerunning setup now removes exactly that value and keeps any other suffixes.
- The migrate flow's setup wrote an array compiler option without spaces, such as `"customConditions": ["vibelang","bun"]`, so a repository's dprint or Prettier check failed on every tsconfig it edited (Smithers: about 60 packages, for `moduleSuffixes`); it now writes `["vibelang", "bun"]`, as those formatters do.
- The migrate flow's setup added compiler options to every root `tsconfig*.json` it found, test fixtures included, such as the project an LSP test in Smithers' `platform-node` type-checks as data, and did it again on each run; setup now leaves the tsconfigs under `test`, `tests`, `__tests__`, fixture and `templates` directories as they are.
- Documentation examples could not import `@effect/vitest` when another dependency supplied a different `@effect` package; snippet projects now link every scoped package from both dependency trees without changing shared installs.
- A `.vibe` script run by `NodeRuntime.runMain` exited 130 for both `SIGINT` and `SIGTERM`, because `runMain` interrupts on each and nothing told the program which arrived, so a script that exits 143 on `SIGTERM` had to keep a raw `process.once` listener in a `.ts` file; `(try Experimental.Process.Process).observeSignals(["SIGINT", "SIGTERM"])` now records the first signal received for a cleanup finalizer to read, and EK4402 for `process.on` and `process.once` names it.
- The formatter refused a file with `try x as T catch h`, `try x satisfies T catch h` or `try f<T> catch h`, or with `x as T catch h` outside parentheses, with an internal error (its TypeScript form did not parse), so `vibelang format` and the editor could not format it; it now formats the file and writes the parentheses the operand needs, `(try x as T) catch h`.
- In the editor, Find References and Go to Definition on the subject of an `is` pattern that binds names, such as `x` in `(x is { id: let id })`, found nothing, because the test the parser writes for the subject started at the `is` keyword; they now find the subject and its other references.
- The migrate flow's codemod wrote each renamed module's bare package export as `{ "types": "./x.d.vibe.ts", "default": "./x.vibe" }` even in a repository that already exports its `.vibe` modules as `"./src/X.vibe"` and checks that form, such as Smithers' export-map contracts; where any of the repository's manifests maps a subpath to a `.vibe` file by a bare path, the codemod now writes the bare path.
- A `vibelang --fix` run stopped by `SIGTERM` or Ctrl-C went on until the check under way ended, an hour on t3code's server, so a driver that waited a few minutes killed it; it now exits at once with the fixes it verified written.
- A migrated module's `.d.ts` named another `.vibe` module `./x.js` even in packages whose published declarations say `./x` or `./x.ts`, such as opencode's and Smithers', and an import the declaration added used double quotes in single-quoted files such as foldkit's; the setting `vibelang.declarationImportStyle` (`".js"`, `"extensionless"` or `".ts"`) now keeps the package's spelling, the migrate flow's setup writes it from the package's sources, and added imports take the file's quote style.
- A `.vibe` file that imported several Effect modules in one statement, `import { HashMap, Option } from 'effect'`, and wrote their types got one declaration import per name, such as `import { HashMap } from "effect"`; its `.d.ts` now keeps the one written import, in its order and quotes, and an added `Effect` joins it.
- A declaration named a migrated module in an inferred type `import("./x.js")` where `tsc` printed `import("./x.ts")`, as foldkit's `keyedQuery.d.ts` did under `module: nodenext` with `rewriteRelativeImportExtensions`, and a `.vibe` file's written `./helper.ts` became `./helper.js` under the default style; inferred import types now take the spelling `tsc` gives the unmigrated file, and every specifier other than `./x.vibe` stays as written under every style.
- On the VIP-1 compiler, `vibelang --fix --fix-vip-only` wrote no `try` for a call that ran without one before VIP-1, so foldkit's `when Option.None: die(new Error("missing"))` kept only the warning `EK4802` and returned its program instead of running it, with `0` fixes. The migration now writes `try` wherever the old compiler ran such a call: a statement, an initializer, a return value, a `match` or `?:` arm, `??`, `||`, `&&`, a `do` result, an `effect` arrow's body, a `catch` handler or fallback, an argument, an element or a property value. It marks `effect` each function the old compiler made an Effect function, a `catch` handler included, removes the `try` before a plain declaration's call whose result is data, and reports each call it can't decide as `try not written: …` instead of guessing. Ordinary `vibelang --fix` is unchanged.
- The migrate flow's setup left Metro, Babel and the React Compiler unwired, so a React Native app could not bundle a migrated module, and t3code's web build skipped the React Compiler on every `.vibe` module: `@vitejs/plugin-react` filters modules by `/\.[tj]sx?$/`. Setup now wraps each `metro.config` export in `withVibeLang`, adds `vibelang/babel` to the Babel presets, adds `.vibe` modules to the `include` of each plugin-react call that turns the React Compiler on, and, under pnpm or Bun, patches `oxc-transform-react` so a test that calls its `transform` on a `.vibe` module's text, such as t3code's React Compiler coverage test, checks the module's JavaScript.
- A React Native app could not bundle a `.vibe` module, and Babel, the React Compiler and Oxc could not read one, so t3code's 158 mobile modules and its React Compiler coverage tests (318 modules) stayed TypeScript. `vibelang/metro` wraps a Metro config (`withVibeLang`): Metro resolves `.vibe` modules, and the app's own Babel transformer receives their JavaScript, with source maps that name `.vibe` lines. The `vibelang/babel` preset does the same for Babel, and `vibelang/emit`'s `toolArguments` for a tool called as `transform(filename, text, options)`, such as oxc-transform-react; the React Compiler reports the same diagnostics and writes the same output for a `.vibe` hook as for its `.ts` twin.
- In a `.vibe` file, `Response.json(...)`, or another static member that the global `Response`, `Headers`, `Event` or `Worker` has and Effect's module of that name lacks, reported only `TS2339` on `typeof import("effect/dist/ai/Response")`, as in a Cloudflare Worker that returns `Response.json(rows)`; the error now says that bare `Response` is Effect's `effect/ai/Response` module and that the global's member is `globalThis.Response.json`, or, for a platform global such as `Worker`, that the code belongs in a `.ts` file.
- The migrate flow's codemod rewrote a test's import of a renamed module to `./x.vibe` but left its Vitest mock, `vi.mock("./x.ts", …)`, so the mock stopped matching and the test ran the real module; Vitest's and Jest's module mocks and `importActual` now take the same name as the import, and `revert` puts back each specifier as it was written where a file named the module two ways, such as `./x.js` in its import and `./x.ts` in its mock.
- The migrate flow's setup put its `**/*.d.vibe.ts` ESLint ignore inside the arguments of an ESLint configuration that exports an array method's result, such as Smithers' `export default config.flatMap((entry) => ...)`, so ESLint could not load the configuration (`TypeError: object is not a function`); the entry now goes first in a list before the result's spread, `[{ ignores: [...] }, ...config.flatMap(...)]`.
- `eslint-plugin-import` found no exports in a `.vibe` module, so `import/namespace` and `import/named` reported every name a `.ts` file imported from one, such as `'batch' not found in imported namespace` in three Smithers packages; the migrate flow's setup now maps `.vibe` to `vibelang/eslint` in the `import/parsers` setting of each ESLint configuration that loads the plugin, and the devtools page documents the setting.
- `vibelang-format` and the dprint plugin parenthesized a `try`, `fork` or `join` operand of `in` or `instanceof`, writing `(try x) instanceof Error` for `try x instanceof Error` (before 0.0.11 main also did it before `is`, which edited 5 assertions in a Smithers test); a prefix keeps the parentheses it was written with, as `await` does.
- The migrate flow's codemod rewrote the imports of TypeScript and VibeLang files only, so a JavaScript script that imports a migrated module's source, such as Smithers' `.mjs` scripts importing `../../../src/Monitor.ts`, kept the `.ts` name and failed `import/no-unresolved`; `.js`, `.mjs`, `.cjs` and `.jsx` files now get the `.vibe` name where they name the source file, and keep `./x.js` and extensionless specifiers.
- The migrate flow's setup refused a toolchain switch when a package's only errors were Effect diagnostics such as `EK3870`, which exit 0: it compared the upgraded check's real exit code with one derived from the diagnostics' categories, 2. Setup now records its compile's own exit code and compares the two (Smithers: the switch to a toolchain with main's flow).
- A migration with an older or unresolved declaration baseline could report unchanged declarations without proving their published API. Verification now reconstructs the original publication metadata from the saved setup commit and compares exported names, strict type identity and normalized JSDoc. Missing evidence or an unavailable probe is reported separately and proves no identity. Equivalent formatting and module-specifier spelling pass. A package without an entry-point field, such as a CLI that publishes only a bundled `bin`, publishes only its root `index` declaration; its other declarations are private.
- A class pattern naming a service, `when Users:` or `when Users(let u):`, compiled and never matched, while `impl instanceof Users` reported `EK3004`; both pattern forms now report `EK3004` too (chapter 005's static rules).
- A `!` with no slot on its line, as in `const b: User!` followed by `NotFound` on the next line or `const e: User! = …`, silently compiled as `User!!`; it now reports the TypeScript error `TS17019`, while `User!!` may end a line and a parenthesized slot may span lines.
- The migrate flow's setup wired `vibelang-unplugin` only into `Bun.build` scripts, so a source or build script that bundles with esbuild, such as Smithers' realm build or a sandbox that bundles flows (`build({ ... })` from `esbuild`), failed once a module it reached was `.vibe`; setup now adds `vibelang()` from `vibelang-unplugin/esbuild` last to each esbuild `build` and `context` call in the scripts and sources of every package that reaches a migrated one, and warns with the file and line about a call it cannot edit. Tests, fixtures and helpers only tests import stay byte for byte as they are, with a warning for each one that bundles.
- `vibelang-unplugin` failed every build, even one that reached no `.vibe` module, with `Cannot find module 'vibelang/package.json'` when it started from a directory that installs no `vibelang`, such as an esbuild check in a test that Vitest runs from a monorepo's root, and a build without the `vibelang` package crashed the whole process with an unhandled rejection; the plugin now falls back to the `vibelang` package beside it, and a missing package fails only the build, with the install hint.
- The migrate flow's codemod sent every module that imports a Node or Bun builtin as a value back to TypeScript (EK4402), 22 Smithers modules among them; it now moves the platform code into `<Name>.platform.ts` beside the module and keeps each export that used it as a function with the same signature, so the module migrates with unchanged declarations.
- The migration's platform split moved only modules that import a Node builtin, so a module left with `EK4402` on a host global such as `process.kill` after `vibelang --fix` went back to TypeScript; the split now also moves the declarations that read the globals those `EK4402` messages name (`platformGlobalsOf`), and keeps the rest in the `.vibe` module.
- The migrate flow's codemod rewrote a specifier inside a comment, such as a doc comment's `{@link import("./x.ts").X}`, and declaration emit copied the comment, so a module's published declaration changed although the module stayed `.ts`; a specifier in a comment now stays as written.
- A declaration kept the parentheses a `!` type needs around a slot, printing `Effect.Effect<(A | B), E>` for `(A | B)!E`, so it differed from the same type written in TypeScript; those parentheses no longer reach the declaration.
- A `.vibe` module that wrote `effect { }` blocks but never named `Effect`, such as one whose codemod replaced each `Effect.gen` with a block, declared each block's type `import("effect/Effect").Effect<…>`; it now declares `Effect.Effect<…>` and imports `Effect`, as its Effect TypeScript twin does.
- A `.ts` module whose declaration copied a type that a `.vibe` module writes in the `!` form printed the slots the form leaves empty, `Effect.Effect<A, E, never>` for `A!E`, so a TypeScript importer's declaration changed when its dependency migrated, as t3code's `GitVcsDriver.ts` did; it now prints `Effect.Effect<A, E>`, as the `.vibe` module's own declaration does.
- A callback passed to a generic function, such as `run(() => program)` for `run<R>(f: () => Effect<void, never, R>)`, drew `EK9202` ("needs R, but its contract says R = R"): the check read the function's own type parameter as the callback's contract, though TypeScript infers it from the callback; a requirement or failure the call infers no longer escapes.
- A `console.log`, `console.error` or other `console` output call in effect code drew `EK4402` with no quick fix, so every migrated module that logged needed a hand edit; `vibelang --fix` now writes it as Effect's `Console` (`try Console.error(…)`), which prints the same and adds nothing to the function's contract. In plain code the call keeps `EK4402`.
- Under `noUncheckedIndexedAccess`, a binding in a list pattern, such as `when Exit.Success(let value)`, `when [let a, let b]` or `when Array(let n)`, read as `A | undefined`, so correct code failed with `TS2322` or `TS18048`; a binding now has its element type, because the pattern has already tested the length. Under `noPropertyAccessFromIndexSignature`, an object pattern on a `Record`, such as `when { a: let x }`, failed with `TS4111` at a key no source edit could change; it now compiles. Reads you write yourself, such as `s[0]` or `s.a`, keep both options.
- In a program with the DOM library, a declaration named Effect's `FileSystem`, `Headers` and other modules that share a DOM type's name as `FileSystem_1`, so it differed from the same module in TypeScript; it now prints the plain name, and keeps the alias only when the file also writes the DOM type.
- A producer that forked a scoped child, `try Effect.forkScoped(…)` in an `effect function*`, declared a `Stream` that required `Scope`, so consumers had to provide one the Stream already supplies; the inferred Stream requirements now leave `Scope` out, as `Stream.callback` does (decided detail 225).
- `restore` inside a `for concurrent` body or head binding reported `EK2111`, as if no mask enclosed it, or compiled under a mask opened inside the body; it now reports `EK2202`, as does a `restore` that would capture an enclosing `uninterruptible` block across an `effect` function, arrow, method, producer or block (VIP-22, amended 2026-10-30 and 2026-10-31). A `do` expression inside a mask no longer reports `EK2111` for its `restore`.
- A `break` or `continue` that would leave an `effect { }` block reported TypeScript's `TS1107`; it now reports `EK0202` (decided detail 247).
- Pattern bindings in parameter defaults and enum initializers reported a generic unsupported-binding error; they now identify the unsettled lexical scope with `EK0705`.
- Once the migrate flow moved an Oxlint JS plugin's modules to `.vibe`, every lint failed with `ERR_UNKNOWN_FILE_EXTENSION ".vibe"`, since Oxlint loads plugins through Node; setup now preloads `vibelang/register` in each script that runs Oxlint and in the plugin package's test scripts.
- The migrate flow's setup with `--no-wire` skipped wiring entirely, so a package of the run that an earlier setup had not wired, such as t3code's `oxlint-plugin-t3code`, `scripts` and `evals`, kept `tsc` and had no `vibelang-runtime`, and a migrated module there failed to load with `ERR_MODULE_NOT_FOUND`; setup now wires each such package with the specifiers the wired packages already use, and leaves the rest of the target as it was.
- A stock TypeScript consumer could read the types from `tag.ts` instead of an explicitly imported `tag.vibe` when both files shared a basename; compatibility declarations now preserve the source selected by written and inferred imports in either sidecar layout.
- A test or script that lists a folder's `*.ts` files and skips only `*.d.ts`, such as Smithers' `coding-stable-plan.test.ts`, imported the `x.d.vibe.ts` sidecar beside each `.vibe` module as source and failed; the new `vibe.sidecarDir` setting writes every sidecar under one hidden directory, conventionally `.vibe/declarations`, that tsconfig `rootDirs` lets stock `tsc` resolve, and switching it on or off removes the sidecars left in the other place. The migrate flow's setup turns it on where it finds such code, and its plan keeps the `.ts` modules that code lists as `.ts`. The Node and Bun loaders' compile cache treats that directory as output, so writing sidecars there does not force the next process to recompile. The same directory settings and immediate cleanup apply when `--no-wire` adds a new package beside existing wired packages.
- A consumer of another project's relocated declarations could report `TS2307` for native imports, or accept an incorrect type under `skipLibCheck`; relative references now resolve from the declaration's actual location, including native TypeScript files and VibeLang sibling declarations.
- Workspace imports could create two private class identities when one import reached a relocated declaration and another reached its source; both now use the matching workspace source after normal realpath resolution. A logical `node_modules` path retained by `preserveSymlinks` keeps its declaration identity.
- Migration setup could leave tracked adjacent sidecars behind after choosing a directory, so a later compiler run dirtied the tree; setup now removes the superseded paired outputs immediately and leaves unrelated declarations alone.
- Migration setup and package exports could ignore an inherited or custom sidecar directory; roots and export targets now use the same effective path, including `${configDir}` and empty overrides.
- TypeScript ast-grep rules and unquoted script globs could miss automatic sidecar relocation; setup now detects those selectors and records the reason.
- A `for concurrent` head pattern with a `do` that ran an Effect, as in `const { n = do { try poll } }` or a computed key `[do { … }]`, typed the binding as an Effect (TS2365, TS2538) and did not run it; the pattern now binds inside the item, as a `for...of` pattern binds inside its body, so the `do` runs there and the binding has its value. The mapper projects such a head back to its source pattern, not to the item it declares from.
- Under the `vibelang/bun` preload, the first `require` in a package whose `tsconfig.json` extends a package's config, such as `@tsconfig/bun/tsconfig.json`, made the preload's CommonJS hook call itself about 2,600 times and cost about 200 ms, so a short-lived `bun` child started several times slower and a large module graph took seconds (22 s instead of 0.5 s for one opencode test's child); the preload now reads each config once, and its own lookups go straight to Bun.
- Schema aliases could accept ordinary objects carrying only Effect's schema marker; references now require `Schema.Top` and report `EK2109`, with a preserving `const` and `type` expansion for old non-schema aliases.
- A local declaration inside a `for concurrent` body could incorrectly conflict with the loop binding; the body now keeps its own block scope.
- `Date` patterns could disagree with JavaScript after an object’s prototype changed or when matching a date from another realm; they now use the native `instanceof` test.
- Invalid schema aliases inside functions and namespaces could silently decode through `Schema.Unknown` or report unrelated TypeScript errors; they now report `EK2109`, and the preserving keyword fix keeps their previous codec and public type.
- An unmatched `match` formatted its subject while constructing the error, which could run coercion hooks and replace the error. It now throws the host-default `TypeError` with an empty message and does not read the subject.
- The runtime `$extract` constructor overload let a possible primitive result be assigned to `object`; its public types now include the primitive, so TypeScript rejects that assignment.
- An exported `AsyncFiberError` constructor could change its declaration spelling when a nearby matcher changed; inferred `Fiber` parameters now keep the same namespace import, while written types and local names remain intact.
- A producer with a written `Stream.Stream<A, E, R>` return type was rejected with `TS2739` (`Generator<…>` is not a `Stream`), so a producer could only leave its type to inference; its body is now checked as the generator it is, each `yield` against `A`, and callers and the declaration file keep the written `Stream`.
- `try.map x`, a name after `try.` other than `all`, `race`, `any` or `allSettled`, failed with three TypeScript parse errors; it is now `EK1803`, read as `try x` for recovery.
- A fiber on the left of a pipe, `fork a() |> Fiber.join(%)` or `f |> Fiber.join(%)`, was `EK4838` (an owned fiber used where it may not go); the fiber now goes where the pipe's topic goes, as chapter 2 says `fork a() |> f(%)` forks `a()` and pipes the Fiber, so a topic joined or passed to a `Fiber` function stays in its region and one passed to another call or captured by a function is still `EK4838`.
- A `.vibe` file that read `window.matchMedia` got `EK4402` and had to move the read to a `.ts` file, because Effect has no service for media queries; `Experimental.MediaQuery` now reads and follows a query, `EK4402` names it, and `ExperimentalBrowserServices.layer` provides it.
- A `.vibe` file that used `requestAnimationFrame`, `cancelAnimationFrame` or `Element.getAnimations` got `EK4402` and had to move the call to a `.ts` file; `Experimental.Animations` now gives `nextFrame`, `nextFrameUnless`, `frameDeltas` and `settled`, `EK4402` names it, and `ExperimentalBrowserServices.layer` provides it.
- A `.vibe` file that read a browser `File` got `EK4402`, which said to use `FileSystem`, and that service reads paths; `Experimental.FileReader` now reads a `Blob` or a `File` as text, a data URL or bytes, `EK4402` names it, and `ExperimentalBrowserServices.layer` provides it.
- A `.vibe` file that followed an element's size got `EK4402` for `ResizeObserver`; `Experimental.ResizeObserver` now observes an element until its Scope closes, `EK4402` names it, and `ExperimentalBrowserServices.layer` provides it.
- A `.vibe` file that passed `document` to an API that takes an event target got `EK4402` with no service to use; `Experimental.Document` now gives the page's `Document`, `EK4402` names it, and `ExperimentalBrowserServices.layer` provides it.
- A class pattern naming a `data` declaration, a `schema` declaration or a `Context.Reference`, such as `when Delivery:` or `when Address:`, compiled and matched almost anything at run time; it now reports `EK0702` and names the variant pattern or `Schema.is` guard to write instead.
- An extractor pattern that can never match, such as `when NotFound():` on an `error` (which extracts the subject) or `when Option.None(let v):`, compiled silently and its arm never ran; it now reports the lint warning `EK0703` naming the forms that match.
- **Language change:** a `throw` in a plain VibeLang function, method, constructor, accessor, generator, initializer, plain `catch` handler or module top level, and a call there known to throw such as `JSON.parse(s)` outside a `try`/`catch` statement, compiled; the specification now makes them `EK0401` (VIP-4, amended 2026-10-31): make the function `effect`, or move the code to a `.ts` file. `throw` in `effect` and `async` functions is unchanged. `EK0511` and `EK0405` are retired.
- `EK0401` had no quick fix. The editor now offers "Make f an effect function", which adds `effect`, drops a plain return annotation and wraps a known-throwing call in `try Effect.try(() => …)`, and the same with `return try die(e)` for a `throw` statement; a plain `catch` handler becomes `catch effect`. The fix is not offered where making the function `effect` would change a type something else fixes: an overload implementation, or a method that implements an interface member, overrides a base method or fills a contextual type's member.
- A call known to throw, such as `JSON.parse(text)` or a `.ts` function tagged `@throws`, compiled in a plain VibeLang function, constructor or the module's top level, where its exception escaped as JavaScript's. It is now `EK0401`, unless it stands in the `try` block of a `try` statement with a `catch` clause in the same function. Make the function `effect` and run the call with `try Effect.try(() => …)`, or move the code to a `.ts` file. A `.ts` call without a contract is still an ordinary call.
- `vibelang --fix` rewrote the retired `try(…)` hatch `try((text) => JSON.parse(text), text)` as `try Effect.try(() => ((text) => JSON.parse(text))(text))`, whose arrow, called in place, is plain code holding a call known to throw (`EK0401`), so the fix was refused. It now writes the arrow's body as the thunk, `try Effect.try(() => JSON.parse(text))`, binding an input of another name with `let`: `() => { let text = "1"; return JSON.parse(text) }`. A parameter whose input has its own name is still its own binding: where the body assigns it, a function in the body captures it, or it has a written type, the thunk copies the input and rebinds the parameter in an inner block, `() => { const textInput = text; { let text = textInput; text = "2"; return JSON.parse(text) } }`, so a write or a later closure call no longer changes the caller's variable.
- A callback nested in `Effect.try`'s thunk, the `Promise` executor or another literal whose throws belong to the call it is passed to compiled with a call known to throw, such as `return try Effect.try(() => { return (): unknown => JSON.parse("{") })`, so the returned callback threw a native `SyntaxError` after `Effect.try` had finished. Only the literal's own body may hold such calls now; a function nested in it, returned, stored, passed on or called in place, is its own plain code and the call is `EK0401`.
- The quick fixes for `Effect.catchTag` of part of a failure (`EK4835`) and a typed `catch` expression (`EK2112`) wrote a plain handler ending in `default: throw e`, which is `EK0401`, so `vibelang --fix` refused them. A handler that rethrows is now written `catch effect (e) => …`.
- A `throw` in synchronous VibeLang code outside effect code was reported under five different codes, `EK9203`, `EK1001`, `EK2115`, `EK4301` or the `EK0511` warning, and compiled when the same code's own `try` caught it. Synchronous VibeLang code never throws: each such `throw`, in a plain function, method, constructor, accessor, plain generator, field or `static` initializer, parameter default, plain `catch` handler or the module's top level, is now `EK0401` at the `throw`. Make the function `effect`, whose `throw` is `Effect.fail`, or move the code to a `.ts` file. A `throw` in an `async` function still rejects its Promise.
- A `throw` in an ordinary `async` function's parameter default was `EK0401`, though it rejects the function's Promise as a `throw` in its body does; it now compiles. A call known to throw, such as `JSON.parse(text)`, in a callback passed as the `Promise` executor or to a parameter whose function type has `@throws`, was `EK0401`; it now compiles, because the call that receives the callback answers for its throws.
- `vibelang --fix` for `EK4401` kept a function plain with `: infer _` when its foreign call's `@throws` named a class the file can't reach, leaving a plain function that calls code known to throw (`EK0401`). It now makes the function `effect` and runs the call with `try Effect.orDie(Effect.try(…))`, as for the other foreign calls.
- A `@throws` or `@rethrows` tag in a `.vibe` file compiled silently, though a VibeLang function never throws and the compiler read no thrown type from it. Each such tag, on any declaration, signature or type, now reports `EK0406`, and `vibelang --fix` removes it; write an `effect` function's failures in its error type, such as `number!NotFound`.
- A callback passed into a rest parameter whose element type has `@throws`, such as `rest((): unknown => JSON.parse("{"))` for `rest(...fs: Reader[])`, was `EK0401` at the call, though the same callback passed to a fixed `Reader` parameter compiled. The check read the whole rest array's type, which has no call signature. Each argument now takes its effective parameter: the rest element, or the tuple-rest member at its position.
- `vibelang --fix` rewrote a retired `try(…)` hatch with a getter among its inputs, such as `try((ignored, text) => () => text, box.value, text)`, into a thunk that read `text` before the getter ran, or not at all, so the result changed. When an input may run code, the thunk now evaluates every input once, left to right, into a `const` of its own, then binds the parameters, as the call did.
- The migrate flow left a lint script that runs Oxlint in parentheses, `(oxlint --disable-nested-config)`, without its `.vibe` ESLint pass, and did the same to `(oxfmt --check .)` and `(prettier --check .)`, so those tools skipped `.vibe` files; each rerun of setup also added another layer of ESLint passes to a wired script, kept an earlier run's pass with the wrong `-c` configuration, and re-added the `**/*.d.vibe.ts` ESLint ignore once a formatter had requoted it. Each of these scripts now gets its pass, setup rewrites the passes it wrote before, and a rerun changes nothing.
- `vibelang --fix` checked the whole project for each trial when no error traced to the fixes it was trying, so a package with many such fixes spent hours on a round's last few: on a generated project, 240 modules took 245 whole checks where 60 took 65. It now looks for a trial's errors in the files that reported errors earlier in the round, and checks the kept fixes against the whole project once at the end: the same 240 modules take 4 whole checks, and a fix refused this way names the first error of those files.
- `vibelang --fix` checked the whole project once for each fix that added an error to another file, so a package with many such fixes took time that grew with the square of its size: on a generated project, 240 modules took 78 checks and 6.5 s where 60 took 24 and 0.9 s. It now finds the fixes behind the errors of different files together, in a few checks of those files, and prints the checks of each round in its progress line. When the prelude's rewrites added an error together, it also checked the project once for each file it rewrote; it now finds the rewrites that add one as it finds the fixes that do.
- `vibelang --fix` printed nothing until its report, so a 3-hour run on a large package looked like a hang; it now prints its phase, round, fixes applied, pending and refused, and the checks it has made to stderr every five seconds. Stdout is unchanged.
- A `vibelang --fix` run stopped by a timeout, `SIGTERM` or Ctrl-C wrote nothing, so an hour of checked fixes on a large package was lost; it now writes each file as soon as its fixes pass the check, keeps every fix it checked and none it did not, and a second run finishes the work.
- `vibelang --fix` refused a fix that only changed the message of an error the program already reported at the same place, such as a test's existing `TS2345` that named `Effect<brand<…>>` before a schema helper got its plain return type and `brand<…>` after, so the helper stayed an Effect function; an error at the same file, code and span now counts as the same error, and a fix that adds an error is still refused.
- `vibelang --fix` checked the whole project once or more for each fix it refused, and again in each round that offered a refused edit once more: on t3code's `packages/contracts`, 99 refusals over 32 rounds took 386 checks and 30 minutes. It now tells which fixes add errors from where the errors are and which declarations they read, and refuses an edit it refused before to the same text without checking again; that package takes 17 checks and under 2 minutes, with the same fixes and refusals.
- The migrate flow's inventory recorded only relative imports, so a module imported through a tsconfig `paths` alias such as `~/hooks/useSettings` had no dependents, and the plan and the rollback ordered such modules after the files that import them; setup now resolves each package's `paths` aliases as TypeScript does and records those imports too.
- The migrate flow's declaration identity check failed a module whose declaration file differed only in the order of its import statements, as when the codemod's `import { Tool, Toolkit } from "effect/ai"` moved ahead of the others; equivalent import and re-export order now passes for published and private declarations while exported names, strict types and JSDoc remain checked.
- The migrate flow's declaration identity check failed a module whose private `Schema.Struct` constant became a `schema` declaration, because the declaration file then also printed `type State = typeof State.Type`, a private alias nothing names; private aliases now pass when they preserve every exported name, type and doc comment, including in a published declaration file.
- The migrate flow's codemod, which rewrites a renamed module's importers anywhere in the repository, also rewrote specifiers such as `../src/Command.ts` that name a module an earlier migration had already made `.vibe`, so a batch edited files it had nothing to do with; the codemod and `revert` now change only the imports of the modules the batch renames or puts back, and the imports inside them.
- The migrate flow's `record` left a batch's `.vibe` files unformatted whenever jj saw the module as renamed, as Smithers' `src/{Crypto.ts => Crypto.vibe}`, so the repository's format check then failed on them; `record` now formats and refreshes the sidecars of every `.vibe` file the batch wrote, renamed or not.
- The migrate flow's `verify` listed a baseline test as missing when its name printed a date, such as `it.each([[new Date()]])("rejects %s")`, so a package with one could never pass; tests are now matched with any `Date#toString`, `toUTCString` or ISO date in their names set aside.
- The migrate flow's setup wired `vibelang-vite` into the Vitest config the tests load without `register`, so a test that starts `node` on the sources, such as 62 of Smithers' test files, failed once the module graph reached a `.vibe` file; setup now writes `vibelang({ register: true })`, and adds `register: true` to a config that already had the plugin.
- `vibelang-vite`'s `register: true` set only `NODE_OPTIONS`, so under `bun x --bun vitest` a test that started `process.execPath`, then Bun, could not import `.vibe` source; the plugin now also adds `--preload` of `vibelang/bun` to the tests' `BUN_OPTIONS`.
- The migrate flow's setup on a new toolchain emitted the baseline declarations of modules earlier runs had migrated with that toolchain, so a toolchain change to their public API, such as foldkit's `mount/index` losing `readonly` members, became the baseline and every batch passed against it. Setup now compares each such module's declaration with the sidecar the earlier run committed and records a setup issue for each change.
- The migrate flow pointed a renamed module's package `exports` and `types` at `x.vibe`, so stock TypeScript, reading the module through its declaration sidecar, reported `TS2883` where a consumer's inferred type named one of the module's types; a `types` field or condition now names `x.d.vibe.ts`, and a bare entry becomes `{ "types": "./x.d.vibe.ts", "default": "./x.vibe" }`.
- A `.vibe` module in a project with no declaration output failed to compile when its declaration sidecar could not print an export's type, such as foldkit's `AppTabs = Tabs.create<…>()` (`TS2883`), though `tsc` compiles the same TypeScript, which emits no declarations, without an error. Such an error is now reported only where a `.ts` file of the project imports the module, at that import, since that file reads the sidecar; a project that emits declarations still reports it at the export.
- The migrate flow's `verify` passed a batch whose declaration emit failed in a migrated file, such as `TS7056` for a type too long to serialize, when the baseline's emit failed the same way and the two fallbacks were equal; it records emit failures separately from artifact equality. Newly introduced diagnostics fail the batch; inherited diagnostics require the saved original program receipt and do not establish API identity for a missing declaration.
- `await` at a `.vibe` module's top level, such as `export const answer = await Promise.resolve(42)`, was VibeLang's await, so it reported `EK4602` and `EK1001` and emitted a runtime `$await` call. It is ES top-level await of a Promise now, in a declaration, a statement or a block, as the spec says (VIP-26); an Effect operand is `EK0103`, and a CommonJS file reports TypeScript's `TS1309`.
- Migrating a service default could capture a user-defined `ReturnType` and change exported types; the repair now extracts the factory return type without relying on that name.
- A legacy service `default` with no value could be silently accepted and had no usable migration; it now reports `EK0902`, while initialized defaults keep their migration warning and repair.
- Formatting an inline `@internal` or other JSDoc comment beside an error payload could silently change its declaration output; the formatter now refuses changes to comment attachment and leaves the file intact.
- The runtime helper `$produce` required an external `Scope` even though its Stream callback supplies one; its result now removes that requirement and keeps other services.
- Splitting `for concurrent` across lines could cause syntax errors; line breaks and multiline comments now work before either the limit or loop head.
- Exporting a top-level `data` or `schema` named `as` produced a `.d.ts` file TypeScript could not parse; its exported type now uses an unambiguous declaration and keeps the same public name.
- Formatting `async f()` or `effect f()` silently migrated the declaration and removed `EK0101`; formatting now preserves the shorthand, and `vibelang --fix` applies its existing repair.
- Checking explicit files beside a project config failed with `TS5112` unless `--ignoreConfig` was added; compiler and `lint` file arguments now bypass config discovery as specified.
- A local binding named `undefined` could reject `for concurrent` or silently limit its concurrency; an omitted limit now always runs unbounded.
- The TypeScript mapper evaluated a `for concurrent` iterable before its written limit; both renderings now evaluate the limit first, once.
- Fiber operators before exponentiation could compile or report a misleading type error. `fork` and `join` now require parentheses on the left of `**`, like `await`.
- Effect methods with bigint literal names, such as `effect 1n()`, were rejected with syntax errors; those names now work as TypeScript method names do.
- Optional class methods such as `effect read?()` were rejected with syntax errors; optional names now work for ordinary, computed and generic Effect methods, with TypeScript's usual checks.
- A statement such as `effect as (Handler)` or `async satisfies (Handler)` could be mistaken for a removed function shorthand and rejected; `as` and `satisfies` expressions now keep their TypeScript meaning.
- An `effect` method with a computed name, such as `effect [key]()`, was rejected with syntax errors in a class or object literal; computed names now work for instance, static and generic Effect methods.
- The config preview silently dropped invalid settings; `vibelang --showConfig` now reports local and inherited configuration errors and exits unsuccessfully.
- `vibelang --fix` could refuse a plain helper that collected another helper's results, because it wrote their old `Effect` result type. It now infers the corrected return type.
- Expressions such as `join fork task` and `! join child` caused parser errors. Fiber operators now compose as ordinary unary expressions.
- Exporting a `data` declaration named `as` produced an invalid declaration file; the emitted type alias now disambiguates the contextual name and remains usable by TypeScript consumers.
- Generic `data` parameters silently accepted defaults that its constructors do not support. Defaults now report `EK2803`; `vibelang --fix` preserves them in equivalent Effect TypeScript.
| A schema field with a class-only modifier such as `public` or `static` | `TS1070`: run `vibelang --fix` to remove ignored modifiers and preserve the field’s codec and readonly behavior. |
| A producer had an erased return annotation such as `any` or `unknown` | `EK2102`: write `Stream.Stream<A, E, R>` or omit the annotation to infer the producer contract. |
- `--fix` could repeatedly recheck a large project when an importer's errors came from one edited dependency. It now traces referenced declarations and keeps unrelated reporter edits together while retaining the complete safety check.
- The compiler reported `EK1307` for an ambient `error` or `schema error` declaration, but Appendix B did not list the code; it does now.
- Six compiler cases still expected behaviour the language had already changed: plain `main` functions after VIP-1, an unrun `Fiber.join` result, an `error` constructor (`EK1301`), a last match arm without `;`, and `EK1003` for `for await` in a plain function; they now state current behaviour, and that last one is `plain-for-await.fail`, expecting `TS1103`.
- `try` on a value that is not an Effect made the enclosing function `any`, which added a stray `EK3205` at `main`, and `try` on a value typed by a constrained type parameter lost its success and error types; the `try` now reports only `EK0502` and the type parameter keeps the channels of its constraint.

- Migration checks now exercise filtered tagged catches, dependent cold-program construction, nested callbacks, and untraced context restoration across both Effect import forms; unsafe rewrites remain subject to refusal.

- Migration declaration checks now cover generic span rewrites that accidentally remove a requirement, while accepting equivalent formatting and union order.

- The specification's folded details referred to removed `EK1020` and `EK4843` checks as though they still needed diagnostic registry entries. Both references now explicitly identify historical checks, matching VIP-1 and VIP-26.

- The specification checks rejected the folded explanation that `trustedPackages` was removed. They now permit historical retirement notes while still rejecting obsolete settings in the current configuration documentation.


| Imports of older generated generic-data helpers such as `OutcomeDefinition` | Run `vibelang --fix` in owned `.vibe` sources. Native TypeScript consumers stay unchanged; update their imported helper name to `$Outcome$Definition`. |
- A legacy service member call in a `catch` head could typecheck but throw a `TypeError` instead of handling its typed failure. Accepted service calls in `catch`, `try` and pipe heads now look up the service before calling its member, and the lookup remains in the inferred requirements.

- Comparing an unchanged declaration package could report a type difference for a `private` getter, setter or method with an elided type, or for a private getter/setter pair. The API-identity checker now preserves their original types and visibility while still detecting added or removed private members.
- The migrate flow's inventory did not see a `Bun.spawn([process.execPath, "build", ...])` in a test as a bundle, so it could migrate a module that bundle reads and the test then failed with `No matching export`. It now records that module as reached by the bundle. `--route-bundled-imports` is a new option that keeps such modules eligible: TypeScript that a test bundles names them through a package import of the committed emitted JavaScript, so an unchanged `Bun.build` or `bun build` works. This changes what a migration keeps as TypeScript where a test spawns `bun build`.
- The migrate flow's inventory did not see a tool's named glob, such as drizzle-kit's `schema: ["./src/**/*.sql.ts", "./src/**/sql.ts"]`, so it could migrate a module the tool selects by name and the tool then missed it. Those modules now stay `.ts`.

- Migrating JSX files could include previously excluded stories or omit explicitly included sources. Setup now preserves `include` and `exclude` membership with `.vibex` counterparts for `.tsx` selectors and `.vibe` counterparts for `.ts` and `.mts`.
- `vibelang --fix` read `input.arguments` in an `Effect.gen` or `Effect.fn` generator as the generator's own `arguments` and refused it; it now fixes it. Two reads it missed changed meaning: `{ arguments }`, and `self` in `Effect.gen(function* self() { … })`, which the fix left naming nothing. It now refuses both.
- `vibelang --fix` refused a `yield*` whose success is itself a program, such as `const stop = yield* listen()` followed by `Effect.addFinalizer(() => stop)`, though `try` runs one layer and the value stays a program. It now writes `const stop = try listen()`.


- A `.ts` function declared `@throws {Error}` could be passed where a callback type such as `() => void` was expected, as an argument, object member, spread member, initializer, array element or return value, with no diagnostic. It now reports `EK0402`; a `@throws` on the function type, a `@rethrows` parameter, `Array` iteration callbacks and the thunk of `Effect.try` and `tryPromise` still admit it.

- API regression checks could fail after concurrent checker fixes duplicated an expected JSON export; each published entry is now expected exactly once.

- A declaration API checker killed by the system or by heap exhaustion left no result; the CLI now returns an explicit invalid receipt with the worker's exit status or signal, including when a worker exits successfully without a result.

- A declaration API comparison that overflowed the stack threw instead of returning a verdict; it now returns an explicit invalid result with its failed stage and memory use, and `--json` exits `2`.

- Published-declaration checks could reject a package compared with itself when `vibe.sidecarDir` moved its declarations or a dependency had an unrelated TypeScript error. They now resolve moved sidecars, report environment errors separately, and distinguish an unavailable comparison from an API difference.
- Declaration twins, semantic fuzz checks and emitted-import setup could reject the same exported API over declaration spelling; they now share the API identity checker, preserve frozen package-alias resolution, and report the changed export with its `tsc` diagnostic.
- The no-match fuzz corpus reported an unexpected pass after the empty-message `TypeError` fix. It now checks that behavior without an obsolete exception (VIP-7, chapter 4).

- Loader cache tests now cover explicitly included hidden native additions after warm hits, alongside visible-source and existing-file controls; missing invalidations are tracked explicitly.
- A plain function expected to return an Effect typed its body by the Effect's success, so `probe: () => Effect.succeed({ kind: "a" })` widened the literal and failed with TS2375 where the same TypeScript compiled; the body now gets the Effect as its contextual type.
| `when C(let x):` on a class without its own matcher | `EK0704`: `vibelang --fix` writes `when C and { … }:` for the written fields. |
- A class pattern over a value it could never test compiled and failed at run time: `when Point(let x):` on a class without its own matcher reports `EK0704`, and the quick fix and `vibelang --fix` write the bare class test with an object pattern. A callee whose return type fits no pattern, or with no call or construct signature, reports `EK0702`, and `when Function:` reports `EK0107`.
- Literal `__proto__` keys in patterns compiled despite the grammar restriction; they now report `EK0707`, while computed keys and binding shorthand remain valid.
- A finite match containing only a primitive constructor arm could compile as exhaustive; it now reports `EK4701` until literal, binding or `default` arms cover the remaining cases.

- A toolchain upgrade could accept a failed VIP migration after its partial edits made ordinary checks pass. It now stops before the candidate build and rejects failed or interrupted finishing receipts as later baselines.
- A pattern's optional property, `{ a?: 1 }`, and its member forms `this.#field` and `super.name` were syntax errors; they now compile as the pinned proposal says. A literal `__proto__` key and a rest pattern that is not last report `EK0707` instead of compiling or reporting `TS1005`.
- Schema fields without `readonly` incorrectly produced readonly keys, including nested object fields; they now produce writable keys, while explicit `readonly` and direct schema-error payload defaults keep their meaning. To retain older implicit readonly schema keys, run `vibelang -p tsconfig.json --fix --fix-migration-only`. The upgrade writes explicit `readonly` keys or preserves an explicit Effect codec when a source modifier cannot retain its decoded-key flags.

- Programs created or reconfigured through the compiler API lost parsed `vibe` settings, so severity overrides and disabled Effect globals or modules stopped applying; both API paths now retain those settings.

- The `Option.gen` quick fix could close iterators that native Effect leaves suspended on `None`; a delegated yield inside an active `for...of` body now keeps the diagnostic and explains why it needs a manual rewrite.

- `EK4402` told a `.vibe` file to use `NodeHttpServer.layer(createServer, { port })`, whose `createServer` it may not import; `ExperimentalNodeHttpServer.layer({ port })` now supplies it, `EK4402` names it, and the HTTP guide no longer needs a `.ts` companion file.

- An animation frame timestamp earlier than its starting clock produced a negative delta; `Experimental.Animations.frameDeltas` now clamps negative deltas to zero.

- A service-default editor repair could rename the declaration while leaving aliased, parenthesized, union-indexed or instantiated type reads broken; it now retains `EK4855` with a manual-repair explanation and offers no partial edit.
- `new f()` on a function declared in a `.vibe` file reported the retired `EK1020` and hid TypeScript's errors. It now uses TypeScript's constructor checks alone, including assertions and `@ts-ignore`.
- Resolved schema-binding regressions still appeared as pending gaps; namespace, function and escaped-name coverage now checks `EK2109` strictly while keeping every keyed corpus.
- Schema library-alias checks now compare array decoding and mutability with native TypeScript and explicit Schema controls; remaining decoder gaps keep precise pending records.

- Contextual `do` regression checks now retain the wrong-tag counterexamples alongside valid results.

- Mixed interruption fuzz programs no longer put `restore` directly in a concurrent item; their masks use the existing helper-function form.
- The ast-grep library and npm package kept only the original parser, omitting additional registered grammars; builds now include every parser in `tree-sitter.json`, and migration registers the `.vibex` parser when the installed compiler supplies it, with JSX-only rules kept on the JSX parser.

- CI could fail to load a migrated local lint plugin when a GitHub workflow ran `vp check` or `oxlint` directly; setup now preloads `vibelang/register` in those workflow commands, retaining their flags and existing `NODE_OPTIONS`.

- After migrating a local Oxlint JS plugin, lint reached ESLint and failed with `ERR_UNKNOWN_FILE_EXTENSION ".vibe"` because only Oxlint preloaded the loader; setup now registers `vibelang/register` in each generated ESLint command too, including on repeated setup.

- Specification test gaps were not inventoried consistently. The repeatable census now distinguishes passing, pending and missing tests, honors reviewed exclusions, and preserves chapter/VIP rule-name links after rewording.
- The specification still listed `EK2007` for a legacy `for...of` or `for await` over a `Stream`, though the compiler keeps those loops native and reports `EK0102` for a `for await` in effect code; the specification and the diagnostic registry no longer list it.
- The editor declined to convert an `async` function returning a fresh object with an explicit noncallable `then` data property, such as `{ then: 7 }`; it now offers that conversion.
- In `(a catch h) catch k`, when `h` gave an Effect, the outer `catch` kept that Effect as a value instead of running it, so `Effect.fail(0) catch (() => Effect.fail(1)) catch () => 7` succeeded with an unrun Effect; the outer `catch` now runs what the inner one gives and the result is `7`.
- A Vite app whose workspace dependency started a worker failed to parse the worker’s `.vibe` imports. Migration setup now follows local dependency chains and adds `vibelang()` to the app’s `worker.plugins` factory.
- A shared package-release helper using arrow functions to map import conditions crashed on migrated targets with `value.replace is not a function`. Setup now recognizes these mappers and preserves the helper’s JavaScript and declaration paths.
- Migrating a returned `Effect.callback<A, Error>(...).pipe(...)`, such as Foldkit’s WebSocket acquisition with timeout handling, failed the style gate despite keeping its original error channel; the flow now proves channel-preserving pipe stages while still refusing discarded, nested, async, generator and changed-channel results.
- An optional tuple element in the error or requirement slot of an Effect type, such as `number!([string, boolean?])`, parsed wrongly and declared a malformed tuple; it now declares the same tuple as `Effect.Effect<number, [string, boolean?]>`.
- Build entry globs could emit empty chunks from generated `.d.vibe.ts` files beside the source outputs; the Rolldown plugin now excludes those sidecars from single, array and named entries, including `tsdown` builds.
- Knip could hide an unused export when an ordinary comment followed `@public`; the adapter now preserves that comment and Knip applies the same attachment rules as for TypeScript.
- Knip marked later names in a `@public` variable declaration as unused; all bindings in that declaration now keep the marker.

- Plain error getters and methods whose computed name is a branded `"_tag"` could bypass the reserved tag check. They now receive `EK2117`, including literal template and string mapping variants. The class repair preserves compatible branded members and leaves native-resolved instance tag accessors and methods for manual repair instead of introducing TypeScript errors. Fieldless repairs also preserve their constructor declarations.

- Initialized `_tag` fields, accessors and static members in an `error` or `schema error` could compile or report duplicate or unrelated diagnostics; they now report `EK2117`, and `--fix` retains previously valid implementations in explicit Effect classes.
- A typed `_tag` field in an `error` or `schema error` could override the generated tag contract or report unrelated TypeScript errors; it now reports `EK2117` at the field name, and `vibelang --fix` retains compatible contracts and schema-family registration in an explicit class.


- Formatting service and error declarations with comma separators could report overlapping edits; each separator is now projected once, preserving adjacent comments.

- Invalid TypeScript `module` forms reported broad or misleading errors. They now report the specific `EK4001`–`EK4004`, `EK4006` or `EK4008` diagnostic; TypeScript namespace spellings keep `TS1540` alone (VIP-40).
- The editor refused renames and import organization in files with TypeScript `module` bodies. These operations now work across the body boundary and preserve identifier specifiers (VIP-40).
- Published declaration checks rejected harmless formatting, quote, import-order and member-order differences; `scripts/api-identity.mjs` now compares exported names, their types through `tsc`, and their doc comments.
- Writing a separately documented `type X = typeof X.Type` beside `schema X` reported a duplicate type; one exact, nongeneric alias now replaces the generated type in either source order, keeping each declaration's documentation and exports (VIP-15, VIP-27, foldkit-9).

- JSX source files did not activate or reach VibeLang's VS Code language server as `.vibex` documents; the `vibex` language mode now selects the JSX parser and provides component and prop completions, hovers, diagnostics, definitions and paired-tag rename.

- Invalid `for concurrent` limits could produce a TypeScript argument error or pass unchecked; they now report `EK1907` consistently.
- The language-server smoke test rejected a correctly formatted multiline `withSpan` call; it now checks the effect block and arguments across line breaks while rejecting changed program shapes.


- Producers accepted erased return annotations and rejected valid `Stream` contracts; written `Stream` aliases now compile with their yield, error and requirement channels checked, and invalid contracts report `EK2102`.
- ESLint could not parse JSX in `.vibex` files; JSX now uses TypeScript-compatible trees, tokens and scope analysis, React and Solid rules run on the source, and lint setup and Knip include `.vibex` files.
- In the editor, an `is` that binds names and has a parenthesized subject, such as `(x as T) is [let a]` or `([3, r] as const) is [let n, let e]`, made the TypeScript 7 mapper report "invalid or overlapping edits" and pass the whole file through unchanged, so the editor checked VibeLang syntax as TypeScript; the file now maps as it does without the parentheses.
- Migration returned converted services to TypeScript when every member kept the original service requirement. Verification now accepts the `EK4809` design warning and preserves those member contracts; a configured `EK4809` error still fails.
- Declarations of imported Effect values could gain an extra import; cold values and decoders now have regression comparisons against TypeScript.
- After VIP-1, `vibelang --fix --fix-vip-only` could not see that a method of a service read as `const fs = FileSystem.FileSystem()` ran where it stood, so it refused the whole file's migration (`EK9202`) and left functions such as foldkit's `readLiveRecordFile` plain, building their reads at the call and skipping their later steps; it now writes `try FileSystem.FileSystem` and runs each such method with `try`.
- A `match` whose last arm lacked its `;` beside a `do` could crash the compiler (`slice bounds out of range`) instead of reporting `EK0701`; a lowered `do` temporary no longer gets a range that ends before it starts.
- A native build or copy could replace a working compiler with a file that could not execute, even though the writer reported success; publication now requires a nonempty regular executable and preserves the previous binary on failure.
- The snippet tools' pending-output test fixtures could discard their logging effects and falsely fail retirement checks; their executable entry points now run the logs, so exact output retires and mismatches remain pending.
- Computed fields in `error` and `schema error` declarations were treated as uninitialized class properties; they now become readonly constructor fields, including symbol keys. Computed `_tag` overrides still report `EK2117`.
- A misspelled snippet-page filter or an empty documentation root could return success for zero pages and replace earlier receipts; both snippet commands now exit `2` before setup or writes when no Markdown page is selected.
- The match examples for schema guards and extractor counts failed in the Effect runner with `Not a valid effect`; their entry points now explicitly return Effects.
- Verifying a migrated package could reject the flow's new `.npmignore` and packing receipt as foreign files when its first emit happened after codemod. Packing ownership now stays in the batch journal through verification, recording and revert; unrelated files still fail the scope check.
- The Bun preload guide promised a whole-project type check, including native TypeScript tests; it now describes the preload's `.vibe` checking scope and directs you to `vibelang -p tsconfig.json` for a complete project check.
- Moving a checkout with a committed loader record changed ordinary string values containing the old checkout path; records now relocate only structured file paths and source-map sources, preserving the emitted program bytes.

- Migration setup rejected an emitting project built by bare `vibelang -b` or `vibelang --build`; it now recognizes their default `tsconfig.json` while still refusing unrelated projects.
- Migration setup rejected projects containing `.d.vibe.ts` sidecars because those files emit no JavaScript; it now excludes declaration inputs and preserves them unchanged.
- Specification rules could change without an executable example in the same entry; the new `//:spec-rule-evidence` check reports the affected sentence and requires a relevant compiler case or a compiled Effect TypeScript twin with matching declarations.

- A misspelled compiler-case option, such as `--isolatd`, was silently ignored and could erase the original case output; unknown switches now exit with status `2` before running a case or changing its files.
- Browser and signal examples rejected the runtime's Effect `4.1.1` after the upgrade; their package pins now match the runtime.

- A `.vibe` file that read `window.crossOriginIsolated` or `navigator.userAgent` got `EK4402` with no service to use; `Experimental.BrowserInfo` now reads them, `EK4402` names it, and `ExperimentalBrowserServices.layer` provides it.


- The fibers guide suggested Effect-body repairs inside ordinary async functions; it now shows `runPromise` bridges that run in the original Promise context.
- Only the first `catch` outside effect code in a file reported `EK0504` and `EK0509`; every later one went unreported, and `vibelang --fix` had no repair for its value fallback. Every catch is now checked.
- Awaiting a Promise, Effect or ordinary value inside effect code could report a retired await diagnostic; every operand now reports the assigned placement error `EK0102`, while native `async` awaiting keeps its behavior.

- Switching an existing native project to the VIP-1 compiler left service lookups such as `try RuleContext()` unchanged and failed the upgraded build; the migrate flow now asks the new compiler to finish failing projects before that build, after the predecessor migrates inferred function kinds.
- Switching an existing native project to the VIP-1 compiler left service lookups such as `try RuleContext()` unchanged and failed the upgraded build; the migrate flow now asks the new compiler to finish failing projects before that build, after the predecessor migrates inferred function kinds.
- The `EK0509` repair of an object-literal value fallback, `x catch { directory }`, wrote `() => { directory }`, a block that returns nothing, and refused with `TS2322`; it now writes `() => ({ directory })`.
- After VIP-1, `vibelang --fix --fix-vip-only` left a call that ran inside a catch's head cold, as in `decode(fs.readFileString(path)) catch …` (`TS2375`, `EK9202`); it now writes the head as the program it was, `(effect { return decode(try fs.readFileString(path)) }) catch …`.
- A migrated package whose `files` list shipped only `dist` could install with an export pointing at missing `.vibelang/js/` JavaScript and fail with `ERR_MODULE_NOT_FOUND`. The migrate flow now includes the emitted runtime and loader records in its packing policy while preserving private-file exclusions.
- The native resource example in the denied `using` proposal omitted acquisition and disposal from its Effect TypeScript counterpart; it now keeps the native `using` declaration in the outer generator.
- Migration could reject a retained schema class for its constructor warning; regression properties now keep the exemption limited to the correct class and file.
- `vibelang --fix-vip-only` refused a function that called a method on a legacy service call and used the result, such as `const digest = (Hasher()).digest(input)` before `digest.slice(…)`: it wrote `(try Hasher)` but no `try` for the method's Effect, so the file's other `try`s were refused too and `EK4802` became an error. It now writes `try (try Hasher).digest(input)`, as the old compiler ran it.
- `vibelang --fix-vip-only` refused `fork(call(n), { startImmediately: true })` in a function it marks `effect`: `fork` is reserved there, so the text read as `fork` over a comma expression, `EK1703`, and every `try` in the file was refused. It now writes `try Effect.forkChild(call(n), { startImmediately: true })`, the Effect form `fork` stands for, which takes the options.
- `vibelang --fix-vip-only` refused a call that ran inside an argument passed by name when that argument also held a plain function, such as `failureOf(toCommandSchema(ref, sync(() => Schema.suspend(() => { throw e }))))`, and made `EK4802` an error. It now writes the effect block, `failureOf(effect { return try toCommandSchema(ref, try sync(…)) })`. It still refuses when the written function's own body holds a `try` or a call that gives an Effect.
- `vibelang --fix-vip-only` refused a file with a literal handler that gives a plain value where the parameter expects a function that returns an Effect, such as `(caught) => caught.message` passed to `Effect.catchTag`: the handler stayed plain, a `TS2769`. It now writes `effect (caught) => caught.message`, so the value is the handler's success, as it was before VIP-1.
- Class-only modifiers on schema fields were silently ignored; they now report `TS1070`, and `vibelang --fix` removes the ignored tokens without changing the codec.

- A guarded `do` body such as `x !== undefined && do { x.length }` could report that `x` was possibly `undefined`; `&&`, `||` and `??` now retain the source guard’s TypeScript narrowing, evaluate the left operand once and still invalidate narrowing after an assignment.
- A `.vibex` file (VIP-39: VibeLang with JSX) failed with `TS6054`; the compiler now reads it as VibeLang parsed as `.tsx`, so JSX and VibeLang forms mix in one file. Imports of `.vibex` modules, editors and bundlers follow in later VIP-39 slices.
- Under `bun --preload vibelang/bun`, a package export that the migrate flow routed to emitted JavaScript gained an undefined `default` key when its source had no default export: the preload loaded the emitted file as a re-export that always ended `export default source.default`, so opencode's CLI `run` entry had 3 keys instead of 2 and its exact-keys test failed. The re-export now has a `default` only when the source module has one, so the namespace matches what Bun gives the source without the preload.
- The migrate flow wrote each package's loader record right after emitting and routing that package, so a later package's routing changed a `package.json` an earlier record named, and that record missed on every cold start (opencode's `ai` package, 76 `.vibe` modules, after `schema` was routed). The flow now writes every record after all packages are emitted and routed, then checks each against the final tree with the new `checkLoaderRecord` in `vibelang/project`, and the emit receipt names any record that misses.
- Declaration parity checks could report success and overwrite prior receipts when a selector matched no cases; they now reject empty or unmatched declaration selections before setup.
- Concurrent migration batches could restore another package's files to their old bytes after it reported successful fixes; restoration now stays inside each compiler source graph, and overlapping graphs take turns.
- A `private` or `protected` member named like a member of the error base, such as `private message: string`, in an `error` or `schema error` body reported TypeScript's `TS2415` at the declaration's name beside `EK1304`. It now reports `EK1304` alone.
- The nested-mask and restore-region compiler fixtures retained an older Effect dependency after the runtime upgrade; both now use the runtime's supported version so validation tests the installed runtime.
- Declaration parity checks discarded named local export aliases and could report renamed public exports as identical; they now compare those exports alongside their declarations, including names that coincide with imported bindings.
- The restore-region validation fixture called its service key as `Svc()` and failed with `TS2348`; it now reads it with `try Svc`, preserving the expected values across `provide` and interruption scopes.


- Migrating an Effect pipeline could change its public declaration from an expanded intersection to a named alias, as in opencode's reconnect service; the quick fix now keeps the native `.pipe(...)` when uncurrying a stage would change inferred type names.
- After VIP-1, a `catch` passed where an Effect is expected, as in `FiberMap.run(map, key, (effect { … }) catch effect (e) => …)`, ran instead of being passed, and `vibelang --fix --fix-vip-only` left it; the migration now writes it as `effect { return … catch … }`, the program the old compiler passed.

- Contribution and maintainer guides directed work straight to `main`; they now describe landing on `vibe` and advancing `main` only through passing post-merge checks.
- Adjacent `data` variants and payload fields reported a TypeScript semicolon error. They now report `EK1605` and offer a quick fix to insert `;`.
- An arm that used `not`, or `and` with two tests, counted toward exhaustiveness, so `match (x) { when true and true: 1; when false: 0; }` compiled; such an arm now covers nothing, and the match needs another arm or a `default` (`EK4701`).
- The migrate flow could not load from a staged copy of `.smithers`, as a toolchain build stages it: `source-paths.mjs` imported `minimatch` from `node_modules`. The flow now ships minimatch in `lib/vendor/`.
- The migrate flow's `verify` failed a batch when the flow had just written a loader record (`.vibelang/js/.loader/`), calling that record a foreign file; the flow now treats everything under `.vibelang/js/` as its own output.
- The migration codemod rewrote a migrated module's written `./c.js` or `./e` import of a module that stays TypeScript to `./c.ts` or `./e.ts`, so the package's published `.d.ts` no longer matched the original (18 of foldkit's 225 declarations); it now keeps every written specifier of an unchanged module and rewrites only a renamed module's name to `.vibe` (decided detail 272).
- `vibelang --fix` removed an `effect` import that the module's declaration needed, because the prelude supplies the name, so a published declaration changed: imports moved, and an inferred `Schema.String` became an `import("effect/Schema")` type (Smithers: 9 modules). `--fix` now keeps such an import in its place, under every compiler option, and still removes one the declaration is the same bytes without, such as `import { Option } from "effect"` beside `Option.Option<number>`.
- A `do` in a destructuring assignment default, computed key or target could run before the right side, even when a supplied value skipped the default; assignments now preserve native destructuring order and run defaults only when needed.
- After VIP-1, `vibelang --fix --fix-vip-only` left three pre-VIP-1 forms failing: an arrow such as `(text: string): number!! => parse(text) catch () => 0` (`EK0504`), a `catch` in a plain factory or at the top level (`EK0504`), and a function literal passed as a program, such as `forkIn(scope, () => work())` (`TS2345`). It now marks the arrow `effect`, writes the plain `catch` as `effect { return … catch … }`, and writes the literal as `effect { return try work() }`.
- A `match` with an arm `[]` beside a `do` arm ending in an array, such as `when Option.None: []; when Option.Some(let link): do { …; [href, text] }`, failed with `TS7034` and `TS7005` on a generated `$do` variable, and so did `[]` in a property written before a `do`, as in `({ undoStack: [], grid: match (…) { … } })`; the `[]` is now an empty array literal, typed as it is written in place.
- A branded string wrapped in a template key or a string mapping could bypass the `_tag` check on a `schema error` method or getter and make construction throw; it now reports `EK2117` when the runtime key may be `"_tag"`, and `--fix` keeps the explicit class without cycling back to the rejected declaration.

- Migrating an already routed package could replace a nested `types.default` declaration path with runtime JavaScript, hiding its API types; `types` and `typings` now keep declaration paths through nested conditions and fallback arrays.
- Renaming a source to `.vibe` left a literal Vite build entry pointing at the missing `.ts` file, so a compiler-clean migration could not bundle; the migrate flow now follows library, Rollup, Rolldown and pack entries to the renamed source, records them for `revert` and interrupted-run recovery, and warns about computed paths it cannot rewrite.
- After the migrate flow renamed an entry point such as `scripts/generate.ts` to `.vibe`, package scripts still ran `node --import vibelang/register scripts/generate.ts` and failed with `ERR_MODULE_NOT_FOUND`. The codemod now points each script at the `.vibe` file, and `step revert` points it back.
- A `do` expression in a dynamic `import()` argument could emit invalid JavaScript by capturing `import` as a value; dynamic imports now keep their native syntax and evaluate the specifier and options in source order. Computed `super` references also keep their native syntax. With TypeScript checking disabled, `delete` of a `do` result emits valid JavaScript.
- Migration could widen a shared file-selection regex and change an unchanged assertion’s result; the codemod and `verifyTestDiff` now refuse named regexes with any assertion or other use not proven to select filenames (decided detail `272`, `RD-022`).
- Under Vitest with the Vite plugin, a `.vibe` module's dependency loaded through its package's `module` export, which is often bundler-only ESM, so Node failed with `Cannot find module` or `Directory import … is not supported` (Smithers: `@opentelemetry/api`, 64 tests in 5 packages). The plugin no longer adds `module` to Vitest's conditions; Node loads the dependency through its `default` export, as without the plugin.
- Renaming a module that called a native helper returning an Effect added an `Effect` import and changed its public declaration; an unmarked function now keeps TypeScript's inferred `import("effect/Effect").Effect<…>` spelling.
- An `is` whose pattern both tests and binds a nested part of its subject, such as `reasons is [{ _tag: "Fail", error: Oops and let error }]` or `x is { inner: { key: let key } }`, did not compile (`TS2552: Cannot find name '$match6'`), and its JavaScript assigned an undeclared name, so it threw a `ReferenceError` instead of matching. The compiler now reads that part through one name, and the `is` matches as the same pattern in a `match` does.
- Async conversion could change how a JavaScript `try` statement handles rejection or leave a `using` resource undisposed; the editor now leaves these bodies for an explicit handler and cleanup rewrite.
- The grammar admission fuzzer reported `throw { p = 1 };` and `effect[a];` as forms with no grammar authority. It now counts `TS1312` (`p = v` in an object literal) as the grammar rejection it is, and reads `effect` before `[` as a keyword only on an interface or type literal member, so `effect[a]` is an element access.
- Grammar-admission fuzzing could not read `import "m";` or `import M;` after Appendix A folded VIP-40's side-effect import into its TypeScript import production; it now reads both.
- Grammar-admission fuzzing now groups a trailing `!` in a type alias inside a block, `{ type T = number ! string ! }`, with the known trailing-bang gap.
- Grammar-admission fuzzing now groups an Effect type slot that starts on the next line, `number ! string !` then `boolean`, with the known line-break gap in Effect types.
- Grammar-admission fuzzing read `f<T>` as an instantiation expression only before `;`, `)`, `]`, `}` or `,`, so `C<T> ?? x` looked like an undefined form. It now follows TypeScript's rule: any binary operator, or a token that starts no expression, may follow.
- Grammar-admission fuzzing could not read any `import` declaration after Appendix A wrote VIP-40's `ImportDeclaration` as a production with a prose alternative; it now reads that alternative as TypeScript's import with a module specifier.
- The grammar-admission tests still expected `M {}` to be grouped as a trailing block after VIP-11 retired trailing-block parsing, so they failed; the dead grouping is gone, and the compiler's `EK1101` rejection is what the tests check.
- Grammar-admission fuzzing required a literal `;` after a bodyless `effect function` overload signature, so a signature ended by a line break looked like an undefined form. It now applies semicolon insertion there, as Appendix A says.
- Grammar-admission fuzzing reported `service S { async static readonly key: string = "k" }` as a form with no grammar authority; it now counts `EK0902` and `EK0901`, the service-member rules, as the rejections they are.
- Grammar-admission fuzzing still grouped mismatches under the retired throw-expression and inline-module keys, which VIP-41 and VIP-40 now admit, so `join effect function f(p) { return throw try p; }` went to the wrong key. Those keys are gone; `effect function* fork() { }` and `for (try join x of xs)` join their families.
- Grammar-admission fuzzing filed `schema error throw { … }` as an unknown form; it is the known bodyless `schema error` gap. `service S { n: number; ; m: string }` is tracked as a known compiler gap.
- Grammar-admission fuzzing kept the Effect reservation inside a nested `async function` or generator, read `provide` as a keyword after `=`, and could not read two service members when the first was a rejected `static` field; it now reads each as Appendix A does. `for (join of of xs)` is tracked with the other `join` loop heads.
- Grammar-admission fuzzing could not read a C-style `for (;;)` loop, a `for-in` loop, an operator after `x as T`, or a contextual word such as `restore` used as a declaration name, so programs with them looked like undefined forms. It now derives them, and counts `TS1247` and `EK4008` as rejections.
- Grammar-admission fuzzing did not read VIP-41 throw expressions or VIP-40 `module` declarations, so it reported `x ?? throw e` and `module M { }` as forms with no grammar authority. It now derives both, and counts `EK1010`, `EK4001`-`EK4003` and `TS1540` as the syntax rejections they are.
- Grammar-admission fuzzing reported `for (fork x of xs)` as a form with no grammar authority; it now counts `TS2487` and `TS2406` (a loop head that is not a variable) as the grammar rejections they are. `for (join x of xs)` and `join [ ]` outside effect code are tracked as known compiler gaps.
- Grammar-admission fuzzing misread angle-bracket assertions and leading `|` in a union type as undefined forms; it now derives them. `function* g() { try 1; }` and `data D { A; ; B }` are tracked as known compiler gaps.
- Grammar-admission fuzzing could not read `match`, `do`, `A!E` operands, error-body methods or any parenthesized type, so it never tested programs that used them. It now reads every Appendix A production and fails if a reworded one becomes unreadable; `type T = A | B!E`, `schema C<T> { a: T }` and a line break after `for concurrent` are tracked as known compiler gaps.
- The grammar admission fuzzer reported `const { p = effect { return 1 } };` as an admitted form with no grammar authority; it now counts `TS1182` (a destructuring declaration without an initializer) as the grammar rejection it is.
- The grammar admission audit missed bare `fork { ... }` bodies that the compiler turns into programs; it now records their missing grammar authority, with keyed pending coverage and controls for explicit `fork effect { ... }`.
- The `using` warning cited a denied proposal as its authority; it now cites the accepted VIP-34 amendment while keeping its code and behavior.
- VIP-39 examples with published prerequisites looked like current-language failures; they now name the pending file-kind diagnostic, and stale markers fail when support arrives.
- Deliberately rejected VIP examples named no diagnostic, and a matching code elsewhere could satisfy a check; examples now state their codes and inline checks require the marked source line.
- Runtime parity reported a missing module for valid `.mts` and `.cts` entry files; it now runs their emitted `.mjs` and `.cjs` files, using the same filename mapping as its emit checks.
- A documentation snippet timeout could leave compiler or test-runner children holding its output pipes open; on POSIX it now stops the owned process group and reports the timeout even when the parent has already exited.
- The mapper runtime-parity command printed `FAIL` rows but still exited successfully; it now exits with status `1` whenever a selected case fails.
- A mapper runtime-parity case could pass after printing the expected value even when its process then failed or was killed; it now requires a successful exit and retains the exit cause with the actual result.
- A mapper parity compile or runtime command could outlive its deadline when a descendant held its output pipes, and a parent that exited first could be reported as successful. On POSIX, both parity columns now stop their owned process group at the deadline and report the timeout after draining its output.

- Runtime parity could report a passing result after stock TypeScript rejected a source file, because the failed compile still emitted JavaScript. It now stops before executing that output and reports the compiler's exit status and first diagnostic.

- Runtime parity could not run entry files whose names contained `#`, `?`, percent escapes or a quote; generated imports now preserve the literal emitted filename.

- Runtime parity overwrote an emitted dependency named `run.mjs` with its test runner, causing missing-export errors in valid programs; the runner now lives in a separate directory and preserves compiler output.

- The mapper runtime-parity command succeeded after a misspelled selector ran no cases; an empty selection now exits with status `2` and names the requested selectors.

- Mapper parity reported clean documentation measurements when `--jobs 0` skipped every compiler project; invalid worker counts now exit with status `2` before changing outputs or prior receipts.
| `for try` over an object exposing only the Stream type marker | Supply a complete `Stream.Stream<A, E, R>` implementation. A marker alone now reports `EK2004`; no automatic conversion can supply the missing Stream behavior. |
- `for try` rejected `any`, `never` and constrained Stream operands, while accepting objects with only a Stream type marker; it now checks assignability to `Stream.Stream<any, any, any>` and preserves constrained element types.

- An `is` pattern binding whose name began with `$`, such as `let $id`, could report a missing internal name; source binding names now remain distinct from compiler-generated temporaries, including `const` bindings and escaped identifiers.
- A `var` binding in a match pattern could compile without an error, and an `is` binding could crash the compiler; both now report `EK0107`, with a quick fix and `vibelang --fix` repair to `let`.
- Hovers and offered type edits could print ambiguous `Effect` contracts for union or intersection channels; they now retain the parentheses those channels require.


- An unparenthesized union, intersection or conditional type beside `!` was silently accepted; it now reports `EK0301`, including with `--noCheck`, and `vibelang --fix` inserts parentheses while preserving the existing channels.
- Converting an `async` function could return a boxed object where native async returned its adopted value, even with a primitive return type; conversion now adopts the completed return after body and iterator cleanup, preserving the value and evaluation order.


- A function ending in `return try value` could reject unchecked iterables and skip iterator getters, including a getter on an `Effect`; tail `try` now keeps native delegation, defect identity and evaluation order.

- Runtime parity reported a missing module for valid `.mts` and `.cts` entry files; it now runs their emitted `.mjs` and `.cjs` files, using the same filename mapping as its emit checks.

- The specification listed `EK0204`, a compiler limitation, among the language rules; it now lists it under transitional compiler diagnostics, and the spec linter prevents compiler gaps from entering the normative table.

- Converting an old `async` shorthand named `functionality` could leave an invalid declaration. The editor now inserts `function` for every shorthand name.


- Converting an `async function*` could produce `EK2128` for a return value or change a yielded `Promise` into data. The conversion refactors now apply to ordinary `async` functions.


- Pattern expressions such as `effect is (Number)` and `async is (String)` could report a missing `function` and unrelated signature errors; they now parse as pattern expressions in statements.


- Applying `--fix` or the editor's `EK4843` repair to an exported `const main` or `let main` could hoist it and change a read before initialization from `ReferenceError` to a function. The obsolete entry warning and repair are retired under VIP-26; lexical declarations retain their temporal dead zone and runners remain explicit.

- Spellings of `effect` with Unicode escapes were accepted as function modifiers and blocks; they now report `TS1260`, matching `async`, and the editor quick fix or `vibelang --fix` writes the literal keyword. Ordinary escaped identifiers remain valid.


- The migrate flow's codemod left a test that lists a directory and filters it with an extension regex, such as t3code's React Compiler coverage and dependency-graph tests (`/\.tsx?$/.test(file)`), selecting only `.ts` files, so each migrated module silently dropped out of the check (318 t3code web and mobile modules stayed TypeScript); it now widens that one regex to `/(?<!\.d\.vibe)\.(?:tsx?|vibe)$/`, which selects `.vibe` modules and not their `x.d.vibe.ts` sidecars, when the selected files are the same by base name, and `verify` accepts only that widening.
- The migrate flow's platform split took a type for a value of the same name, so in t3code Desktop's `MacSettingsWindow.ts` (`const Shape = Schema.String` with `type Shape = typeof Shape.Type`) the sibling imported `Shape` as a type and used it as a value (`TS2693`, `TS2345`); the split now takes the value and, since the module's declaration would change, keeps the module's platform code with a named cause.- With `stripInternal`, an `@internal` schema lost both its constant and type alias from declarations; it now drops only the constant, matching the equivalent Effect TypeScript pair.
- `vibelang --fix --fix-vip-only` left a function unmarked when the old compiler made it an Effect function only because a program captured it, as in `Effect.runSync(job)` or `Effect.all([job])`, so the migrated file failed with `TS2345` after the upgrade to VIP-1. The migration now marks such a function `effect`.
- Under `bun --preload vibelang/bun`, `require()` of a TypeScript module that reaches a `.vibe` module through an extensionless or `paths` alias import threw `require() async module ... is unsupported`, as when opencode's plugin loader required a barrel whose schema modules became `.vibe`: the preload rewrote those imports with `Bun.build`, so the module loaded asynchronously. The preload now rewrites them synchronously in the module's source, and `require()` loads the module wherever it loads the module's `.ts` twin. It now also finds a dynamic import with a non-ASCII specifier, such as `import("./leaf-雪")`, and follows `Bun.resolveSync(path, directory)` from that directory, not its parent. A migrated package's emitted `.vibelang/js` file re-exports its native source by an absolute path; the preload now loads that source itself, so a plugin that rewrites the files it sees by absolute path, such as OpenTUI's runtime plugin in opencode's TUI, no longer makes `require()` of the package async.
- A process with a cold compile cache, as in every CI run, compiled each workspace package whose `.vibe` modules it reached, even when the package's current JavaScript was committed under `.vibelang/js/`: opencode's standalone CLI child type-checked five packages, 7 to 13 s each, and its 10 s readiness test failed. The migrate flow now commits a loader record beside that JavaScript, the loader's own compile with every input named by content, and `vibelang/register` and `vibelang/bun` use it in place of the compile while every input holds; any change compiles as before (`writeLoaderRecord` in `vibelang/project`). On POSIX the compile cache also read a backslash in a project's path as a directory separator, so it missed files added to such a project.
- Converting an `Effect.fn` generator could change its declaration parameter spelling, such as `readonly string[]` becoming `ReadonlyArray<string>`; the repair now preserves inferred parameter types, generic arrays and optional callback return types.
- A closure created in a `do` expression in a `for…in` or `for…of` head could read an outer variable; it now keeps the head's uninitialized `let` or `const` binding, separately from each iteration's binding.
- Formatting a `do` expression could fail when dprint inserted an ASI semicolon before its value; the formatter now accepts the empty statement and preserves the block's value.
- The migrate flow's codemod gave a migrated module's `paths` alias to a module that stays TypeScript a `.ts` extension, `~/state/filesystem` becoming `~/state/filesystem.ts`, which the compiler rejects (`TS2877`) under `rewriteRelativeImportExtensions`, so 23 of t3code's 160 web modules went back to TypeScript; the alias now keeps its authored spelling.- With `stripInternal`, an `@internal` schema lost both its constant and type alias from declarations; it now drops only the constant, matching the equivalent Effect TypeScript pair.
- The migrate flow could turn value-only TypeScript helpers, including schema factories, into Effect-returning functions on a legacy compiler; it now preserves their plain declarations before the fix gate and probes the compiler so it never writes legacy annotations after VIP-1.- With `stripInternal`, an `@internal` schema lost both its constant and type alias from declarations; it now drops only the constant, matching the equivalent Effect TypeScript pair.
- A `.vibe` module whose inferred type names a dependency’s internal type, such as `Tabs.create()` from `@foldkit/ui`, failed with `TS2883` when a `.ts` file imported it, even in a project that emits no declarations. Such a project publishes nothing, so its sidecar now names the exact type through its path into `node_modules` and the module compiles; projects that emit declarations still report `TS2883`.
- A migrate flow codemod whose compiler was killed said only `exit 128`, and nothing listed which earlier batch's `.vibe` modules it had put back; the error and the compiler log now name the signal (a timeout still reads `timed out, exit 124`), and `codemod.json` lists the restored modules in `fix.restored`.
- Inferred Effect default properties rejected declarations that already matched their native TypeScript counterpart; they now require raw declaration identity for every previously reported form.
- Signed-zero patterns could call a local `Object.is`, producing incorrect matches or type errors; they now distinguish `-0` and `+0` independently of local `Object` bindings.
- The array literal of `try.all`, `try.race`, `try.any` or `try.allSettled` deferred an element whose argument runs an Effect, such as `try.all [a(try b()), a(1)]`, in `Effect.suspend`, so the literal was not built in element order; every element call now gives its Effect while the literal is built, natively and in element order, with a spread iterated once, as `Effect.all([a(...), ...xs, b()])` builds it (chapter 2, decided detail 252).
- Formatting could remove parentheses inside computed error payload and type-member keys, changing native diagnostics or refusing a return type; those key expressions now keep their written grouping and comments.
- A malformed response could crash the LSP benchmark and leave its compiler server running; it now reports the request and protocol stage, then terminates and reaps the server.
- Documentation hover generation could hang after its language server closed its response stream or sent malformed data; pending requests now fail with their method and protocol stage, allowing server and temporary-project cleanup to finish.
- A plain `catch` handler whose result is a Promise or thenable, such as `x catch (e) => queryDb(e)`, compiled without a diagnostic, so the fallback was a Promise nothing ran; it is now error `EK0507`, and its note points to an effect handler that runs it: `x catch effect (e) => try Effect.promise(() => queryDb(e))`.
- Mapper protocol checks could wait for their timeout after the server closed its response stream, and a later request could wait again. The test client now rejects current and future requests with the method and transport stage, and closes its owned server.
- The mapper hover check could leave its language server running after a successful check, a rejected request or a malformed reply. It now shares the mapper test transport and waits for its owned server to exit, escalating termination if necessary.
- With `import { Effect } from "effect"` in a `.vibe` file, `Effect.Array.head([1])` compiled as if `Effect` were the implicit binding; a written `Effect` binding now keeps its ordinary TypeScript meaning, so that read reports `TS2339`, while the implicit `Effect.Array` and `typeof Effect.Array` still resolve (VIP-14).
- Editor projection could erase `effect` from a pure class method or a named function with an aliased return type; both now keep their Effect bodies, including imported aliases.
- A schema field initializer was silently discarded; it now reports `TS1247`, and `vibelang --fix` removes the ignored expression while keeping its codec, modifiers and comments.
- A `match` over `void` incorrectly required a fallback, while a finite generic constraint could miss an arm without an error; `EK4701` now follows the constraint's finite cases and leaves open subjects unchecked.
- The `EK4855` repair renamed a service `static readonly default` to `defaultValue` and rewrote its value reads, but left type reads such as `typeof Flags.default` and `(typeof Flags)["default"]`, so the repaired file failed with `TS2339`; the declaration now carries one `EK4855` whose fix rewrites every read in the file, type reads as `ReturnType<typeof Flags.defaultValue>`, and a read in another file keeps its own warning and fix.
- A `break` or `continue` in a loop head's `do` could bypass `EK0205` by naming an outer label in a chain on the same loop; every label in that chain now gets the early error, while jumps to a different enclosing loop remain exempt.
- In a project that emits declarations, `vibelang --fix` rewrote `Effect.fn("name")(function* … )` or `Effect.gen` and then removed the now unused `import * as Effect from "effect/Effect"`, so the declaration file imported `{ Effect } from "effect"` instead and the migrate flow's declaration identity gate refused the file. `--fix` now keeps an effect import that the file's declaration file writes, as its prelude rewrites already did.
- A local `break` from `finally` in a `do` expression could retain the `try` or `catch` value. It now carries the finalizer's completion value, including `undefined` for an empty abrupt completion; a normal finalizer preserves the protected value.
- Producers could leak a `Scope` requirement from unions, aliases or structural subtypes; their inferred `Stream` now excludes `Scope` from the complete requirement type, including generics.
- Large `--fix` rounds could stop without saving progress. The fixer now saves verified checkpoints and bounds refusal isolation, so an interrupted run keeps its verified changes.
- The migrate flow's platform split left a module's file-wide directives, such as t3code Desktop's `// @effect-diagnostics nodeBuiltinImport:off`, on the `.vibe` module only, so the `<Name>.platform.ts` sibling that now held the `node:child_process` import reported `EK3877` and the module went back to TypeScript; the sibling now starts with the same directives.
- Loading VibeLang with `effect@4.1.1` failed its version check; the runtime, compiler and starters now require `4.1.1`, and the six `effect/jose` namespaces are available without imports.
- With `stripInternal`, an `@internal` schema lost both its constant and type alias from declarations; it now drops only the constant, matching the equivalent Effect TypeScript pair.
- An `effect` body that ran an Effect failing with `Error | ApiError` and threw an `Error` subclass declared its error channel as `Error`, so a `catch` arm on `ApiError`'s tag failed with `TS2339`; it now declares `Error | ApiError`, as `Effect.gen` infers.
- VIP-25 said inline TypeScript modules were pointless because plain `.vibe` functions have TypeScript's meaning, which Will's 2026-10-31 ruling that plain VibeLang code cannot `throw` made false; a dated amendment now says so, and the denial stands.
- VIP-39 said `App.vibe` beside `App.vibex` always collide with `TS5055`/`TS5056`, though under `"jsx": "preserve"` with declarations off they write `App.js` and `App.jsx`; it now says the pair collides only where both write the same output path, as `App.ts` beside `App.tsx` does.
- VIP-8's Effect TypeScript counterpart dropped the source's `using f = openFile(p)`, so it neither opened nor disposed the file; it now keeps the declaration in the outer generator, as TypeScript's `using` does.
- VIP-33's opening example provided `NodeServices.layer` at a module's top level with no import, a program the spec rejects (`EK1201`, `EK0501`, `TS2304`), and VIP-26's used `NodeRuntime` with no import; both now import the platform package, and VIP-33 provides the layer inside `effect function main()`, as chapter 5 does.
- VIP-1's written-return-type example used the bare type `Effect<User, NotFound, Users>`, which is not a VibeLang form; it now writes `User!NotFound!Users`, as chapter 1 does.
- VIP-5's opening example still used the removed value handler `fetchUser(id) catch guest`, which no longer parses; it now writes `catch () => guest`.
- The specification's `EK1101` trigger, "a `{` on the same line after a name, a property access or a call", read as covering `effect { … }`, `match (x) { … }` and declaration heads, and Appendix C gave the trailing-block denial two repairs where `EK1101` has three; the trigger now excludes every `{` a production reads and Appendix C lists the same three repairs.
- A denied trailing block still became an implicit callback during parsing; ordinary compilation now leaves the call and block to TypeScript, while `EK1101`, `vibelang --fix` and editor quick fixes keep their existing messages and rewrites.
- The specification gave two different spellings for the `effect` import a declaration file adds, `import type { Effect, Stream }` and `import { Effect }`; it now uses the value import throughout, as the compiler and the Effect TypeScript twin's declaration write it.
- The specification said how a declaration spells an import of a `.vibe` module but not of a `.vibex` one; it now gives VIP-39's default, `./x.jsx` under `"jsx": "preserve"` and `./x.js` otherwise, and says the other `declarationImportStyle` settings are not yet decided for `.vibex`.
- The specification applied `vibelang.declarationImportStyle` to every emitted declaration, which left open whether a source-adjacent `x.d.vibe.ts` sidecar changes its `./b.vibe` import; it now says the setting spells package declarations only, a sidecar keeps `./b.vibe` as the compiler writes it, and VIP-27 and VIP-30 publish the option.
- The specification gave `vibelang.declarationImportStyle` a second path, `compilerOptions.vibelang.declarationImportStyle`, two sibling keys (`trustedPackages`, `tracing`) and the TypeScript code `TS6046`, none approved by a proposal; chapter 7 now names only the root key, VIP-30 publishes it, the compiler is unchanged, and `//:spec-lint` rejects a configuration key no accepted VIP names.
- The specification said a relative `./x.ts` import reaches `x.vibe`, a resolution rule no proposal approved; chapter 7 no longer states it, the compiler still resolves such imports, and a new specification linter (`//:spec-lint`) rejects resolution claims VIP-39's table does not list.
- A `do` block ending with `var` compiled even though the pinned proposal rejects it; it now reports `EK0201`, including through empty statements and blocks. A later value expression still allows `var` to hoist.
- A read of `this` before a later `do` could move past `super()`, hiding a derived-constructor error; the read now stays in source order, preserving TypeScript’s diagnostic and native `ReferenceError`.
- Anonymous functions and classes captured around `do` could acquire private compiler names, and lifted object properties lost their source names; value-only positions now stay unnamed and property initializers keep their names before class static initialization.
- A missing or failed stock compiler could leave a migration with no original declaration oracle while verification still passed. Published modules now require an available oracle, and mixed TypeScript/VibeLang packages can record one for their remaining TypeScript sources.
- The migrate flow's declaration gate compared each batch with declarations vibelang emitted from the unchanged sources, so where vibelang emitted a module's declaration wrongly or not at all (alchemy's `Pipes/builders.d.ts`, `TS5088`), a batch that migrated that module passed as identical; setup now also emits the declarations with the repository's own `tsc`, `tsgo` or `tsrs`, and verify fails a batch that migrates a module whose native declaration differs from them.
- The migrate flow could record a conversion that marked a plain function `effect`, so the call returned a program instead of its value (alchemy's `effectClass` broke every `class X extends effectClass(…)`) while types and declarations stayed unchanged; `verify` now fails a batch whose `effect` function was plain in the original and returned a value or did work at the call.
- After switching to another VibeLang compiler with the same TypeScript version, an incremental or `--build` check reused the previous compiler's cached result, so it could exit 0 where a fresh check reports errors (foldkit: `EK4402` on `import.meta.hot`). Build info now records the compiler's build, and a different build checks the project again.
- Repeated `readonly` modifiers in schema fields were silently accepted; they now report `TS1030`, and `--fix` removes the duplicate without changing the codec.
- Helper re-export declaration properties required a manually configured compiler path; they now use the built checkout compiler by default and retain an explicit `VIBELANG_BINARY` override.
- Incremental diagnostic properties required a manually configured compiler path; they now use the built checkout compiler by default and retain an explicit `VIBELANG_BINARY` override.
- Incremental artifact identity properties required a manually configured compiler path; they now use the built checkout compiler by default and retain an explicit `VIBELANG_BINARY` override.
- Formatting service members or class-form `error` fields separated by commas could fail with an internal parse error; the formatter now accepts their separators and keeps nested type commas and comments intact.
- Checking an incomplete service in the editor, or with `noUnusedLocals` enabled, could panic; unsupported call and construct signatures now report `EK0902` while unused private implementation members are still checked.
- A resize observer could remain allocated when the browser rejected its first target; `Experimental.ResizeObserver` now disconnects it when the scope closes, including after setup fails.
- Waiting for a pending browser commit or animation frame required a plain host callback; `Experimental.Animations.nextFrameUnless` now checks and registers atomically inside a cold Effect, with cancellation on interruption (decided detail 261).
- Browser file reads could report an unexpected result exactly like a host error; `Experimental.FileReader` now identifies unexpected results with `InvalidData`, preserving the origin even when the cause and message coincide.
- A valid severity override could still fail compilation because an overridden base entry was invalid; only effective severity entries now report `EK3006`, and valid overrides allow emission again.
- With a repeated configuration key, an invalid-value error could underline the earlier valid value; it now points at the last value that the config uses.
- ESLint reported `no-constant-binary-expression` on a valid `is` pattern with bindings, such as `outcome is Exit.Failure(let cause)`; generated binding steps no longer look like constant expressions, and constants written in source still get the rule.
- Overlapping native builds could fail while writing the dprint plugin because they shared one temporary zip file; each build now prepares its own archive before publishing it.
- Tuple rest schemas rejected qualified or renamed library arrays and accepted local type shadows; they now resolve library bindings consistently, retain rename references, and offer a preserving `--fix` for old shadowed spellings.
- Readonly-record schemas rejected qualified or renamed library types and could accept shadowing types; both names now follow their library bindings, and `--fix` preserves previously accepted codecs.
- Renaming a type binding could leave its generic schema uses unchanged, selecting a different decoder; Rename and Find References now include those uses in their original type scope.
- Organizing imports deleted type-only schema bindings, producing or hiding `EK2109`; organize-imports and remove-unused actions now keep the necessary bindings and remove aliases unused in that scope.
- Renamed or qualified `Record` schema types were rejected with `EK2109`; they now use the resolved library record decoder and preserve writable decoded keys.
- Schema array types rejected renamed or qualified library types, and an imported `Array` could silently use the wrong mutability; they now select the codec from the resolved library binding and retain it when expanding a schema through a quick fix.
- A failed source setup could delete the previous local starter while copying or rewriting its replacement; setup now prepares the replacement first and restores the previous starter if publishing it fails.
- Nested objects and index signatures inside a `data` payload were made readonly implicitly; they now keep their written TypeScript mutability.
- A direct `schema error` payload reference could silently make a readonly key writable or a required key optional; incompatible decoded-key flags now report `EK2109`, and `vibelang --fix` preserves the existing codecs in an explicit Effect TypeScript class.
- A `yield` inside a producer's `for concurrent` body was rejected or omitted from its element type; item bodies now emit from and contribute their types to the enclosing producer.
- ESLint reported `no-unexpected-multiline` at a closing brace after some `is` patterns, such as `value is if (true)`; subject-capturing patterns now keep their own source form in ESTree, so generated matcher invocations produce no call warnings and written calls still report normally.
- Commas between payload fields in `error` and `schema error` bodies reported `EK1013`; they now separate readonly constructor fields, including optional fields and trailing commas.
- Tagged error patterns from nested Effect modules rejected independently branded errors; all thirty-three retained error patterns now use their module guards, including singleton extraction and failed arity mismatches.
- Reading a producer's `yield` result exposed a queue-offer boolean; a completed offer now gives `undefined`, as the language specifies.
- Producers accepted `yield*` even though delegation is not specified; it now reports `EK2103`. Native generator delegation keeps its ordinary behavior.
- A timed-out `cache-loaders` validation hid which engine and cache mode failed; each child now records its stage, elapsed time, termination reason and partial output.
- `vibelang-format` and the editor moved a comment written after a `for concurrent` or `for try` head in front of the head, turning `for concurrent /* note */ (const x of xs)` into `for /* note */ concurrent (const x of xs)`; the comment now stays after `concurrent`, its limit, or `try`.
- `vibelang --fix` refused old VibeLang's `x catch throw e`, as in Smithers' `FileRouter.vibe` `catch throw readFailure()`: the `EK0509` repair wrote `x catch effect () => try throw e`, which does not parse. It now writes `x catch effect () => throw e`, which fails with `e`, typed, as the old fallback did.
- Narrow hosted CI checks installed Chromium even when none of their targets used a browser; reviewed selections now skip browser setup after verifying their complete dependency plan, while browser and unfamiliar selections keep it.
- Two members on the same line without a separator in `error`, `schema error` or `service` bodies produced unrelated TypeScript syntax errors; they now report `EK1306` or `EK0908` at the next member, with a quick fix that inserts `;` before its comments.
- Formatting JSDoc such as `@internal` on an empty statement could attach it to the following declaration or refuse the file; formatting now keeps the statement and its comment together.

- The ESLint corpus check rejected two deliberately malformed compiler and editor fixtures as regressions; it now verifies their exact intended syntax errors and rejects changed or missing errors.

- Producers accepted `yield*` even though delegation is not specified; it now reports `EK2103`. Native generator delegation keeps its ordinary behavior.
- A timed-out `cache-loaders` validation hid which engine and cache mode failed; each child now records its stage, elapsed time, termination reason and partial output.
- `vibelang-format` and the editor moved a comment written after a `for concurrent` or `for try` head in front of the head, turning `for concurrent /* note */ (const x of xs)` into `for /* note */ concurrent (const x of xs)`; the comment now stays after `concurrent`, its limit, or `try`.
- Formatting an `error` or `schema error` with empty `;` members could fail or move JSDoc to the next member; formatting now preserves the comment attachment and removes only empty members with no attached JSDoc.


- Migration setup could leave a native type exported through a TypeScript namespace barrel as an error type in project-aware linters; setup now enables source declaration redirects in owned configs and records those edits.
- A package built with `tsdown` could fail to parse migrated sources because setup omitted its plugin; setup now wires every static config and local config factory, and installs the plugin in the owning package.
- A migration batch could commit an earlier batch's module or an unrelated test that a fix rewrote. Verification and recording now reject files outside the batch and its recorded codemod edits.
- Migrating a package with wildcard exports could add a new public `.platform` module, as Alchemy's AWS platform splits did; the flow now refuses that split before writing files, and the declaration gate rejects new published `.d.ts` files.
- A `service` method with no return type reported `EK9205` even with `noImplicitAny` off, and `read(): any` was rejected; an omitted member type now follows TypeScript as in an interface (`TS7010` for a method and `TS7008` for a property under `noImplicitAny`, `any` otherwise), and VibeLang adds no diagnostic of its own (VIP-9 amended).

- Programmatic Rolldown builds and exported plugin sets could not bundle migrated modules, including Alchemy's lazy bundles and framework adapters; setup now wires the native plugin into supported calls and typed plugin factories, preserves test-pinned plugin positions, and installs runtime dependencies for published code.
- A held union of Effects could be rejected even though every alternative was an Effect; `try` now accepts it and preserves every success, error and requirement type.
- A catch-handler quick fix could remove `async` or `*` and leave invalid `await`, `yield` or result types; it now declines those repairs and explains the required explicit rewrite.
- The install site named an unpublished compiler version and native Windows packages; it now uses npm’s published version and platforms, with WSL guidance until Windows packages are published.
- Migration could leave `.ts` build entries pointing at renamed files when a configuration was outside `src`; batched codemods now wire owned configurations and retain that wiring on resume and revert.
- Unparenthesized execution expressions before `**` reported a native TypeScript diagnostic; they now report `EK0510` with an editor action and a preserving `vibelang --fix` repair to add parentheses.
- The migrate flow could borrow a callback's `Error` channel from an `async` function or generator, even though that function returns a `Promise` or iterator containing the Effect; only a plain function returning the Effect directly now supplies that proof.
- A plain function's `for…of` combined a body error with an error from the iterator's `return`, changing the caught value; it now keeps the original thrown value by identity, as TypeScript does. A close error still replaces a normal `break` or `return`.
- Expanding selection in `schema` and `data` declarations, `match` and typed `catch` expressions could return a range larger than its parent; selection ranges now stay nested around source syntax.
- A migrated workspace could check the same projects repeatedly while missing a `.vibe` file outside its original build graph; migration setup now combines the authored roots and every uncovered source owner into one build, and rejects an unowned source file.
- Repository Node loaders could receive raw `.vibe` modules before VibeLang compiled them; migration setup now registers VibeLang after the repository's ESM loader hooks so native compilation runs first.
- Migration setup silently missed plugin extension regexes that skipped `.vibe` modules; it now warns with the filter’s file and line before those modules lose their transforms.
- A migration's generated `.platform.ts` sibling and rewritten TypeScript imports could fail the repository's format check before record ran; the codemod now formats its authored files with the target's formatter and records its files, exit status and log; returning a module to TypeScript restores its import formatting too.
- The migration could select modules that an unchanged test bundles without native support, then fail that test after renaming them; inventory and both plan modes now retain the reachable source graph with its test and entry as evidence, and rename checks reject stale plans. Bundles already supplied a native adapter or emitted JavaScript remain eligible.
- Reverting a migrated module skipped saved imports in consumers that were already `.vibe`, replacing an alias such as `@/a.js` with a different name that could cause `TS2877`; revert now restores those consumers' original imports while retaining source names in newly migrated consumers.
- A Node or Bun child started by a package's source code could not import migrated modules, especially with another working directory; migration setup now adds absolute native preloads to typed source children and keeps built JavaScript invocations unchanged.
- Migration setup rewrote shell probes and built-program launches that could not name typed source, activating unrelated changed-file lint failures. It now leaves finite non-source arguments untouched and removes its own earlier unnecessary wiring while preserving launchers that may need a source loader.
- `vibelang --fix` left an `Effect.fn` generator with an `Effect.fn.Return<A>` return type, one that reads `import.meta`, and one at a plain member such as `Context.Reference`'s `defaultValue`. It now converts each.
- `vibelang --fix` left `try (x |> Effect.provideService(%, Key, value))`. It now writes a `provide` block.
- `vibelang --fix` left `onSome: Effect.succeed` as EK4301. It now writes `(value) => Effect.succeed(value)` at a plain member, and `try withSpan(p, "name")` where it wrote an arrow the gate refused.
- Native loops over values that also implement `Stream` were rejected or rewritten to consume the `Stream`; they now keep native TypeScript diagnostics and the written JavaScript iteration protocol.
- Migration could break a plugin host that derives virtual module names from a resolved package entry and source-file extension; scope planning now keeps the observed packages native and records the source-enumeration cause, preserving the unchanged host.
- The migrate flow rejected a native acquisition's unchanged `!Error` contract when its original function returned `Effect.callback<A, Error>`, as in foldkit's WebSocket example; it now recognizes that explicit returned channel when the callback becomes a platform service, while nested callbacks and changed contracts remain rejected.
- Switching between two pre-VIP-1 toolchains ran the earlier compiler's `--fix-vip-only` and changed pure `.map` callbacks into Effect functions; the migrate flow now probes both compilers and runs that migration only from pre-flip to post-flip, recording why it skips a switch or a failed probe in `vipFixes`.
- Node and Bun imports could fail when `TMPDIR` named an absent application directory; compilation and the default cache now use an existing parent without creating that application directory.
- A direct `Option.match` call reported `EK4839` as a choice made with Effect's `Match` functions, and the diagnostic tables omitted it; the message now names `Option`'s own `match` API, and the tables include direct calls and explain when their fix is refused.
- A declaration sidecar left imports unresolved when a relative filename contained quotes or Unicode escapes; sidecar imports now resolve the decoded filename and keep valid escaping and the declaration's quote style.
- An explicit `./model.vibe` import or re-export could make stock TypeScript read an unrelated `model.ts` or `model.d.ts` sibling and report `TS2322`; declaration sidecars now keep the explicit `.vibe` target, while native imports keep their native target.
- A closure created in a plain `for...of` loop's iterable expression could read an outer variable when the loop declared the same name in a destructured `let` or `const` head; it now captures the loop's uninitialized head binding and throws `ReferenceError`, as in TypeScript.
- Retired `await.all`, `await.race`, `await.any` and `await.allSettled` spellings in async code produced an unrelated parse error; they now report `EK1802` with async-context guidance and no effect-only automatic rewrite.
- Documentation generation formatted the same declaration signatures again for re-exported aliases; each checker now reuses their formatted text while producing the same inventory.
- `vibelang --fix` deleted comments from legacy diagnostic maps, including empty maps and entries superseded by modern settings; it now keeps every comment in direct and extended configs, with the same settings and a stable second run.
- A `continue` to an earlier label in a chained `for...of`, such as `outer: inner: for (...)`, compiled to JavaScript that Node rejected; every label now stays on the loop, so labeled `continue` and `break` keep their TypeScript behavior.
- Migration setup could rewrite an `oxlint` package name in release dependency data. It now redirects executable lint commands while preserving package data.
- Renaming a repeated `is` binding could also change reads of an outer parameter or local after a failed pattern; the quick fix and `vibelang --fix` now preserve those fallback reads.
- Schema declarations rejected named, optional and rest tuples, including rest arrays written as `readonly T[]`, with `EK2109`; they now preserve their written positions using Effect's tuple schemas, optional positions accept explicit `undefined`, and invalid element order keeps TypeScript's diagnostics.
- The migrate flow's `setup --no-wire` crashed with `RangeError: Maximum call stack size exceeded` when a run combined an already wired package with a new one; setup now wires the new package using the ordinary package-wiring rules, preserves existing wiring, and changes nothing on the next run.
- The migrate flow planned a file that the repository's own code finds by its name, such as `alchemy.run.ts`, so `alchemy dev` found no stack after the rename; such a file now stays `.ts`, and the plan says which file names it.
- The specification's grammar gave `a catch () => b |> % + 1` two parses with different results: the pipe inside the arrow handler's body, or the pipe applied to the whole `catch`. It now has one, the handler's body, as the compiler already reads it; write `(a catch () => b) |> % + 1` to pipe the recovered value.
- A pipe followed by a conditional, `x |> f(%) ? 1 : 2`, compiled as `x |> (f(%) ? 1 : 2)` without a word, although the pinned pipe proposal rejects a conditional at either end of a pipe; it is now `EK2301` at the `?`, which says to write `(x |> f(%)) ? 1 : 2` or `x |> (f(%) ? 1 : 2)`, and `vibelang --fix` writes `x |> (f(%) ? 1 : 2)`, the meaning it had.
- `vibelang --fix` could keep a repair that turned one existing error into two when one kept its message and the other kept its span; each existing error now accounts for at most one error after the repair, while changed messages and spans moved by edits still match.
- The pattern-binding chapter cited unpublished decision numbers for binding homes and redeclarations. It now links a public VIP-7 amendment stating those same rules.
- Native `await` warned about empty tuples, containers and objects with only a `Fiber` or `Deferred` marker; the warning now requires the corresponding interface, so these ordinary values compile even when the advisories are promoted to errors.
- Parenthesized arrow handlers after `catch` could be returned as function values or lose their parameter types; they now receive the failure and run as handlers.
- A typed catch clause whose binding destructures, such as `catch ({ id }: NotFound)`, crashed the compiler and the editor with `Unhandled case in Node.Text`; it now reports `EK2112`, suggesting `catch (e)`, and its quick fix leaves the pattern alone.
- Bundling a package that mixed `.ts` and `.vibe` modules could include two copies of a shared service or schema, so a built CLI failed at startup although its tests passed. The bundler plugins now select the package's `vibelang-source` exports and preserve the bundler's existing conditions, keeping one source graph.
- Under `module: Preserve`, a declaration printed inferred prelude types as `import("effect/Layer").Layer` even when the source used `Layer`; it now imports the written module names as the equivalent TypeScript does, including when the package leaves its module type implicit.
- A `.vibe` module that imported a native `.tsx` sibling under `jsx: preserve` named a missing `.js` file in its emitted JavaScript; imports and re-exports now name the sibling’s actual `.jsx` output.
- Interrupted migration fix passes could leave changes in earlier modules. They now restore sources outside the selected batch before reporting failure.
- JSX attribute diagnostic `EK0402` lacked its VIP-39 cross-reference; the catalog now attributes the rule to both VIP-4 and VIP-39.
- Formatting a file containing Unicode line separators in the editor could add indentation that disappeared on the next format; `U+2028` and `U+2029` now give stable indentation in one pass.
- Formatting `effect` or `do` blocks with comments before `{` could fail; their header comments and the line breaks needed to parse the block now survive formatting.
- The CLI guide described added declaration imports as following only the first import's quotes; it now includes an earlier export specifier and the double-quote default when neither exists.
- A `.vibe` or `.ts` file that kept its `./target.ts` import after `target.ts` became `target.vibe` failed with `TS2876` under `rewriteRelativeImportExtensions`, and rewriting the import to `./target.vibe` changed the published declaration; the written `./target.ts` now compiles, emits `./target.js`, and stays `./target.ts` in the declaration.
- Migration scope planning could change a native bundle input path when an unrelated module migrated; packages with protected bundle input paths now stay as TypeScript with a named cause.
- A `data` declaration's declaration file differed from what TypeScript declares for its Effect TypeScript counterpart, so a migrated tagged union failed declaration identity: it declared the constant first, as `Data.TaggedEnum.Constructor<Delivery>`, and every field `readonly`. It now declares the type first, each field as written, and the constant with the type TypeScript infers, `Data.TaggedEnum.Constructor<{ readonly _tag: "Waiting" } | …>`, then a generic one's `WithGenerics` interface before its constant. **The `.d.ts` text of every exported `data` declaration changes**; the types are the same. Write `readonly` on a field whose TypeScript was `readonly` or wrapped in `Readonly<{ … }>`, which the migrate flow's identity gate reads as `{ readonly … }`.
- In a project that emits declarations, `vibelang --fix` rewrote a private schema type used by an exported interface, changing `Schema.Schema.Type<typeof Meta>` to `typeof Meta.Type` in its declaration file; `EK4832` now preserves that spelling for private aliases and interfaces too.
- Awaiting a `Fiber` or `Deferred` in effect code showed extra configurable warnings; it now reports only `EK0102`, with a working `join` or `Deferred.await` repair.
- The schema mapping table did not distinguish a local type named `Record`, `Array`, `ReadonlyArray` or `Readonly` from a library built-in; it now requires the resolved library type binding and specifies `EK2109` for a shadowing type without a decoder.
- The schema declaration rules left unclear which emitted declaration owns its documentation; JSDoc and visibility tags now explicitly belong to the schema constant, and the generated type alias stays bare.
- Seven setup guides described adjacent `.d.vibe.ts` declarations as a future feature; they now link the current sidecar workflow, including emission under `--noEmit` and TypeScript's `allowArbitraryExtensions`.
- The matching guide said every other `is` binding reported `EK4703`; it now keeps the precise unsupported-home list and the per-iteration `while` scope rule.
- Package verification could crash when a migrated private import became a condition object; setup now unwraps migration targets before the existing publication path mapping.
- Aliased imports of migrated modules failed with `TS2877` when extension rewriting was enabled; migration now uses a relative source name for the same module and preserves the configured option and original alias for revert.
- `vibelang --fix` left `yield* Effect.gen(…)` half converted: it rewrote the inner generator, then refused the outer one with EK4616, because it wrote `try (effect { … })`. It now writes `try effect { … }`.
- The tooling emit-name rule promised only `.js` declaration imports even for packages selecting another style; it now separates runtime JavaScript from the approved declaration spelling.
- The resolver reference left linked packages and `preserveSymlinks` ambiguous; it now classifies TypeScript's final path and includes aliases, JSX sources and mapped sidecars.
- The tooling reference treated explicitly listed sidecars like discovered outputs; it now specifies `TS5055` input protection and the independent compatibility write under `noEmit`.
- The migration inventory omitted the retired global `Effect<A, E, R>` alias; it now documents `EK4856`, its identity-safe repair and coordinated removal.
- The codemod reference did not bound writable files; it now limits fixes to owned program sources and eligible configs, with only the proved fresh platform-companion exception.
- The match reference claimed strict binding types under every compiler option and used unchecked extraction reads; it now follows project options and expresses proven presence without erasing actual `undefined` payloads.
- The module guide implied explicit `Effect` imports gained `Array` and other collision modules; it now explains the implicit qualifier and explicit aliased-import form.
- The service reference could be read as requiring a separate Effect or return-type diagnostic; it now states TypeScript's ordinary implicit-`any` checks and the option-off behavior.
- The migration reference could turn a successfully returned error into failure or start a returned Effect; it now distinguishes legacy wrapper removal from an intentional run and never guesses an `asEffect()` conversion.
- The diagnostic reference described `EK9204` only on old `try` statements; it now also explains valid infallible `catch` expressions and rejects interim codes in modern severity settings.
- The function specification left recursion's stack behavior unstated; it now distinguishes JavaScript's plain-recursion limit from stack-safe Effect recursion.
- The specification left cyclic declaration output ambiguous; it now defines the retained `/*elided*/ any` output and keeps ordinary recursive-inference errors.
- Compiler cases returning large Effect values could fail because their runner exited before printing the complete result; it now flushes the result and failure details before exiting.
- Awaiting a Fiber or Deferred in effect code reported an error using the configurable warning codes `EK4609` and `EK4610`; it now reports the fixed placement error `EK0102` separately, so advisory severity settings keep their meaning without allowing `await` in effect code.
- `vibelang agents check` could report `no errors` and succeed when its compiler failed or was terminated; checks and hooks now fail with the compiler's status, signal or spawn error and standard error output, including failures caused by errors outside the selected files.
- Formatting a labeled arrow statement failed with `formatting changed the program`; labels now keep their arrow body under semicolon-free formatting, and written empty labels stay intact.
- Formatting a returned function type removed written parentheses and changed published `.d.ts` files; the formatter now keeps those parentheses and their enclosed comments, including nested and generic function types.
- An `is` that binds names in a `for (init; test; update)` head reported `EK4703`; the bindings now live in the head as chapter 004 states (decided detail 240): a binding from `init` is copied into each iteration like a `let` declared there, and a binding from `test` or `update` is a cell of each iteration, which a read in `update` cannot see initialized (`TS2454`). A `var` or `using` initializer still keeps `EK4703`.
- An `is` that binds names in a `match` arm or in a class field initializer reported `EK4703`; the bindings now live in the arm, which is its own scope, or in the initializer's own scope, as chapter 004 states.
- Code with two `is` patterns binding one name in one block compiled when each `if` head was its own scope; it now reports `TS2451` (or `TS2300` beside a parameter), and the diagnostic offers to rename the later binding and its uses, and `vibelang --fix` applies the rename (chapter 004, decided detail 245).
- An `is` binding in an `if` head was scoped to that `if` alone, so `if (!(x is { id: let id })) return; use(id)` reported `EK4703` and `||` or nested conditions could not bind; the bindings now live in the block that holds the `if` (chapter 004, decided detail 245), an unbraced body is its own block, a `for concurrent` limit may bind, and two patterns binding one name in one block report TypeScript's `TS2451`. A binding written `const` keeps const immutability: an assignment to it is TypeScript's `TS2588`.
- An `is` that binds names in a variable statement, an expression statement, a `return`, a `throw` or a concise arrow body reported `EK4703`; its bindings now live in the block that holds the statement, or in the arrow body (chapter 004). Unsupported homes retain `EK4703`; formal-parameter and enum initialization use `EK0705`.
- The migration's ESLint bridge rejected `declare const` symbol brands used only through `typeof`, which Oxlint accepted; the mapped `no-unused-vars` rule now counts those reads and retains configured options and unused-declaration reports.
- Conversion examples changed exported Effect values into functions, breaking callers that passed them directly to runners; all five affected examples now keep lazy Effect-valued `const` exports.
- Conversion examples dropped explicit service keys, so existing providers could no longer satisfy migrated programs; examples and migration prompts now preserve the original runtime identities.
- Migration instructions still avoided service-key lookup and native time/randomness calls after their blockers were fixed; they now teach the supported forms and keep the injected-service testing recommendation.
- The known-limitations page incorrectly said stock TypeScript could not resolve `.vibe` imports; it now explains the implemented declaration-sidecar route with `allowArbitraryExtensions`.
- The platform crypto example passed raw bytes as algorithm-bearing keys and omitted its encryption inputs; it now uses native Effect key types and declares every input.
- A restarted whole-scope migration repeated completed work and could record a misleading green result; it now banks packages, retains timeout and root-cause receipts, follows resolved path strings, regenerates through repository hooks, emits declarations with `--singleThreaded`, and checks nonempty test results against main and the previous commit in one job.
- The migrate flow could refuse a small scope because an unrelated source imported more than `240` modules; bounded fix shards now contain only selected sources and their dependencies, and full-project checks still cover the other files.
- Whole-repository migrations needed local drivers and could report success after a failed rollback; the migrate flow now plans one scope batch, fixes bounded dependency-ordered shards, and reverts by cause until every project is clean against its baseline.
- A resource accepted by a union's data member could still report `EK4301` when an inferred type argument ruled out its generic callable member; member matching now uses the completed call's inference, including arrays and later callback arguments.
- After the migrate flow renamed a module to `.vibe`, an importer that named it through a tsconfig `paths` alias, `@/composer/schema`, kept that spelling, which the project’s `bun check` script invoking stock TypeScript cannot resolve (`TS2307`); the codemod now writes `@/composer/schema.vibe` there too, as for a relative import, and `revert` puts it back.
- Migration verification could call declarations identical after their compiler failed; it now rejects every nonzero declaration emit and retains option-level errors.
- A `.ts` declaration that named a type it reached through a package's `.vibe` module wrote a relative path into the package, `../../lib/src/x.js`, or failed with `TS2883`, once the bare specifier resolved to the `.vibe` source: the declaration emitter matched the module only against an export's emitted JavaScript. It now names the module by the export that selects it, `import("lib/x")`, when that export lists the source under `vibelang-source` or its `x.d.vibe.ts` sidecar under any condition, in exact and pattern entries (opencode's core: 1,478 `TS2883` in 110 files).
- Packing a migrated package could leave its installed exports pointing at `src/*.vibe` or `.vibelang/js` even though the package shipped only `dist`. Setup now adapts publication helpers that map TypeScript source exports to built paths, preserving their existing `dist/*.js` and `dist/*.d.ts` exports for migrated entries.
- Migrations could accept changed APIs in private workspace packages; `--include-private-declarations` now checks their declarations and emit errors too.
- Native builds and copies could report success while leaving the executable path as a directory and putting the binary inside it; they now report the directory collision and preserve its contents.
- Passing an Effect function to a `Function` destination could bypass `EK4301` after generic union matching; callable destinations now keep the synchronous-callback check.
- A migration left a repository’s lint configuration naming `x.ts` after the module became `x.vibe`, so a rule the repository had turned off for that file came back. Setup, the codemod and `revert` now keep literal Oxlint and ESLint paths pointing at each module, and setup repairs paths that earlier runs left behind.
- Migration codemods could stall on brace-heavy literals or broaden a test selector; source-name wiring now scans source inventories with cached, bounded matchers and proves the final selected filenames and counts unchanged.
- `vibelang --fix` moved a TypeScript call out of `Effect.sync(() => label())` into an `effect` block, where EK4401 refused it and the whole file stayed unconverted. The thunk now stays, because it is the boundary that makes the call's exceptions defects.
- The shipped skill taught `fork.in(scope)`, `fork.scoped` and `fork.detached`, which the release compiler could not parse; its examples now use `try Effect.forkIn`, `try Effect.forkScoped` and `try Effect.forkDetach` instead.

- `vibelang --fix` rewrote an `error` with a `static` member or setter (`EK1302`) into a `Data.TaggedError` class that no longer matched a value of the same tag from another copy of the package, so a `match` arm such as `when E` silently fell through. The class now extends the runtime `TaggedError` shim and keeps cross-copy matching.

- A `private`, `protected` or `public` `_tag` property, or `_tag!`, in an `error` or `schema error` body reported TypeScript's `TS2415`, `TS2564` or `TS2612` about the generated class next to `EK2117`. It now reports `EK2117` alone.

- A `schema error` method or getter whose computed key had a broad type, such as `string`, compiled even when the key was `"_tag"`; constructing the error then threw `TypeError: Cannot set property _tag`. Such a key is now `EK2117` unless its type excludes `"_tag"` (a literal, a symbol, a number or a template such as `` `x-${string}` ``), and `vibelang --fix` keeps an existing member in an explicit Effect TypeScript class.

- `vibelang --fix` could remove an explicit `<{}>` payload from a fieldless `Data.TaggedError` class, changing its published declaration. Projects that emit declarations now keep the class and receive an explanation instead.
- Reverting a migration importer before its dependency could replace an original `.js` import with `.ts`; either revert order now restores the original specifier.
- Switching migration toolchains could absorb newly failing tests or compiler errors into a passing baseline; the flow now rejects the switch and retains its before-and-after evidence.
- The migrate flow rejected harmless formatting of existing `.vibe` tests; it now accepts it only when both the parsed AST and token stream preserve the test, and lists these files under `formatter-only` in the PR proof.
- The migrate flow rejected a package test’s expected dependency list after setup added `vibelang-runtime`; it now allows exactly that addition when the pinned package manifests prove the dependency was gained, and disclose each assertion edit separately.
- The migrate flow rejected test path strings that only followed a source-file rename; it now proves the path resolves to the migrated file, including static path builders, while keeping modules as TypeScript when tests assert on their source text.
- A migration batch could pass after changing its tests or fixtures, hiding a regression; the migrate flow now verifies every edit against detail 272's exceptions, with same-module and filesystem-path rename proofs, exact-set selector checks under the target tool's glob rules, and separately disclosed dependency assertions, refuses `async` or generator filters that would select extra files, checks again before committing, and reports the proof for the pull request.
- The migrate flow's declaration snapshots failed with `TS5051` for valid projects using `inlineSources`; declaration-only emission now disables all source and declaration map options together, including inherited settings.
- `--fix` could leave statement-position `Option.match` calls unchanged after a parser refusal; it now writes a valid block and preserves callback order.
- Migrating a Match return-type hint could insert an `as` assertion that the repository's lint rejected; the quick fix now preserves checked type annotations, including destructured bindings.
- Migration staging could put a local tarball in optional package contracts; only direct runtime and development dependencies now receive the staged tarball.
- `try (try e)` ran one Effect: the parser read the outer `try` away, so `try (try Env)`, for a service whose value is a program, gave the inner program unrun, and its fields were TS2339. Each `try` now runs one Effect, since `try e` is `yield* e`. This changes existing code: `try (try load())` where `load()` gives no program used to compile and run `load()` once, and is now EK0502.
- Interrupted migration codemods could lose their rename, import or platform-split bookkeeping; the flow now journals every mechanical write before it starts and safely resumes or restores the original source.
- The spec chapters never mentioned the accepted `.vibex` file kind (VIP-39), nor that `./x.js` resolves to `x.vibe` after `x.ts` and `x.tsx`. Chapter 7 now has a `.vibex` section with the resolution table, and the intro, chapter 1 and Appendix A name `.vibex`.
- VIP-39 didn't say whether a JSX attribute or tag is checked against VIP-4's thrown-type rule for function types. It now says an attribute is an object member, so a foreign handler with `@throws {Error}` is `EK0402` against an untagged `onClick`, and a tag's check against `JSX.ElementType` is not such a site.
- The spec's `EK0510` row named only `try`, `fork` and `join`, so `try.all [a] ** 2` and `fork.scoped e ** 2` had no code. Chapter 2 and Appendix B now name all ten execution heads.
- VIP-39 didn't say what runs first when a `do` that `return`s sits in a JSX attribute after other attributes. It now says the tag and everything before the `do` are evaluated first, once, in source order, as for any other operand.
- VIP-39 promised that renaming a `.vibe` file to `.vibex` changes nothing unless it has `<` in expression position, but a project without a `jsx` setting reports `TS6142` at every import of a `.vibex` file, and `preserve` writes `x.jsx`. The promise is now about parsing, and names both settings.
- VIP-39 said only `<` in expression position reads differently in `.vibex`, but TypeScript's JSX scanner also reads `</` as a closing-tag token, so `a </b/.source.length` and `when </b/:` don't parse there. A new clash row says to write a space: `a < /b/`.
- VIP-39 grouped `react-native` with the JSX modes TypeScript transforms, though `react-native` keeps the element in its output. It now groups `react-native` with `preserve`: the framework's compiler decides when a `try` inside the element runs.
- The migrate flow's setup left a build script that only runs `tsc` through Bun's shell, such as opencode's codemode `` $`bun tsc -p tsconfig.build.json` ``, on stock `tsc`, so the published `dist/index.js` imported `./codemode.vibe` and failed to load once installed; setup now runs `vibelang` there too, which writes `dist/codemode.js`, and adds `vibelang` to the package's `devDependencies`.

- A service declared inside a generic function or class could write member contracts in terms of the outer type parameter (`value: T`, `take(v: T)`, `load(): T!!`, or through an alias or a member-local constraint) and compiled, so every specialization shared one key; it now reports `EK3005` naming the member and the captured parameter, while member-local generics, unused generic arguments and concrete services in generic scopes still compile (decided detail `183`).
- Adding a host interface augmentation in a `.ts` file disabled platform diagnostics for constructors such as `XMLHttpRequest`; those references now keep `EK4402`, while local and imported bindings still shadow globals.
- Parenthesized provider expressions could be split into several providers or mistaken for service bindings; `provide (a, b)` now uses the comma expression's value, and parenthesized assignments keep their ordinary meaning.
- A provider list split beside a comma could compile silently; both comma-adjacent breaks now report `EK1202`, with a safe fix when comments permit joining the lines.
- Reading `Effect`, `Layer`, `Schema` or `Scope`, or writing an Effect type contract, reported missing names without `vibelang-runtime`; code that only needs native Effect namespaces now resolves with `effect` alone.
- A `provide` head whose last provider was parenthesized, as in `provide (LA), (LB) { … }`, failed with `TS1005: '=>' expected`, because the body's `{` read as an arrow function missing its arrow; a parenthesized provider followed by `{` now opens the provide body, as the grammar's `Provider` (a ConditionalExpression) allows.
- A missing `vibelang-runtime` was reported twice when a `.ts` import and generated `.vibe` helpers referenced it; mixed projects now report the missing package once and keep independent TypeScript errors.
- A project that resolved an `effect` other than the pinned 4.1.1 compiled, and its first Effect-typed use then failed with unrelated type errors; the compiler now reports one `EK3201` naming the resolved version, the VibeLang release and the pin.
- `sh scripts/build-vibelang.sh` built only `packages/compiler/native/vibelang`, while the compiler case harness runs `typescript/built/local/tsc`, so cases run after a rebuild tested an earlier compiler and passed or failed for the wrong code. The script now installs the same binary at `typescript/built/local/tsc`, and the harness warns when that binary is older than a compiler source.

- A service with no body, a `declare service` or a service in a `declare namespace`, and two service members on one line with no separator reported TypeScript syntax errors or nothing; they now report `EK0906`, `EK0907` and `EK0908`, and `EK0908`'s quick fix inserts `;`. The separator repair preserves the following member's comments and `@throws` JSDoc.
- Malformed service keys used the old diagnostic or accepted template literals; they now report `EK0901` and require `static readonly key` with a quoted string literal.
- Bodyless service members accepted class-only syntax or raised unrelated TypeScript errors; they now report `EK0902`, with a quick fix that keeps comments and the written contract.
- TypeScript consumers could not name an exported service's `S.Shape`; declarations now include that namespace alias and a shared private member type, preserving recursive, default and nested service shapes (VIP-9, VIP-27; detail 181).
- A service copied into a `const` or object property bypassed its `new`, `extends` and `instanceof` diagnostics; typed aliases now retain the service's restrictions, as direct references do (VIP-9).

- Listing a `.vibe` source and its declaration sidecar explicitly in `files` silently overwrote the sidecar; the compiler now reports `TS5055`, exits `1`, and preserves its bytes, including in `vibe.sidecarDir`.
- `vibelang --fix` refused to annotate the first of two `Config` helpers that a plain function calls, so neither helper was fixed: the function's one `EK9203` moved with the edit and named the second call, which the gate read as a new error; a span after or before a fix's edits in the file it edits is now compared where it lay before them.
- The migrate flow's test gate passed a batch whose Vitest tests all passed but whose run exited nonzero, such as on an unhandled error: it compared equal to a baseline that exited 0. An exit status that turns nonzero is now a regression even when every test passes.
- Vite could invalidate a module immediately after serving it when the compiler wrote a generated `.d.vibe.ts` declaration; those output events now leave the served module and its importers cached, while real source edits still trigger hot updates.
- Recording a migrated module could reject portable Monaco model URIs such as `file:///src/ui/message.ts`; the path guard now rejects only URIs under known machine roots.
- Migration reports omitted deliberately retained type-only Effect modules; reports now list them and keep the full ownership and test inventory beside the automatic candidate count.
- Typed lint could lose native-module types for tests outside the main TypeScript project; migration setup now connects those tests to their existing complete test project without editing tests.
- Switching migration toolchains could replace a published package's VibeLang peer range with a local tarball; peer ranges and optional metadata now stay intact while installed dependencies update.
- Migration rejected private adapter declarations when a package exported a hand-written `.d.ts` outside its build output; the flow now snapshots and resolves those shipped roots, admitting private additions while rejecting changed public bytes or resolution.
- Migration rejected native `throw new Error(...)` even when a function preserved its original global `Error` failure channel; the style gate now keeps `EK4804` as an advisory for that written contract, while rejecting TypeScript-style Effect forms.
- The migrate flow's planner refused a Vite config, `packages/website/vite.config.ts`, even after setup had wired the package's Vite scripts with the native config loader, so the config stayed TypeScript; a config wired that way is now a candidate, the codemod points the scripts at `vite.config.vibe` with `--config`, and revert restores them.
- Migration plans rejected `.mts` sources; ESM packages can now migrate them to `.vibe` and revert them with their original imports and entry points. Unsafe CommonJS boundaries are reported before files move, also when an interrupted codemod resumes from its saved state.
- Migration reports could call an unchanged failing test baseline a pass; reports and commit summaries now retain the actual failing status and test names.
- Migration could record missing build outputs as pre-existing test failures and later test stale distributions; upgrade, setup and verification now run declared build prerequisites, retain their source and dependency evidence, and refuse an unprepared failing baseline.
- The Foldkit guide showed only the small example app inline; it now also compares four excerpts from Foldkit's own migrated source with their originals.
- `a catch () => b |> % + 1`, `x |> % catch () => y |> % + 1` and `1 |> effect () => % |> [%]` each had two parses in the spec. A pipe after an open arrow handler now belongs to the handler, and an `EffectArrow` is an arrow for the pipe-body restriction.
- Six VibeLang syntax rules had no code in Appendix B. They are now `EK0109`, `EK0202`, `EK0512`, `EK1505` and `EK1606`; the compiler moves to them with its pending cases.
- The spec said `S.Shape` is undeclared for a local service, against VIP-9. A local service now names `S.Shape` inside its own members, and uses `Context.Service.Shape<typeof S>` elsewhere.
- An `is` binding in a `for concurrent` limit or a catch parameter had no home in the spec. A limit binding belongs to the home around the loop, and a catch-parameter binding is `EK0705`.
- Two `is` tests that bind one name in one block had two readings. The spec now makes them a redeclaration, `TS2451`, with a `vibelang --fix` rename; the compiler still accepts them until that work lands.
- The spec put an `is` binding in an unbraced loop body in the enclosing block, which would initialize one cell once per iteration. An unbraced statement body is now its own home, so braces never change a result.
- `EK2202` named only a `for concurrent` body, so `restore` in a head default slipped past the written rule. The rule now names head binding initialization too; the compiler does not report the code yet.
- `--fix-migration-only` and `--fix-vip-only` appeared in the tooling chapter with no accepted VIP. VIP-34 now records both.
- The spec listed four Effect subpath namespaces that share a web platform name. It now lists `KeyFormat` and `Transferable` too; both keep their DOM meaning in a bare type position.
- The spec gave `when Option.Some:` two readings in an exhaustiveness check. It now says a bare fixed pattern covers its case, which is what the compiler does.
- The developer tools guide did not show how Foldkit's real migration covers `.vibe`; it now lists its lint, format, dead-code, type, docs, build and test integrations with pinned configuration links and coverage limits.
- Migration setup left root `tsrs` and `tsgo` typechecks on their old compiler, so converted files could be skipped or require an extra check of unrelated projects; it now runs `vibelang` with the original project arguments, including separate test projects.
- `EK4401` reported a call of a TypeScript function that returns an `Effect`, a `Stream` or a `Layer` wherever no `try` ran it, such as an operand of `Effect.all`, a `provide` list or an array. Such a function can't throw (VIP-4), so its call is allowed wherever it stands. A return that is only partly one, such as `Effect<number> | undefined`, stays tracked.
- `vibelang --fix` left `EK4401` on a plain call of a `.ts` module or package whose exceptions nothing lists, so a migration kept the module in TypeScript. In effect code it now writes `try Effect.orDie(Effect.try({ try: () => f(x), catch: (error) => error }))`, so an exception stays the defect it was in Effect TypeScript and the declaration doesn't change; in a function with no Effect operation it writes `: infer _`, which keeps the function plain. Neither form trusts the code, and `EK4806` no longer warns about that `catch`, since nothing reads what it returns.
- Unchanged tests that bundle package sources through Rolldown or Vite's bundled config loader could not load migrated `.vibe` dependencies. Migration setup now supports `--emitted-project` to generate exact private import conditions for JavaScript produced by the package's existing build, while preserving test commands, consumer exports and published declaration bytes.
- A `.vibe` module that imported or declared a name the prelude gives an Effect module, such as sst's `Resource`, and read it in an Effect function compiled, then failed at load with `Identifier 'Resource' has already been declared`: the emit also imported `effect/Resource` under that name. A local declaration or import now shadows the module there too.
- A build script that ran `` $`bunx tsc --emitDeclarationOnly` `` before its `Bun.build` wrote no declaration for a module the migrate flow had made `.vibe`, so opencode's http-recorder build failed `ENOENT … dist/index.d.ts`; setup now runs `vibelang` there, as it already did in package.json scripts.
- The migrate flow's setup left an electron-vite config's `main`, `preload` and `renderer` builds, and a Vite app's worker build (`new Worker(new URL(...))`), without `vibelang()`, so those builds failed on a `.vibe` module (`PARSE_ERROR`); setup now adds the plugin to each of them.
- The migrate flow's codemod renamed a tracked module under a `.gitignore`d directory, so the batch's commit deleted the `.ts` and recorded no `.vibe`, and a revert left the `.vibe` behind; the codemod now refuses that batch before it changes anything.
- The diagnostic reference could make an emitted `EK3008` look unknown; it now explains that this static service-key error corresponds to the specification's `EK0901` until compiler renumbering.
- The Chapter 15 compiler regression could fail with `moved: "none"` on a busy host; its deadlines now run on `TestClock`, preserving timeout and cleanup ordering independently of host timer dispatch.
- Running `vibelang lint` could create or overwrite declaration sidecars and incremental build information; lint now checks the project without writing output files.
- After the migrate flow's setup, an ast-grep rule for TypeScript also scanned each `.vibe` module's `x.d.vibe.ts` sidecar, so a finding in a `.vibe` module was reported twice; setup now adds `**/*.d.vibe.ts` to the `ignores` of each TypeScript rule it extends to `.vibe`.
- Under the `vibelang/bun` preload, every resolution Bun made, a bare `effect/package.json` included, ran a JavaScript callback, so opencode's TUI plugin test took 34 s instead of 1 s; the preload now handles only resolutions of a path.
- In a Bun build, importing `./x.js` from a `.vibe` module could make the VibeLang plugin claim an `x.ts` or `x.tsx` when another directory contained `x.vibe`; the hook now claims only the VibeLang modules it serves and leaves TypeScript resolution to Bun.
- With `noUncheckedIndexedAccess`, `Option.Some`, `Exit.Success` and `Result.Failure` pattern bindings could gain `undefined` and reject valid code; fixed extractors now preserve their payload types, including through import aliases.
- Moving a repository the migrate flow had partly migrated onto a newer toolchain left its `.vibe` modules for the new compiler alone, which cannot recover a VIP migration only the earlier compiler knows (VIP-1's unmarked Effect helpers); `upgrade-effect` now runs the installed compiler's `vibelang --fix --fix-vip-only` first and commits its edits with the switch.
- The examples, the app template, the Vite plugin's README and the style guide wrote trailing blocks such as `it.effect("loads") { … }`, which VIP-11 denied; they now pass the block as an argument, `it.effect("loads", effect () => { … })` and `Layer.effect(Users, effect { … })`.
- VIP-11 denied trailing blocks, yet `Layer.effect(Users) { … }` and `it.effect("loads") { … }` still compiled silently as calls with an arrow argument; code that compiled before now has a compile error, `EK1101`, at each trailing block, and `vibelang --fix` writes the block as the call's last argument with the same runtime behavior.
- An `effect` function that ran two Effects whose errors are aliases of one union, such as AWS `TagResourceError` and `UntagResourceError`, declared every member of the union, while the `Effect.fn` it replaces declares the first alias; its declaration now reads E and R as TypeScript reads them from an `Effect.gen` body, so it keeps the alias.
- A constructor in an `error` body compiled silently, and one in a `schema error` body got only the `EK4814` warning; both now report `EK1301` alone, and the quick fix keeps the constructor in an Effect TypeScript class.
- An `error` or `schema error` body accepted an initialized property, a `private`, `protected`, `public` or `declare` property, a private name, an `accessor` property or an index signature, silently or with TypeScript's errors; each now reports `EK1304` alone, and the quick fix keeps the member in an Effect TypeScript class.
- `vibelang --fix --fix-vip-only` left an `effect` arrow whose body is a call without `try`, as in `effect (k) => withSpan(program, "load")`, although the call runs today; once a function's `effect` mark alone decides, that arrow returns the call's Effect unrun. The codemod now writes `effect (k) => try withSpan(program, "load")`, as it already did for `return f()` in a block body.
- `vibelang --fix` left `x |> Effect.withSpan(%, name)`, `x |> Effect.provide(%, L)` under `try`, and `try Effect.void` as written. It now writes the prelude's `withSpan`, a `provide` block, and nothing for `Effect.void`.
- `vibelang --fix` left `x |> Effect.catch(%, h)`, `Effect.orElseSucceed`, `Effect.mapError`, `Effect.sync` and `Effect.suspend` as calls, and offered a broken rewrite for the first. It now writes a catch expression where the pipeline runs and an `effect` block for a thunk, and writes `x catch () => v`, not the retired `x catch v`.
- `vibelang --fix` turned the branches of `(c) => c ? Effect.void : Effect.fail(e)` into a value and a `throw`, which changed the function's declared union of Effects. It now leaves such a function as written.
- `vibelang --fix --fix-vip-only` left a program such as `Effect.void` in an arm of a returned `?:` as a value (`cond ? Effect.void : Effect.fail(e)` under an `Effect` return type), which failed with `TS2322` "`Effect<void, never, never>` is not assignable to `void`"; each such arm now gets `try`, as a whole returned program does.
- `vibelang lint -c <oxlint config>` walked build output that Oxlint skips, such as foldkit's `packages/create-foldkit-app/dist/templates`, and failed with "does not include it; not linted"; it now skips what Oxlint skips for the same invocation: files ignored by `.gitignore` files up to the repository root and `.git/info/exclude`, the `--ignore-path` file (`.eslintignore` by default) and `--ignore-pattern` globs, with `--no-ignore` turning off the last two.
- A `.vibe` import with a plugin's query, such as `./x.vibe?highlighted` that a website plugin loads as rendered HTML, was recompiled by `vibelang-vite` as the module and the build failed with `MISSING_EXPORT` for `default`; the plugin now compiles only the module itself and ids with Vite's own queries (`?import`, `?v=`, `?t=`, `?worker_file`), and leaves a resource another plugin loads alone, as it already did for `?raw` and `?url`.
- A workspace package that exports a `.vibe` module's declaration sidecar as its types, and imports the module from its own `.ts` files as `./x.vibe`, gave a `vibelang` consumer two copies of the module, so its classes failed with TS2345 ("separate declarations of a private property"); the export now resolves to the source when the source is beside it outside `node_modules`.
- After a `chmod` of the compiler, or any change to its timestamps that kept its bytes, every Vite or loader run recompiled each project (`compiler changed`). The cache now compares the compiler's contents when its timestamps differ, and recompiles only for a changed compiler.
- `vibelang --fix` removed the retired `declarationSidecars` setting but left an empty `"vibelang": {  }` object behind, which a repository's formatter then rewrote; a settings object that held only that setting now goes with it, and one with a comment keeps the comment.
- Migration left a plain `Option.match(value, { onNone, onSome })` in native sources and `--fix` offered nothing, so Foldkit's nine pure choices were rewritten by hand; `--fix` now writes a native `match` over `Option.Some`, reading the subject and the handler object once in their original order.
- `--fix` refused an Option pipe whose stage argument is a callback factory, such as `pipe(value, Option.map(EffectArray.append(1)))`, because the factory's evaluation could move; it now caches the subject and every argument in pipe order inside a `do` block and then applies the native methods.
- `--fix` left a Match chain whose default handler destructures its parameter, `Match.orElse(({ _tag }) => _tag)`, with EK4839; it now writes a catch-all `let` arm whose `do` block destructures the bound value, so defaults and getter reads run only when the default arm does.
- `--fix` left `Match.when(String.startsWith("Core"), …)` and `Match.whenOr` groups mixing literals with prefix predicates with EK4839, saying the prefix call has no match pattern; it now writes a guarded arm, `when let value and if (value.startsWith("Core"))`, joining a group's alternatives in one guard.
- `--fix` left a Match chain whose first stage is a hoisted `const withChoice = Match.withReturnType<T>()` with EK4839 ("withChoice has no match form"); a stable hoisted hint now converts like the inline one, keeping its type context and its read before the subject.
- Pure `Option.gen` bodies could remain rejected after migration. `vibelang --fix` now converts supported eager generators to plain bodies with ordered reads, a `None` early exit, and fresh `Some` results.
- A `.vibe` module whose inferred export type printed longer than TypeScript's serializer limit failed with `TS7056`, though its `.ts` original gave consumers that read the source the full type; t3code's large schema modules stayed TypeScript. A `.vibe` module's declarations, its sidecar, now print such a type in full. A `.ts` file keeps TypeScript's limit.
- A function returning `{ status: 2 }` or `{}` could declare `readonly status?: never` or `status?: never` depending on which unrelated function the checker reached first, so a package's declarations changed between runs with no source change. The added property now follows the function's own literal. TypeScript 5.9 has the same bug.
- The migrate flow's setup rewrote only `tsc` in the migrated packages' scripts, so a root or TypeScript-only package that built with `tsrs -b` or `tsgo -b` rebuilt migrated projects with a stock compiler and published JavaScript that imports `./x.vibe`; setup now runs `vibelang` for `tsc`, `tsgo` and `tsrs` in the root's scripts and in every package that reaches a migrated one.
- The `rewrite-*` acceptance cases, which compile a program, rewrite it with `vibelang --fix` and compile it again, could be killed as a whole after 60 s on a loaded host; a custom runner now declares its own deadline (`// run-seconds: N`), and these declare the sum of their six 30 s stages, so a slow stage is named instead.
- A default-exported `service` could produce a generic TypeScript syntax error; it now reports `EK0905` and shows how to write the named declaration and indirect default export.
- Default-exporting an `error` or `schema error` used to report an unrelated semicolon error; it now reports `EK1305` and explains `export { Name as default }`.
- Formatting valid `for` heads with `is` patterns could fail with an internal parse error; they now format at narrow and normal widths while keeping `is` attached to its subject.
- Formatting native `Option` control flow could reject parenthesized `return (match …)` expressions and binding `is` branches; these forms now format while preserving their parsed structure.
- A dprint `operatorPosition` of `sameLine` or `maintain` could wrap an `is` pattern onto the next line at a narrow width and fail with `')' expected`; the pattern now stays on the line of `is`.
- With the DOM lib loaded, a contract such as `Effect<string, never, FileSystem>` around `try FileSystem()` failed with `EK9202` "needs FileSystem, but its contract says R = FileSystem" and suggested `FileSystem | FileSystem`; the error now names Effect's type `FileSystem.FileSystem`, explains that the bare type is the DOM's (VIP-14), and `vibelang --fix` writes `FileSystem.FileSystem` in the contract.
- Schemas and schema errors with a `__proto__` field could lose the field or throw while being declared; the field now validates, constructs and encodes as an own data property. Native `Schema.Struct` prototype setters keep their JavaScript meaning during `vibelang --fix`.
- Ambient `error` and `schema error` declarations compiled without constructing a runtime value and could be suggested as replacements for native ambient classes; they now report `EK1307`, and native ambient classes retain their erased form.
- In Vite, a `.vibe` module's `tsconfig` path alias such as `import { value } from "~/value"` resolved to nothing, though the same import from a `.ts` module resolved under `resolve.tsconfigPaths`; `vibelang-vite` now resolves it to the file the nearest `tsconfig.json`'s `paths` give, as `vibelang` does.
- A typed or generic `effect` arrow with a bare parameter reported unrelated TypeScript syntax errors. It now reports `EK0109` and offers a fix that inserts the required parentheses.
- `export default effect { … }` exported the program but declared `declare function _default(): A`, so a TypeScript consumer's `Effect.runSync(program)` was `TS2345`. The declaration is now `declare const _default: Effect<A, E, R>`, as for `export default Effect.gen(function* () { … })`.
- `export default effect (n: number) => { … }` declared `declare function _default(n: number): A`, the body's value, not the Effect it returns. It now declares `: Effect<A, E, R>`, as `export default (n: number) => Effect.gen(function* () { … })` does.
- A generic arrow after `catch` could produce syntax errors instead of a handler; generic, constrained and defaulted arrow heads now parse as ordinary arrow handlers do.
- A `fork` or `join` operand starting with a type assertion, literal, unary operator or newline could be read as an identifier expression or comparison; Effect code now recognizes those operand heads using `await`'s precedence and reservation.
- A generic arrow on the line after a bodyless `error` or `schema error` could be consumed as the declaration's type parameters and report `EK1303`; it now starts a separate arrow statement.
- A plain function that starts a root Effect, such as `const build = (): number => Effect.runSync(program)` or an SSG `renderPage` that calls `runPromise`, reported `EK1005` as if a fiber ran it. A function that `effect` does not mark is plain JavaScript (VIP-1), so a runner may start a root fiber there; an `effect` function, and a plain callback it passes on, still report `EK1005`.
- Calling an Effect value, such as `body()` for an Effect parameter, type-checked as the Effect but ran it, so `Effect.provideService(flag ? body() : other, Tag, 1)` compiled and then died with `Not a valid effect`. An Effect is now not callable, as in TypeScript (`TS2349`), and `try body` runs it (VIP-5).
- An unmarked function became an Effect function when its body ran an Effect or threw, or when its return type was an Effect, so `export function f() { return 7 }` could return an Effect and a local function named `provide` or `succeed` was read as a program; now only `effect` makes an Effect function (VIP-1), `try` outside effect code is `EK0501`, and an `effect` function's written return type must be an Effect type (`EK0106`).
- Classes extending a value named `effect` were rejected with syntax errors; `class Derived extends effect { }` now compiles as it does in TypeScript.
- VIP migration could remove `try` from calls returning tagged errors and turn their failures into success values; it now preserves execution of those Effects, while non-Effect Yieldables retain their `asEffect()` repair.
- Formatting a `data`, `schema` or field-only `error` declaration whose opening brace was on the next line could require a second pass to settle its indentation; one pass now produces stable indentation.
- After that fix, VIP migration kept `try` on calls to unannotated plain functions such as `function double(n) { return n * 2 }`, which left an `EK0502` error; it drops that `try` again and keeps it only where the callee's written return type is an Effect.
- VIP migration treated a plain function without a return type that returns an `error` instance or an object with `asEffect()` as an Effect: it kept `try` on its call, rewrote the call to `try f().asEffect()`, which returned a different value, or refused to migrate the file. It now removes that `try`, and the call gives the returned value, as it did before.
- `try` could reject generic Effect subtype operands or report a standalone `Config` call as discarded; values and calls now run consistently, retaining their success, error and requirement types.
- Oxlint scripts that select TypeScript files by extension skipped converted `.vibe` files and their `warn` rules; migration setup now includes them through ESLint with the same configured rule names, severities, source lines and warning policy, while keeping upstream `oxlint`.
- A migrated `oxlint src` command stopped before ESLint when the directory contained only `.vibe` files; setup now permits an empty native pass so those files still receive lint checks.
- Oxlint suppression comments stopped working when the migrate flow checked a converted file through ESLint; the generated parser now honors the same disable/enable scopes and rule aliases while preserving source lines.
- The migrate flow planned a tool's config that uses Effect, such as `graphql.config.ts`, for `.vibe`, and the tool, which finds its config by name, then failed with `config file not found`. A `*.config.ts` file now stays `.ts`, and a plan that names one is refused.
- Migration setup could lint native files excluded by the original Oxlint policy; its ESLint bridge now preserves `ignorePatterns`, source-extension globs and ordered negations.
- With a `paths` alias such as `"@/*": ["./lib/*", "./src/*"]`, an import of `@/x.vibe` compiled against `lib/x.d.ts` but the loaders ran `src/x.vibe`; the loaders now resolve it as the compiler does, so both use `lib/x.d.ts`.
- Migration could lose literal braces from renamed paths and skip formatting the real file; rename summaries now preserve those braces and retain both the original and destination paths.
- The migrate flow's declaration emit deleted every `.d.ts` file it wrote outside its output directory, so setup and verify deleted a tracked declaration file beside a source outside a project's `rootDir`; the emit now removes only the files it created and puts back the ones that existed.
- `vibelang --fix` left a program a module holds at its top level, `export const ping = send("PING")`, as EK1001. It now writes `effect { return try send("PING") }`, a program of the same type.
- `try make()` where `make()` returns an Effect with structure of its own, such as Effect's sql `Statement<A>`, a `Config` or a branded Effect, was `EK0502` ("not an Effect"), or for a `.ts` function compiled to a plain call that left the value unrun, while `const s = make(); try s` ran it. The call now runs where `try` stands, gives its success value, and its failures join the function's.
- `EK4805` told an exported class that extends `Error` to become an `error` declaration, whose constructor takes one object, so following it broke callers of `new X(message, options)`, and the migrate flow refused the file. For an exported class it now says there is no quick fix, and the migrate flow keeps the class.
- The migrate flow kept `vibelang --fix` rewrites of an earlier batch's `.vibe` module in another package, such as a `schema error` conversion of `../lib/error.vibe` while fixing `apps/server`, and reported no fix. It now puts back every `.vibe` file outside the batch, wherever it is in the repository.
- Rerunning the migrate flow's setup on a repository an earlier release set up left the `declarationSidecars` setting it had written, so every compile of those packages failed with `TS5023`; setup now removes it from each tsconfig it wires.
- The migrate flow's style gate refused a `Schema.TaggedError` class it must keep (its `EK4837` has no quick fix) because the class keeps its constructor, which `EK4814` warns about. It now accepts that `EK4814` on such a class.
- The migrate flow's verify refused a batch whose published declaration changed only `./runtime` to `./runtime.js`, which the migrated module's importer declares; it now excuses a relative specifier whose two spellings resolve to the same declaration file and lists each such pair in `verify.json`.
- The migrate flow's setup stopped with `the config's plugins is not an array literal` on a Vite config whose `plugins` array carries `as any`, and stopped on any test config it could not wire; it now looks through `as`, `satisfies`, `!` and parentheses, and names a config it cannot wire in its warnings and goes on.
- The `Layer.mergeAll` dependency warning recommended unsupported `wire`; it now points to `Layer.provide` and `Layer.provideMerge`.
- Cross-platform compiler builds could fail without naming the affected platform or its exit status; each target now keeps a completion record and silent failures are identified.
- Chapter 2 did not say where a `Cause` with both a failure and a defect comes from after dropping the wrong `try.any` example; it now names `Effect.failCause` in TypeScript code.
- Chapter 1 showed an `effect` function binding its parameters before `Effect.gen`, as if a destructuring failure threw at the call; it now says the call returns an Effect that dies with the error, as an `async` call returns a rejected Promise.
- The specification omitted the code for `try a ** b`, which ECMAScript-style parsing rejects as it rejects `await a ** b`; chapter 2 and Appendix B now name it `EK0510`, with the fix `(try a) ** b`.
- `vibelang --fix` left `Effect.fn` programs, and `Effect.gen` used as a value, for you to rewrite by hand, and wrote the rest in a direct style that an effect function would not keep (EK1002). It now writes each as an `effect` function or an `effect { … }` block with `try`, keeping `Effect.fn`'s name as a span.
- `vibelang --fix` left `f(x).pipe(Effect.map(g))`, which is EK4502 in a `.vibe` file. It now writes a `.pipe` of an Effect with `|>`, such as `f(x) |> Effect.map(%, g)`.
- The specification did not say that one `vibelang --fix` run reaches a fixed point, or how a missing `vibelang-runtime` is reported; chapter 7 now states both: a second run changes nothing, and a missing runtime is one `TS2307` error naming the package.
- The specification gave no warning for an explicit `throw` in a plain `catch` handler, which turns the failure into a defect; it now names lint warning `EK0511` with the quick fix `catch effect`, and the compiler registers the code (reporting it is tracked by a pending acceptance case).
- Migration rejected an `.mts` module after conversion because its identical declaration moved from `.d.mts` to `.d.ts`; verification now pairs those files while preserving published declaration bytes and rejecting collisions or changed public reachability.
- Migration rejected new private platform-adapter declarations; it now admits unreachable additions as `addedPrivate` while checking published export names, strict types and normalized JSDoc.
- Vite could fail with an unexpected token in a native dependency before evaluating its config; migration setup now preloads `vibelang/register` and selects `--configLoader native` for affected Vite scripts, with the supported config-loading path documented.
- Converting an `async` function in the editor could leave `try` in an unmarked function or skip an arrow's awaited expression. The refactors now write `effect`, handle expression bodies, and preserve comments around the modifier.
- Mixing `Key = value` with `Layer` providers could keep an earlier service implementation; `provide` now uses native `Layer` ordering, scopes and finalization, so the later provider wins.
  `vibelang --fix` retains native `Effect.provideService` calls because replacing them with a block changes scope and memo-map observations.
- Installing `vibelang` alone did not declare the Effect version it supports; the compiler now requires the same exact `effect` peer as the runtime, and release packaging rejects a missing, optional, ranged or mismatched pin.
- Source collectors could silently omit migrated files because their extension allowlists named only TypeScript; migration setup now warns with the file and line when `.ts` appears without `.vibe`.
- Release notes repeated fixes and mixed internal audit records with user-facing changes; the publication list now covers introductory bullets and every unpublished bug list while retaining each product fix once.
- A `Bun.build` with `vibelang-unplugin/bun` could produce a program that failed at startup with a `ReferenceError` inside a CommonJS dependency such as `ws` (Bun 1.4.4), because the plugin's resolve hook matched every relative `.js` import; it now matches a `.js` import only where a `.vibe` module of that name exists.
- Under `bun --preload vibelang/bun` on Bun 1.3.13, `createRequire(import.meta.url).resolve("srvx/node")` resolved from the working directory and failed with `Cannot find module 'srvx/node' from ''`; on a Bun that drops `createRequire`'s origin the preload now leaves the CommonJS hook alone, so `createRequire` resolves from its URL, and a CommonJS `require` of a `.vibe` module names its extension.
- Formatting a `.vibe` file whose `if` block held one statement that dprint guards with a leading `;`, such as `(try x) catch h`, failed with `formatting changed the program: KindExpressionStatement became KindBlock`; it formats now.
- Knip reported an export marked `/** @public */` in a `.vibe` file as unused when no other module imported it, because `vibelang/knip` dropped the comment; each export's stub now keeps the JSDoc written before it, so Knip reads its tags as for TypeScript.
- `vibelang/knip` stubbed each export without its signature, so Knip reported an export as unused when only another export's signature read it, such as `sample` in `export function read(input: typeof sample)`, where the TypeScript passed; the stub now keeps the types a signature reads, outside its body.
- A documented field of a `service` declared `readonly` as a property of its own before the field (`readonly: any` and a mutable field), so consumers of the service shape failed with TS2741; the comment now precedes the whole `readonly` field.
- The migrate flow's setup and Effect upgrade edited the manifests and tsconfigs of packages inside a Git submodule that the workspace named, so the lockfile recorded edits no commit of the parent could hold and a fresh `pnpm install --frozen-lockfile` at the submodule's gitlink failed; setup now leaves every submodule as it is, with a warning for a package the run names inside one.
- Migration rejected private examples and websites when their declarations changed; `verify` now reports `"not published"` for packages marked `"private": true`, while keeping tests, compiler and style checks.
- Passing an Effect-returning resource class where a union's generic data member takes it, as `register<W>(cls: Like<W> | Platform)` or `collection<T extends Like<any> | Platform<any>>(all: T[])`, was EK4301 and could cascade into EK3101; such a value is data there now.
- A JSDoc `{@link Envelope.id}` beside a local `Envelope` made the emitted JavaScript import `Envelope` from `effect/cluster` too, and the module failed to load with `Identifier 'Envelope' has already been declared`; names in comments no longer import Effect modules.
- An inferred return type that meets its own anonymous type again, such as a builder whose method returns `makeBuilder(…)`, failed with `TS5088: The inferred type of 'from' references a type with a cyclic structure` and declared nothing; it now declares the type met again as `/*elided*/ any`, as TypeScript 5.9 and 7.0.2 do.
- A generic call that infers a requirement from an implementation built inside a callback, such as alchemy's `AuthProvider` registering `Effect.gen(function* () { const configure = (name) => (name ? first : second).pipe(Effect.mapError(f)); return { configure } })`, inferred `never` and failed with TS2345; it infers the requirement again, as TypeScript 5.9 and 7.0.2 do.
- A missing `vibelang-runtime` could go unnoticed or expose internal helper-name errors; compilation now reports one `TS2307` naming the dependency and keeps unrelated source errors.
- A migration could need a second `vibelang --fix` run after an import cleanup exposed another fix; one invocation now repeats its passes, and reports any fixes left at its limit.
- Checking documentation examples with a symlinked `TMPDIR` could stop with `Compiler failed` instead of reporting an example's type error; diagnostics now stay attached to their examples and later pages are checked.
- Prettier and `formatSource` could silently keep unformatted `.vibe` input whose path was ignored, including `node_modules`; they now format the supplied buffer and report syntax errors.
- The error-declaration chapter never named `EK1306`, the code for two `error` or `schema error` members on one line with no separator; it now states it beside the separator rule and in its static rules.
- `vibelang lint` with `effecttsgo/unnecessaryArrowBlock` on reported every `effect { return x }` block as an unnecessary arrow block (EK4823), and its quick fix wrote `effect x`, which does not parse; an effect block's braces are its syntax, so only real arrows and effect arrows are reported now.
- Migrating a module could leave extensionless TypeScript imports unresolved; the migration now names the `.vibe` source and accepts its emitted declaration spelling only when both names resolve to the same module.
- The `async` function refactor could keep an object as data instead of adopting its result, even after `return await` or through a `void` return type; it now declines uncertain returns and keeps existing value-discarding returns eligible.
- The migrate flow's codemod and `revert` rewrote imports of a migrated module only inside the run's `--source` directories, so a test under `test/` kept `import … from "../src/Crypto.ts"` after `Crypto.ts` became `Crypto.vibe` and failed to load; they now rewrite every source file the repository tracks.
- `vibelang --fix` rewrote a retired `try(fn, onError, …inputs)` hatch whose error handler was a name, such as `onError`, by passing the handler to `fn` as its first input and dropping the catch, so the fix was refused with a type error; and `--fix-vip-only` marked the hatch's own function `effect`. The second argument now becomes `catch` whatever its form, `undefined` there leaves `catch` out, and the hatch's function stays plain, as Smithers' `agent/fs` needed.
- The migrate flow's setup added `npm:vibelang/dprint-plugin.json`, which has no checksum, to `dprint.json` files that pin every plugin by checksum, and left dprint and ESLint reading the `x.d.vibe.ts` sidecars as source, so Smithers' plugin-pinning test, `dprint check` and its lint failed on the first batch; setup now keeps a pinned configuration's plugins and runs `vibelang-format` in its dprint scripts instead, and adds `**/*.d.vibe.ts` to each `dprint.json`'s `excludes` and each ESLint flat configuration's ignores.
- The migrate flow's setup wired the `.vibe` formatter into a repository's format check but left the `.vibe` files it already had unformatted, so Smithers' `agent/fs` package, with 18 such files from VibeLang 0.0.8, failed `dprint check` before any batch; setup now formats them with `vibelang-format` in its commit.
- A plain function's `try`/`catch` let an exception the compiler does not track pass through, with only `EK9204`, so `try { return new URL(x).hostname } catch { return null }` threw where the TypeScript returned null; the statement is now JavaScript's and catches every exception that reaches it, and where the `try` block has no tracked failure `catch (e)` binds `e` as `unknown`.
- `vibelang --fix` changed `return value` to `{ value; return }` in the generator of `Effect.fn("name")(function* … , pipeline)` when a pipeline argument followed it, as if the generator were a Stream producer (`EK2128`), so the migrated function lost its result; it is now `EK1002` like the generator of `Effect.fn` alone, and `--fix` leaves it.
- Appendix B linked the migration warnings `EK4853`, `EK4854` and `EK4855` to Functions and Services sections that never mention them, and `EK1306` to an error-declaration section that never mentions it. The rows now link the sections that define them.
- Some unary or multiline top-level `await` expressions compiled into output incompatible with the selected target or CommonJS host; they now report `TS1378` or `TS1309`.
- A retained Effect error's extractor, such as `when Cause.TimeoutError(let t):`, did not cover its case, so a `match` that handled every member still reported `EK4701`; its one-binding extractor now covers the case, as the bare pattern does.
- In a `.vibe` file a member of an interface or an object type was readonly to the checker, so `options.minimum = 0` was `TS2540`, while its declaration printed the member writable; such a member is now writable unless written `readonly`, as in TypeScript, and the checker and the declaration agree. The fields of `data`, `schema` and `error` bodies keep their readonly default, and `mutable` is still accepted. The migrate flow's codemod no longer writes `mutable`.
- `when NotFound:` and `when NotFound(let e):` narrowed the subject, and typed `e`, as the `NotFound` class alone, although the generated matcher also accepts a plain object or another package's copy with the tag `"NotFound"`; a `match` over such a member then reported `EK4701` after the arm. They now narrow as `Effect.catchTag` does, to the subject's members with that tag, and keep the class only when the subject has none, so a later arm for another class with the same tag sees `never`: that arm never runs.
- With paired `moduleSuffixes` such as `["", ".d.vibe"]`, VibeLang read a stale declaration sidecar instead of its `.vibe` source and reported incorrect types; it now reads the source and keeps ordinary `.ts` and `.tsx` priority.
- ESLint with `vibelang/eslint` reported `no-unused-vars` on a codec that only a `schema` field names, as in `const Names = Schema.Tuple([Schema.String, Schema.String])` and `schema Locale { names: Names }`; the ESLint tree now writes such a field's type as `typeof Names`, the value the schema reads, in `schema` and `schema error` bodies and `schema X = Type`.
- Import-free `.vibe` files could share globals or report false duplicate declarations with `moduleDetection: "legacy"` or `"auto"`; each source file now keeps its own module scope and emitted module markers.
- The migrate flow's `upgrade-effect` reinstalled with pnpm only, leaving a `bun.lock` kept beside `pnpm-lock.yaml` on the old Effect and VibeLang, and wrote a new override such as `@effect/sql-pg` to `pnpm-workspace.yaml` alone, single-quoted, although Smithers mirrors it in `package.json` with double quotes; each install now also rewrites the other lockfiles, and a new override goes to every overrides table in the quoting beside it.
- An Effect whose success is a function, written where an Effect is expected, was run and its function called as a thunk: `Effect.acquireRelease(Effect.sync(() => detach), (release) => Effect.sync(release))` acquired `void` and reported `TS2345`. Such an argument is now passed as the Effect, and the function is its result.
- The migrate flow's `.vibe` ESLint pass used the root `.oxlintrc.json` for every lint script, over the whole tree, so a script such as foldkit's `oxlint --config .oxlintrc.app.json examples packages/website/src` linted `.vibe` files with other rules and in other directories. Each `oxlint` invocation now gets its own pass, with an ESLint configuration generated from the configuration it names with `-c` or `--config` (`.vibelang/eslint.app.config.mjs`) and the paths it lints.
- The specification's tooling requirements did not say that a repository's Oxlint JS-plugin rules run on `.vibe` files, a decided requirement the migrate flow already meets; chapter 7 now states it.
- The specification wrote a spread element of a `try.allSettled` literal as `...xs.map(Effect.exit)`, which fails on a `Set` and reads an array by index instead of through its iterator; it now spreads natively and wraps each value the spread yields, as the compiler already does.
- That corrected `try.allSettled` counterpart, `...[...xs].map(Effect.exit)`, still spread a second, generated array, so a changed `Array.prototype[Symbol.iterator]` saw an extra call and could reorder the Exits; the specification now builds the literal once, natively, and wraps that array by index, as the compiler already does.
- The specification said `EK4834`, `EK4835` and `EK4836` warn on an "explicitly run" `Effect.succeed`, `Effect.fail`, `Effect.catch`, `Effect.provide` and their siblings without saying what that means, so `fork Effect.catch(e, h)`, the quick fix `EK0505` itself suggests, could be read as warned with no repair; the three rows now warn only on the direct operand of bare `try`, and name `fork`, `join`, `try.all` and its siblings, API arguments and `catch` heads as sites that do not warn.
- The Effect TypeScript reference beside chapter 7's direct-`try` advisory example aggregated `Effect.succeed(2)` where the VibeLang `demo` aggregates `e`, and returned joined results instead of its fibers, so it succeeded while the example fails with `"e"`; it is now that example's counterpart, and a test runs both on the same inputs and compares their Exits.
- Calling a producer whose parameter binding throws, such as `effect function* s({ id }: User)` called with `undefined` from TypeScript, threw a `TypeError` at the call; the call now returns a Stream that dies with the thrown value, as chapter 3 says, and binding still happens once, at the call.
- An Effect type ending in `!!` that touched the next token failed or changed meaning: `const d: number!!= load()` and `effect (x: number): number!!=> x` were syntax errors, and `e as number!!== e` compiled as `e !== e`. The `!` that completes `A!!` is now always its own token, so these read as `A!! = v`, `A!! => e` and `A!! == v`, as the specification says.
- VIP-2's first example of a cold `effect` block called `console.log("hi")`, which VIP-33 bans in VibeLang code (`EK4402`) inside an `effect` block too; it now runs `try log("hi")`, Effect's logger, once per run.
- TypeScript tools could not resolve a `.vibe` import unless its project opted into declaration sidecars; every compile now writes `x.d.vibe.ts`, and `vibelang --fix` removes the obsolete `declarationSidecars` setting from the project and its local inherited configs.
- The Node and Bun loaders compiled a project again when its declaration sidecars appeared; generated sidecars beside their sources now preserve the cached compile, while standalone declarations and source changes still invalidate it.
- With the `@effect/language-service` plugin's `ignoreEffectErrorsInTscExitCode` or `ignoreEffectWarningsInTscExitCode` set, an Effect lint diagnostic such as `EK3801 floatingEffect` still made `vibelang` exit 2 and blocked emit under `noEmitOnError`, because the options recognized only Effect's own diagnostic codes, not the `EK38xx` codes VibeLang prints; they now cover every imported rule again, as in 0.0.8.
- The migrate flow missed directory imports such as `./runtime/` and could rewrite one as `./runtime/.vibe`; it now keeps the selected index module and writes `./runtime/index.vibe`.
- The migrate flow could miss errors and repair notes in compiler output with Windows line endings, or mistake a normal error exit for a compiler crash; it now reads those diagnostics and notes correctly.
- The tooling specification linked to private numbered decisions for configuration, diagnostics, and lint rules; it now links to the accepted public VIP amendments.
- The specification gave no home for an `is` binding in an `enum` member initializer, and the match guide said only `for-of` heads copy bindings per iteration; such a binding is now `EK0705`, as in a parameter default, and the guide states the `for (;;)` copies too.
- After an edit, hovering a call passed by name as an argument, such as `greeting()` in `Effect.timeout(greeting(), "1 second")`, said `Runs here`, although the compiled code passes it to `Effect.timeout` as a program; the hover now says it is passed by name and runs when that program runs.
- `vibelang --fix` built and checked the project twice for each round of fixes that passed, so a file with nested fixes, which take a round per level, took twice as long as it needed: 20 nested `Effect.Effect<…>` types took about 10 seconds on a busy machine. Each passing round is now checked once, and that file takes about 5 seconds.
- In a project with no `declaration` setting, an export whose inferred type was too long to serialize (`TS7056`) got only a warning, and its declaration sidecar held `any` in place of the type, so a stock `tsc` consumer lost its types without an error; it is an error again, as it is where the project emits declarations.
- Installation guides list the native packages published for the selected release, with WSL guidance until native Windows packages are published. Linux x64 is the platform used for the npm and Bun starter rehearsal.
- The editor action "Convert to a VibeLang function with an error per await" on an `async function` declaration without `export` produced overlapping edits, which editors reject; the inserted error declaration now comes before the edit that removes `async`.
- `vibelang-format` failed with `internal error: the TypeScript form does not parse` on a valid return type that is a union of parenthesized contracts, such as `(ok: boolean): (void!never!never) | (never!Missing!never) => …`, and printed the whole file's TypeScript form; it now formats the file, and such an error shows only the line that does not parse.
- Under Bun, `vibelang/bun` loaded a `.vibe` module only through a relative import, so an import through a tsconfig `paths` alias, such as `@/x` with `"@/*": ["./src/*"]`, failed with `Cannot find module '@/x'` once `x.ts` became `x.vibe`; the preload now resolves the alias to the `.vibe` module TypeScript resolves it to.
- An `error` declaration with no fields, such as `error Timeout`, declared `extends Timeout_base<{}>`, where `class Timeout extends Data.TaggedError("Timeout") {}` declares `extends Timeout_base`, so `--fix` changed the declarations of every fieldless `Data.TaggedError` class it rewrote. It now declares `extends Timeout_base`, as the TypeScript does.
- The specification’s appendices cited eleven rules by their numbers in a private decision log. They now cite the VIP amendments that record them (VIP-3, VIP-4, VIP-5, VIP-7, VIP-12, VIP-34 and VIP-38).
- Generic `error` declarations previously compiled; both error forms now report `EK1303`, and `vibelang --fix` preserves plain generic errors as Effect TypeScript classes instead of suggesting an unsupported declaration.
- Error declarations previously accepted setters; both error forms now report `EK1302`, and `vibelang --fix` preserves the setter in an Effect TypeScript class.
- Error declarations previously accepted user-written `static` members; both error forms now report `EK1302`, and `--fix` preserves them in an Effect TypeScript class. The class migration preserves reference directives and documentation when it adds an import.
- `error` and `schema error` declarations accepted `implements` clauses; they now report `EK1304`, and `--fix` removes the clause without changing runtime behavior.
- The migrate flow's declaration identity check failed a module whose declaration lost only redundant type parentheses, such as `() => (<A>(value: A) => A)` after `vibelang-format`; it now ignores redundant parentheses and still fails a change of precedence, such as `(A | B)[]` to `A | B[]`.
- The migrate flow's `upgrade-effect` moved `vibelang` to the new release but kept the `patchedDependencies` entry for its old version, which pnpm refuses as unused (`ERR_PNPM_UNUSED_PATCH`), and left `vibelang-unplugin` on the old release, so Smithers' upgrade could not install; it now drops a patch the new release already contains, moves one that still applies, stops with the patch's name on one that does neither, and moves `vibelang-unplugin` with the other packages.
- The migrate flow's `verify` rejected a `Schema.TaggedError` class that `EK4837` says has no quick fix, such as one with an annotations argument like `{ httpApiStatus: 400 }`, although no schema error declaration can keep it, so such a file could never pass; `verify` now accepts it, and the warning stays.
- In a project without the `@effect/language-service` plugin, any `vibe.severities` entry turned on every Effect lint, so setting only the VibeLang warning `"EK4842": "off"` reported `EK3801` and hundreds of other lint diagnostics in existing `.ts` files; only an entry for an imported `EK38xx` code turns them on now.
- The migrate flow left Oxlint linting the declaration sidecars, `x.d.vibe.ts`, which it reads as TypeScript, so a repository's lint failed on generated text; setup now adds `**/*.d.vibe.ts` to the Oxlint configuration's `ignorePatterns`.
- The release publisher ignored an explicit `--otp` password and prompted again; it now forwards that password to npm, accepts it with `--dry-run` in either order, and rejects unknown options before doing any work.
- The configuration specification incorrectly based every inherited path on the declaring config. It now distinguishes ordinary relative paths from `${configDir}`, which uses the selected project config’s directory, matching TypeScript.
- A predicate pattern whose parameter had a type, such as `when isText:` with `isText(s: string | number): s is string`, narrowed the subject to the function's type, so `s.toUpperCase()` in the arm and `s.toFixed()` in `default` did not compile, and a call-only extractor with a typed parameter bound `any`. The arm and `default` now narrow as `if (isText(s))` does, and the bindings take the extractor's element types.
- `vibelang/bun` scanned every module of every dependency and resolved each of their imports a second time, so a large package's tests ran about three times slower and timed out with no `.vibe` module loaded; it now stops at `node_modules`, and a 294-module import graph costs about the same with the preload as without it.
- `vibelang --fix` deleted `import * as Schema from "effect/Schema"` when a `Schema.TaggedError` class was its only use, and rewrote a class whose module has another name, so the declaration file changed; in a project that emits declarations it now keeps the import and leaves such a class.
- `e catch h` did not run `e` when `e` was an Effect value, a yieldable error or an `effect` block, so `effect { … } catch () => "Untitled"` gave back an unrun Effect, with only a false `EK9204` warning; the catch now runs it, as the language reference says.
- The specification gave no diagnostic code for two members of a `service`, `error`, `schema` or `data` body written on one line with no separator, and the compiler printed TypeScript class or interface messages for it; the specification now assigns `EK0908`, `EK1306`, `EK1504` and `EK1605`, each with a quick fix that inserts `;`.
- The specification told the formatter to wrap long `provide` lists in `Layer.mergeAll(…)`, a semantic rewrite it never performs. It now says a long list stays on one line.
- Ordinary formatter styling could be rejected for changing emitted token spellings; preservation checks now compare parsed meaning and declarations while retaining diagnostic, directive and source-map checks.
- The specification’s Functions chapter cited thirteen rules by their numbers in a private decision log. It now cites the VIP amendments that record them (VIP-1, VIP-3, VIP-4, VIP-5, VIP-27, VIP-28 and VIP-33).
- The specification’s introduction cited three rules by their numbers in a private decision log, which a reader of the repository cannot look up. It now cites the VIP-7 and VIP-38 amendments that record them.
- The specification’s grammar used `Name` and `ReturnType` in its `effect` function productions without defining them, so it did not say whether `fork` or `join` could name an `effect` function expression. It now makes `const f = effect function join() { }` `EK1702`, as an `async` function expression named `await` is a syntax error, and keeps a declaration such as `export effect function fork() { }` in plain code valid.
- `when Array(let n):` bound the whole array, a typed-array extractor bound the whole value, `when pair(let a, let b):` threw at run time when `pair` was a plain function, and a class whose matcher declared its hint as `{ matchType: "extractor" }` typed its bindings as the class instance. `Array` and typed arrays now list their elements, as the proposal says, a plain function is called with the value and `{ matchType: "extractor" }` and returns `false` or the values, and the matcher's declared return type types the bindings.
- The headless editor check waited for request timeouts after its language server crashed, and could write to a closed pipe; it now reports the affected request and exit cause immediately and cleans up pending requests.
- Formatting comma-separated `error` and `schema error` fields beside methods or getters failed with an internal error. These bodies now format while preserving their separators, comments and diagnostics.
- `vibelang-format` and the `vibelang/prettier` plugin wrote double quotes and wrapped at 120 columns whatever the repository's formatter settings said, so in a repository such as foldkit (Oxfmt, `singleQuote`, `printWidth: 80`) `.vibe` files differed in style from its `.ts` files. They now take the quote style and print width from the repository's Oxfmt, Prettier or dprint configuration, or from Prettier's options.
- Under Bun, the loader and bundler plugins failed with `ENOTDIR` on a relative import of a file that is not a script, such as `./prompt.txt`, which broke `Bun.build` in a project that imports text; they now leave that import to Bun.
- Running the migrate flow setup again kept an existing `.vibelang/eslint.config.mjs` where the lint script already ran it, so a project kept the rules of the older config; setup now writes the config again.
- The migrate flow skipped a named Vite config such as `vite.node.config.ts`, with no warning, so a build that loads one failed on the first `.vibe` module; setup now adds `vibelang-vite` to it, or warns where it cannot.
- After the migrate flow moved a module to `.vibe`, a test that mocks it with an extensionless path, `mock.module("../src/mini", …)`, silently ran the real module; the codemod now rewrites that path to `../src/mini.vibe`.
- The migrate flow's `verify` rejected a `Context.Service` class that `EK4831` says has no quick fix, such as one with a named shape or static members, although no service declaration can keep its declaration, so such a file could never pass; `verify` now accepts it, and the warning stays.
- The specification described `async match` without connecting it to Appendix A. Explicit primary-expression productions now connect match bodies and the independent async context, including its line-break and jump restrictions.
- `vibelang --fix` crashed with a nil pointer dereference when `EK9203` was reported at a return annotation that is itself a function type, such as `(): () => Effect.Effect<number, never, never> => { … }`. It now looks for the helper behind the annotated functions first Effect call and writes that helpers return type, or leaves the annotation alone when there is none.
- In the editor, expanding the selection from `resume` inside a `handle` clause produced a range that started at `resume` and stopped before the call's `)`, nested inside `resume` itself; the selection now grows from `resume` to the whole `resume(…)` call.
- The interruption-block placement rule counted `restore` twice. It now names the three forms governed by `EK2201` explicitly.
- The Promise comparison omitted existing operand and syntax restrictions and left its catch result unawaited. It now lists those differences and shows the handled result being awaited.
- The migrate flow stopped with "vibelang emitted no declarations" on a package whose tsconfig is solution-style, `"files": []` with `references`; it now checks, fixes and declares each referenced project.
- In a project that emits declarations, `--fix` deleted an `import type` or `{ type X }` import of an Effect module that an export names, so the declaration imported it as a value where TypeScript keeps the modifier; `--fix` now keeps such an import.
- The `match` documentation could reject an already covered shared tag by using TypeScript's whole-object narrowing as its test; it now counts each member's recognized tag cases, including plain objects matched by an error tag. The optional `_tag` example now identifies the absent case that remains uncovered.
- The public schema-error decision called every encoded value JSON; it now distinguishes codec encoding from serialization and shows how a string codec makes bigint transport possible.
- The region-body example wrapped one bound provider in an array despite the single-provider rule. Its counterpart now passes that layer directly.
- Constructor docs promised that typed payloads could not throw. They now distinguish the static `never` contract from native getter, `Proxy` and property-copy failures, which remain defects in effect code.
- The spec's generic-contract example bridged its call with the one-argument `Effect.try`, which fails with `UnknownError`, while its TypeScript counterpart failed with the thrown value. Both now use the `try`/`catch` form, and the constrained generic call has its VibeLang source.
- An invalid child severity could restore a base config's error setting; it now reports the config error and uses the diagnostic's normal fallback while keeping other valid settings.
- The severity reference left invalid-entry recovery unclear; it now explains independent recovery after inheritance and that invalid child entries do not restore overwritten base settings.
- The specification did not say where an `is` binding in a `for` head, a concise arrow body or a field initializer lives, and its examples compiled a read of a skipped binding; it now gives each home, and a read where the binding may not have run is TypeScript's `TS2454` or `TS2448`.
- The specification implied every schema error could cross JSON unchanged. It now explains that transport compatibility follows the chosen encoded representation, with a bigint-to-string codec for JSON and no hidden conversion.
- Incomplete `service`, `schema` and `data` declarations, and a `service` in an ambient context (`declare service`, or one inside `declare namespace`, `declare module` or `declare global`), had no diagnostic codes in the specification; it now names their existing rejections `EK0906`, `EK1503`, `EK1604` and `EK0907`, and keeps valid empty bodies, schema aliases and bodyless errors.
- The specification’s grammar accepted a pipe as the unparenthesized test of a conditional, `x |> f(%) ? 1 : 2`, which the pinned pipe proposal rejects. It is now a syntax error; write `(x |> f(%)) ? 1 : 2` or `x |> (f(%) ? 1 : 2)`.
- Three `.vibe` examples in the specification’s Functions chapter wrote `Effect.Effect<…>` types, which the default `EK4833` lint warning flags. They now use the `A!E!R` shorthand that warning suggests, such as `User!NotFound!Users`.
- The specification gave `abstract effect` and `declare effect` two diagnostics, did not recognize `effect` on interface and type literal members where `EK0108` applies, and left the type of an unannotated `effect` overload signature unstated. It now reports `EK0108` there, keeps TypeScript's `TS1222` for a starred signature, and gives an unannotated signature `any` with `TS7010`, as for `async`. An optional `R` named `as` at a line end now follows TypeScript's semicolon insertion.
- In the specification’s Functions chapter, a paragraph about `async` declaration contracts separated the rule that an effectful plain function can’t throw from that rule’s example. The paragraph now sits with the callable-contract witnesses it qualifies, and the example follows its rule.
- The specification’s rule for marking a detail **Undecided (pending VIP)** still counted unpublished rulings and decided details as deciding sources. It now names only accepted VIPs, their public amendments and the TypeScript or pinned TC39 counterpart, as the specification’s opening does.
- Duplicate data variants reported a legacy error only on the repeated name; they now report TypeScript’s `TS2300` on both source names, matching duplicate fields.
- An Effect TypeScript counterpart in the pattern-matching chapter did not compile under `tsc --strict`: it used `Symbol.customMatcher`, which TypeScript does not declare. It now uses the chapter's stand-in key, and a docs test type-checks every counterpart in the specification and the VIPs.
- The diagnostic appendix omitted historical code changes and left a retired code unmarked; it now lists the changed meanings and keeps the old bodyless-declaration code retired.
- Safe-looking built-in calls had unclear throw contracts, and padding counts were treated like `repeat` counts. The spec now uses each selected signature’s full contract, follows JavaScript’s padding rules, and wraps affected examples and their callers.
- Schema `Record` types could lose required or readonly keys through a referenced value schema; conflicting or uncertain decoded key flags now report `EK2109`, and `vibelang --fix` retains explicit Effect codecs with the same declarations and decoding.
- Empty type argument lists on schema references, such as `Address<>`, were silently ignored; they now report `EK2109`, and `vibelang --fix` removes them while preserving comments and decoded values.
- The specification gave no diagnostic code for a `return`, `break` or `continue` that leaves an `async match`; it is now `EK0706`, and a nested function keeps its own `return`.
- Repeated computed payload fields were described as unconditional duplicate-name errors; they now retain TypeScript’s member merging and compatibility checks.
- Computed keys were described as sharing one admission rule; schema keys now follow their runtime object-literal checks and evaluation, while data payload keys retain TypeScript type-member checks and erasure.
- Legacy configuration guidance omitted supported severity settings and their precedence; it now explains both legacy paths, inheritance, modern overrides and migration warnings without changing current lint repairs.
- A labeled `continue` from a `for concurrent` item to an enclosing loop reported a TypeScript function-boundary error; it now reports `EK1905` and explains how to end the item.
- Producer documentation kept callback-owned `Scope` as an external requirement; it now shows only the other services that consumers must provide, while preserving checks on written annotations and emitted values.
- A signed zero pattern, `when -0:` or `when +0:`, matched both zeros and counted as covering `0`; it now matches only that zero, as `Object.is` does, and a `match` without `default` whose only zero arm is signed reports `EK4701`.
- An explicitly `readonly` schema field could acquire a writable decoded key through a referenced codec; conflicting or uncertain readonly flags now report `EK2109`, with preserving `--fix` expansion to explicit codecs.
- Editor completion was empty inside the iterable expression of a `for concurrent` loop; it now offers in-scope names there while preserving completion behavior in function parameter lists.
- A call signature in a service body, such as `(value: string): string`, failed with a cascade of syntax errors; it now reports one `EK0902`, and the rest of the service still checks.


- A `match` arm without its `;`, or with `,`, compiled when a new line or `}` followed it, and `match (b) { }` reported a missing case or nothing; a missing separator is now `EK0701`, with a quick fix and `vibelang --fix`, and `match (b) { }`, a second or early `default`, a missing `:` and an interpolated template pattern are `EK0707`.
- A `catch` handler whose only parameter was named `async`, `of`, `from` or `get`, as in `task catch of => of.length`, failed with `TS1005`; contextual keywords now work as handler parameters, as they do in any TypeScript arrow.
- Editor parsing rejected `for try` `Stream` loops; the tree-sitter grammar now recognizes the loop and its `continue` and `break` statements.
- In a project that emits declarations, `vibelang --fix` removed an import such as `import * as DateTime from "effect/DateTime"` that the declaration file still printed, through a local type an export names (`type NonNull<V> = V extends DateTime.Utc ? …`), a conditional type or a written `keyof DateTime.Utc`, so the declaration imported `{ DateTime } from "effect"`; `--fix` now keeps every import the file's declaration keeps.
- The ESLint configuration the migrate flow generates for `.vibe` files left out the rules of the repository's Oxlint JS plugins, so foldkit's 17 `foldkit/*` rules never ran on its `.vibe` files. It now loads each plugin in `.oxlintrc.json`'s `jsPlugins` under the name Oxlint gives it and runs its rules and overrides on `.vibe` files.
- EK4301 rejected an Effect-returning value passed to a union such as `ResourceClassLike<R> | Platform` even when the value fit only the member with no call signature, as alchemy's `Provider.effect(Resource, …)` does; such a member now takes the value as data.
- The migrate flow formatted a batch's `.vibe` files after the last compile, so each batch committed a stale `.d.vibe.ts` and the next batch's commit carried the difference; `record` now compiles again when formatting changed a file.
- The migrate flow's `step revert` restored a file from the batch's parent commit, so it could not return a module an earlier batch had migrated, as foldkit's round 3 needed for 26 modules a later lint crash blocked; it now restores such a module from before the batch that migrated it and undoes that batch's import edits.
- The specification left parameter suspension outside its diagnostic rules and tied invalid Effect-body yields to an outer producer; the same source boundaries now cover formal initialization and every nonproducer Effect body.
- Several recent fixes were listed under the previous published release; their notes now appear with the release that includes them.
- The platform guide put `Intl` in the web allowlist and suggested a nonexistent `Path.fromFileUrl` shortcut; it now identifies `Intl` as an ECMAScript global and shows access through the `Path.Path` service.
- The pattern documentation omitted an `is` comparison and its binding scope; it now shows the Boolean test, explains block visibility and TDZ, and distinguishes skipped initialization from a later failed guard.
- The declaration reference omitted diagnostic codes for direct default `schema` and `data` exports and for schema type parameters; it now assigns `EK1501`, `EK1603` and `EK1502` and shows named exports and generic factories as repairs.
- The accepted schema example still gave writable source fields readonly TypeScript types; its counterpart now uses `Schema.mutableKey`, and the public schema VIPs record the conservative checks for conflicting referenced-schema modifiers.
- The public service decision omitted the recursive `Shape` binding and outer-generic capture rule; it now records the private recursive alias, its type-only projection and the generic-service rejection for a shape that would specialize one key through erased outer type arguments.
- The schema-error reference could admit a reserved `_tag` key hidden by a generic, enum or brand; it now requires proof over the runtime key domain and preserves the generated discriminant without a runtime guard.
- The public pattern decision omitted the binding-cell lifetime rules; it now records shared `or` cells, fresh loop-condition cells and the initial `do` body's TDZ, with checked closure witnesses.
- The reserved data helper-name diagnostic appeared outside its rules table; it now renders as a table row.
- The Effect operand examples omitted `Exit` and `Config`. They now show both and make clear that structural assignability, rather than a list of type names, decides admission.
- The `async match` reference attributed its body grammar to an unvendored `async do` draft; it now states the accepted grammar contexts explicitly and shows that nested source functions keep their own `return` context.
- The `for try` ownership rule could imply that plain child forks ended with an item; it now names the current consuming fiber as owner, so those children can survive successful loop completion.
- Iterator guidance promised cleanup for every JavaScript error; it now follows native closing decisions and distinguishes abandoned `Effect` execution from JavaScript unwinding, including defaults after exhaustion.
- The pattern reference left parameter-default binding scopes undefined; it now assigns `EK0705` to an `is` binding needing that unsettled parameter home and shows explicit block-local repairs.
- A required schema tuple position could disappear when its schema reference carried optional-key flags; it now reports `EK2109`, and `vibelang --fix` preserves existing decoding with explicit Effect codecs.
- A writable interface or object-type property became `readonly` in emitted declarations, preventing TypeScript consumers from assigning to it; declarations now keep the source's property and index-signature modifiers, including optional and nested members.
- The specification's table of where `try` may run, like `await`, had no row for decorator expressions. A decorator expression such as `@(try d)` now runs in its enclosing context, as a computed class key does, matching TypeScript, which admits `@(await d)` in an `async` function and reports `TS1308` in a plain one.
- Severity settings for TypeScript-form lint warnings reported `EK3006` and were ignored; every warning listed in Appendix B now accepts `vibe.severities` overrides.
- `EK4837` told you to replace a `Schema.TaggedError` class with `error`, which drops its Schema, and had no fix; it now names `schema error`, also reports a class with accessors, and `vibelang --fix` writes the declaration.
- The migrate flow refused to commit a file whose comment mentioned `file://`, reading it as an absolute path of the machine; it now needs a path after the slashes.
- A contract written in parentheses in a union, `(string!never!never) | number`, kept its parentheses in the declaration, `(Effect.Effect<string, never, never>) | number`, unlike the TypeScript's; the declaration now drops them.
- A migrate run that switched to a new toolchain committed `upgrade Effect to <version>` although Effect did not change; that commit now says `switch to the toolchain of VibeLang <commit>`.
- Under `noImplicitOverride`, a service's `static readonly key` and `static readonly defaultValue` reported `TS4114`, though the spec and `--fix` write them that way; they now take no `override`.
- `service S extends Base { }` and `service S implements I { }` failed with a parse error, `TS1005: '{' expected`; they now report `EK0904`, which says a service's identity is its key and to compose shapes with types.
- The specification's list of where `try` differs from `await` compared `for try` only with an assignment head, though `for await` also accepts `var`, `using` and `await using` heads. The row now says `for try` rejects every head other than a `const` or `let` declaration (`EK2005`).
- A migrated package whose script runs a program under Bun, such as `bun alchemy-test`, failed with `Export named ... not found` on each `.vibe` module, because setup wrote only the `[test]` preload, which `bun test` alone reads; setup now also writes the top-level `preload` in that package's `bunfig.toml`.
- A `Bun.build` script in a project the migrate flow moved failed to bundle any `.vibe` module, because setup wired only `vibelang/bun`, a runtime plugin that bundles do not use; setup now adds `vibelang()` from `vibelang-unplugin/bun` to each such script and warns about a build it can't edit.
- The migrate flow renamed a module that a package exports, by name or by a pattern such as `"./*": "./src/*.ts"`, without updating `package.json`, so every import of it by package name failed; the codemod now points the entry at the `.vibe` source, revert takes that back, and setup preloads `vibelang/bun` in each package that runs `bun test` and reaches a migrated package.
- `try conf` with `conf` a `Config`, an Effect intersected with a brand, or a value of an interface that extends Effect reported EK0502 though its type came out right; `try` now runs such a value.
- Parentheses inside `Readonly<Record<K, V>>` schema declarations were rejected; grouped arguments now map to the same readonly record schema.
- The specification split `for concurrent` limits into "above 1" and "at or below 1", which left `NaN` in neither: it said nothing about whether a `NaN` limit forks each item or materializes the iterable. It now follows Effect's own resolution, `Math.max(1, n)`: only limits resolving to `1` run on the enclosing fiber, and every other limit, `NaN` included, forks one fiber per item, so a `NaN` limit runs one item at a time, materializes the iterable first, and interrupts each item's `fork` children when the item ends.
- A local value named `Data` could capture the builders generated by a `data` declaration; generated references now keep the Effect module while source references keep the local value.
- The specification said a `try` or `yield` in any default runs in the enclosing effect function, while its next paragraph says a parameter default can't run an Effect. It now says that only a destructuring default in effect code suspends, as `await` does in an `async` function, and that a parameter default can't.
- The `catch` head rule left erased TypeScript wrappers ambiguous. It now follows them consistently while preserving explicit source parentheses as a boundary.
- Dynamic imports were implicit in the specification's Promise-call list and their failure phases were unclear. The bridge trigger now names runtime imports, distinguishes argument throws from Promise rejection, and leaves type queries erased.
- The specification defined effect code as Appendix A's Effect-parameter code minus class field initializers, which that grammar never parses with the parameter, and said `fork(x)` and `join(x)` keep their TypeScript meaning everywhere outside effect code. The definition now follows Appendix A: class field and enum member initializers parse without the parameter, while a parameter list or `static` block keeps its reservation, so a `join(p)` parameter default is `EK1701`, as `await` there is a SyntaxError.
- The `match` specification left constrained generic subjects ambiguous; it now checks their finite constraints, honors represented TypeScript flow refinements and preserves ordinary literal types.
- Migration instructions omitted `--fix` from a scoped codemod command; both scope flags are now documented and tested with `--fix` in either argument order.
- A provider-comma line break could lose its documented keyword classification; recoverable heads now retain `provide` and `EK1202` on either side of the separator.
- Effect type fixes could suggest invalid bang syntax directly after `extends` or `implements`. Those base types now keep their named spelling; nested type arguments remain eligible for shortening.
- A helper return-type quick fix could write an imported type name that was out of scope and be refused by `--fix`. It now qualifies the type through its import, or uses `infer _` when a type cannot be written there.
- `vibelang --fix` could refuse a safe rewrite inside `Effect.catchTags` because an existing error quoted its old arguments. It now keeps that diagnostic's identity while applying the rewrite.
- Host timer and object-URL methods could escape checks through aliases, interface augmentations, or static `globalThis` constructor keys; those reads now consistently report `EK4402` while pure helpers and local implementations remain valid.
- `when undefined:` and a pattern naming a contextual keyword such as `of` or `type` failed with `pattern expected`; both now parse as the literal or name they spell, in `match` and in `is`.
- Running the migrate flow's setup again left the earlier setup's `.vibelang-toolchain` tarballs on disk, where `jj` committed them with the new setup; setup now removes that directory before it returns to the Effect upgrade.
- In the specification's region-body rules, a paragraph about `do` checks sat between the sentence ending "how it transports completions is its choice:" and the list it introduces, so it read as that list. The paragraph now follows the list.
- `vibelang --fix --fix-vip-only` removed the `try` of a plain call that gives a yieldable error, `return try toError(id)`, so the error became the program's success value, and `--fix` did the same to `yield* toError(id)`; both now write `throw toError(id)`, keep `try` where no statement can throw, and write `try x.asEffect()` for an `Effect.Yieldable`.
- The migrate flow's setup edited a vendored repository that no workspace names (foldkit's `repos/effect`): its `package.json` scripts, `dprint.json` and tsconfig files; setup now wires only the root and the workspace's own packages, as the Effect upgrade does.
- The specification named no diagnostic for `fork.other e`, `fork.in(5) e`, `try.map x`, `for concurrent("fast")`, a reserved `{ join }` shorthand, or a `using` head in `for concurrent` or `for try`, and Appendix B omitted the compiler's `EK1802` for the retired `await.all` operations. They are now `EK1705`, `EK1706`, `EK1803`, `EK1907`, `EK1702`, and `EK1906` or `EK2005`, with an `EK1802` row, in chapter 2 and Appendix B.
- An explicit empty service key, `static readonly key = ""`, was replaced with a derived name; `""` now keeps its identity at runtime, in declarations and in duplicate-key checks.
- `Effect.Array`, `Effect.String`, `Effect.Record` and the other Effect modules named like a JavaScript or TypeScript global reported `TS2339` in a `.vibe` file, so the specification's `Effect.Array.head(xs)` did not compile; each now names Effect's module, and the emitted code imports it.
- A type under one of those modules, such as `Effect.Array.NonEmptyReadonlyArray<number>` or `Effect.Record.ReadonlyRecord<string, number>`, reported `TS2694`; it now names the module's type, and the declaration file writes it as `import("effect/Array").NonEmptyReadonlyArray<number>`.

- A service with `static readonly defaultValue` could be written as a type, `let flags: Flags`, and the declaration file then used the `Context.Reference` constant as a type, which broke TypeScript consumers; that type now reports `TS2749` (`TS2694` in an import type), and `Flags.Shape` and `typeof Flags` still work.

- A type query of one of those modules, such as `typeof Effect.Array` or `typeof Effect.Array.head`, reported `TS2339`; it now names the module, and the declaration file writes `typeof import("effect/Array")`.
- The concurrent-loop ownership example passed a string to `sync`, which requires a thunk. Both calls now use valid thunks, with a matching Effect counterpart.
- Computed field names appeared interchangeable between `error` and `schema error`. The specification now uses each native counterpart's key checks and retains TypeScript's `TS1170` for rejected payload key forms.
- The specification described plain error payload keys as runtime reads, incorrectly implying a later key binding would fail. Plain payload keys are now explicitly erased type members; schema keys and method names keep their runtime evaluation.
- A `.vibe` file with no Effect form still declared an inferred `Effect.Effect<A, E>` and imported `Effect`, as `Runtime.makeRunMain` did, where TypeScript writes `import("effect/Effect").Effect<A, E>`; the name now appears only in a file that writes it or has an Effect function, `A!E!R`, `try` or a bare Effect global.
- Effect lint instructions named only `.vibe` files; they now explicitly cover selected `.ts` and `.vibe` inputs with the upstream rule eligibility and file exclusions.
- The migrate flow judged a test runner without Vitest's JSON report by its exit status, so a baseline with failing tests stopped `upgrade-effect`; `--test-report <pattern>` now reads each test's printed line, and the run compares test by test.
- The specification left diagnostic coverage unclear for concurrent operations other than `try.all`. It now states the same context and operand checks for all four operations, with the existing error codes.
- The specification left the ending check for `do` undefined for empty switches and VibeLang loops. It now uses an explicit empty-switch base case and the native iteration checks, preserving nonfinal values and rejecting final loops.
- Service default initializers had an unspecified Effect boundary; they now follow source class-field rules, with Effect-based factories computed before the declaration.
- Effect functions and methods inferred `void` for throw-only or mixed throw/fallthrough bodies; they now infer `never` or `undefined`, matching `Effect.gen`.

- Service shapes with properties named `key` or `defaultValue` were rejected when the service declared the matching identity or default factory; these ordinary implementation properties now work.

- Service members using a direct `this` type compiled when TypeScript rejects the corresponding shape; they now report `TS2526` and explain how to use a named type or interface.

- The migrate flow failed a batch on `EK4832` for an exported `Schema.Struct` constant with no type export, which `--fix` must leave because a `schema` declaration would add a public type; `verify` no longer counts it.
- The ESLint configuration the migrate flow writes for `.vibe` files enabled typescript-eslint's recommended rules whatever the repository's Oxlint configuration chose, so a rule the repository turns off, such as foldkit's `no-explicit-any` under `packages/foldkit/src`, failed its lint on migrated files, and the rules it enables never ran on them; the configuration now reads `.oxlintrc.json` on each run and applies its rules and overrides wherever ESLint or typescript-eslint has the rule.
- The migrate flow's `--fix` dropped an Effect import the declaration file prints when a tsconfig set `noEmit`; it now asks for declarations, whatever the tsconfig says.
- `vibelang lint` ignored the Oxlint and ESLint disable comments a migrated `.vibe` file keeps, such as `// oxlint-disable-next-line effecttsgo/schema-sync`, and reported the rule anyway; it now honors them as Oxlint does.
- The migrate flow left a `Data.TaggedError("E")<{ … }>` field unmarked, so the migrated `error` declaration declared it `readonly` where the TypeScript's declaration did not; the codemod now marks it `mutable`.
- The sidecar guide listed `bun check` without requiring a `check` script, so the documented command failed in a new Bun project. It now explains how Bun invokes the project's TypeScript checking script.
- The `knip.config.ts` the migrate flow writes held a type assertion, `{ … } as { ignore?: … }`, so a repository whose Oxlint or ESLint forbids type assertions (`typescript/consistent-type-assertions`) failed its lint on the migrated configuration. It now declares the type, `const config: { ignore?: …; [setting: string]: unknown } = { … }`.
- The formatter sorted the names within an import or export, case-insensitively, so `import { Option, String, flow }` became `import { flow, Option, String }` and a repository's Oxlint or ESLint `sort-imports` rule then failed on the formatted file. The names now keep the order you wrote.
- A tool that reads a `.vibe` file through the TypeScript mapper, such as Oxlint through the Oxc fork's VibeLang hook, reported `TS1338: 'infer' declarations are only permitted in the 'extends' clause of a conditional type` at each `: infer _` return annotation, because the mapper kept it in the TypeScript it returns. The mapper now drops the annotation, and TypeScript infers the return type from the body, as `infer _` means.
- Appendix A still described one modifier diagnostic after the error-member rule had been corrected. It now preserves the full applicable Functions diagnostic set without a redundant error-body category.
- Schema references could silently make required fields, tuple slots or record keys optional, or readonly fields writable. The specification now rejects conflicting decoded-key flags with `EK2109`, including implicitly readonly schema-error payloads.
- Service reads such as `try Users` were rejected as non-Effects; service keys now pass the Effect operand check.
- Rejected pattern syntax such as primitive template interpolation had no assigned fallback code; the reference now uses `EK0707` while preserving specific pattern diagnostics and independent TypeScript errors.

- Service bodies and value initializers reported a legacy error and suggested making the member static; they now report `EK0902` and direct the implementation into a layer. Members in an aliased-shape service body use the same member diagnostic.
- A `data`, `schema` or `error` declaration with its opening brace on the next line gained extra indentation on its first format pass; it now reaches its final indentation in one pass.


- A `try` in a service's `defaultValue` initializer reported `EK0501` with advice to make `defaultValue` an effect method, which a service cannot declare; it now explains how to compute the value before the declaration and capture it in the default factory.

- The migrate flow ran `vibelang --fix` over a whole package for each batch, which rewrote files earlier batches had committed and undid their hand repairs; each batch now keeps the rewrites of its own files only.
- The migrate flow's rules told the repair agent that a function with no Effect operation stays plain, while the toolchain compiles an unannotated function or method to an Effect; the rules now say to write its return type or `: infer _`, and list the skill's forms the toolchain does not implement yet with what to write until each lands.
- The migrate flow judged a test command without per-test results by one exit status, so a flaky test stopped `upgrade-effect` with "the target's tests do not run" or read as a batch's regression; such a command now runs once more after a nonzero exit, and the second run counts.
- A `.vibe` file in a project without `vibelang-runtime` or `effect` installed reported only `Cannot find namespace 'Effect'` or `Cannot find name 'TaggedError'`, and its exports declared `any`; each such error now names the package that supplies the name and says to install it.
- EK4833 warned on `interface Api<A> extends Effect.Effect<A, never, never>`, where `A!E!R` cannot stand and its quick fix was refused; it now skips an interface's `extends` element and still rewrites an Effect type nested in its type arguments.
- The migrate flow added `vibelang` to the `devDependencies` of every package whose lint script it extended with the root ESLint config, which resolves `vibelang/eslint` from the root, so Knip reported it unused in each such package; setup now adds it only to the root and to packages whose own scripts run `vibelang-format` or the Prettier plugin.
- A file that imports Effect's modules as namespaces, `import * as Context from "effect/Context"`, got a declaration file that imported `{ Context } from "effect"` for a `service`, or `{ Context as Context_1 }` beside its own import, and `--fix` dropped the import or shortened `Duration.Duration` to `Duration`, which printed another alias. The declaration file now uses the file's own import, `--fix` keeps it, and `noUnusedLocals` accepts it.
- Running the migrate flow's setup again on a new toolchain committed, then stopped at `Refusing to move bookmark backwards or sideways` and wrote no `setup.json`; the new setup now replaces the earlier one, and a bookmark with a recorded batch on it still refuses.
- The migrate flow never told a batch that a `node` script reaching a migrated module needs `--import vibelang/register`, so the script failed on the `.vibe` import; the migration rules now say so.
- The return-type quick fix of EK1001, EK9203 and EK4301 printed a type from another module or a namespace by its bare name, which in a `.vibe` file can name a prelude module (`: string | Ref<Any>` wrote Effect's `Ref`); it now prints the type through the names that reach it from the function, or writes `: infer _`.
- In a plain function, a `return`, `break` or `continue` in a `finally` block was an error (`EK2006`), and a `throw` there was joined to the failure in flight, so `try { throw new Error("x") } finally { return 3 }` failed instead of returning 3. Each now replaces the pending throw or return, as in JavaScript.
- Changing a workspace dependency’s `vibe.config.json` or `jsconfig.json` could reuse stale compiled output. The loader cache now tracks the nearest supported config, preferring `vibe.config.json`, then `tsconfig.json`, then `jsconfig.json`.
- Projects enabling `@effect/language-service` could crash the compiler while checking optional schema fields; builds and lint now use the correct checker layout.
- In a project that emits declarations, `EK4832` and `--fix` rewrote a struct exported with `type X = Schema.Schema.Type<typeof X>` to `schema X { … }`, which declares `type X = typeof X.Type`, so the declaration changed; they now leave that spelling, and the interface form, as written.
- The migrate flow's inventory listed the `x.d.vibe.ts` declaration sidecars that `vibelang` writes beside each `.vibe` file as Effect source files and plan candidates, and the codemod would have renamed one to `x.d.vibe.vibe`; both now treat every `x.d.<extension>.ts` as a declaration file.
- The migrate flow's Effect upgrade kept the earlier toolchain's `vibelang-runtime` in a repository VibeLang had already set up, and that runtime imports what the new Effect removed, so the upgraded tests failed by the thousand (1919 on foldkit) and read as Effect regressions; the upgrade now moves the VibeLang packages the repository uses to this run's release in the same commit.
- Nested interruption examples left the target of `restore` implicit. It now explicitly restores the nearest mask's entry state, including an already uninterruptible state, with a pending-interruption example.

- Service construct signatures could compile as methods or produce a misleading missing-contract error; they now report one `EK0902`, while quoted, computed, and optional methods named `new` remain valid.

- Without host declarations, missing `fetch`, `process`, and `Buffer` names appeared as banned platform APIs; the compiler now keeps TypeScript's missing-name and missing-property diagnostics.
- The migrate flow read a compiler crash as a clean run, recording no errors and no fixes; `compile`, `codemod` and the declaration step now stop and show the crash.
- The migrate flow left a `.d.ts` beside each source file outside a project's `rootDir`, and the batch's commit picked them up; the declaration step now removes what the compiler wrote outside its output directory.
- Repeated Vite development requests could lose the original source paths and text in cached source maps; each request now keeps an independent map, including inline module outputs.
- The migrate flow committed `.vibe` files that `vibelang-format --check` rejected, so a target's format check failed on its first batch; `record` now formats each batch's `.vibe` files with `vibelang-format`.
- `await runPromise(program)` in an `async` function reported `EK1005`, although `EK0103` tells you to write exactly that; no fiber runs an `async` function, so a runner is allowed there.
- The migrate flow's setup left a package tsconfig's `include` at `src/**/*.ts`, so a composite project rejected its first `.vibe` module with `TS6307`; setup now adds `src/**/*.vibe` beside each `.ts` or `.tsx` pattern.
- The migrate flow's ESLint config for `.vibe` files failed on a repository using TypeScript 7, because `typescript-eslint` refuses it; the config now uses its recommended rules only where it loads.
- The migrate flow found no Vite config for packages whose test script names a shared one, and wired the plugin into an Astro app's `vite.config.ts`, which broke `astro check`; it now follows `--config` in each package's test script, and leaves an Astro app to `astro.config` with a warning.
- A Vite config in a CommonJS package failed to load `vibelang-vite` with `ERR_PACKAGE_PATH_NOT_EXPORTED`; it now loads through Node's `require` of an ES module.
- The migrate flow failed declaration identity when `vibelang-format` reordered a named import, such as `{ ThreadId, type Ref }` to `{ type Ref, ThreadId }`; the gate now compares an import or export list in sorted order.
- A module augmentation of a `.vibe` module, `declare module "./user.vibe"`, kept the source name in the emitted `.d.ts`, where no such module ships, so a consumer got `TS2664` or, under `skipLibCheck`, lost the augmentation; it now names `./user.js`. A declaration sidecar names `./user.vibe` in an augmentation and in `import x = require(...)`, so stock TypeScript finds the sidecar there too.
- The migrate flow added `vibelang-vite` to every migrated package, so Knip reported it unused in each one without a Vite config; only a package that owns a wired config gets it now.
- The migrate flow's setup added `vibelang-vite` to Vite configs of test fixtures in directories not named `fixtures`, such as `test/Cloudflare/Website/vite-do-fixture/`, which edited tests; it now skips every directory whose name contains `fixture` and every `test`, `tests` and `__tests__` directory.
- The migrate flow's setup ran `vibelang agents init` after its format pass, so the `.claude` plugin manifests and `opencode.json` it wrote failed the target's format check; setup now formats them with the target's formatter.
- The specification omitted imported lint rule codes and defaults; it now publishes a generated table for every rule in the pinned upstream release.
- The specification omitted shipped throwing-call contracts; a generated inventory now records each pinned library overload, its callbacks and any returned callable.
- A plain `error` pattern rejected errors from another copy of a package; it now matches the same `_tag`, an error family's base still matches its subclasses' errors, and its extractor binds the original value.
- A `data` declaration with more than four type parameters reported `EK2126`, the constraint diagnostic; it now reports `EK2801` and constraints keep `EK2126`.
- Template-literal keys and repeated `globalThis.globalThis` accesses bypassed platform diagnostics; equivalent static spellings now report the same `EK4402` as direct access.
- Host globals missing from the old name table bypassed platform diagnostics; their declaration files now identify values such as `FileReader`, `WebAssembly`, and `globalThis.Headers` and report `EK4402`.
- The migrate flow failed a batch's declaration identity whenever a renamed module's importer had written `./leaf.ts`, because the importer's declaration now says `./leaf.js`, so every such module had to stay TypeScript; the gate now treats a relative `./leaf.ts` and `./leaf.js` as one module, since TypeScript resolves both to `leaf.d.ts`.
- The migrate flow's Effect upgrade rewrote every tracked `package.json`, including vendored repositories and fixtures pinned to an old Effect on purpose; it now moves only the root and the workspace members the package manager installs.
- The migrate flow's `upgrade-effect` step stopped with `Refusing to move bookmark backwards or sideways` after committing when `--base` named a commit behind an earlier run's bookmark; `--base` now restarts the bookmark there.
- Installing `vibelang` with pnpm 11 or later exited with `ERR_PNPM_IGNORED_BUILDS` for `dprint`, and the migrate flow's setup stopped there; the setup guide now shows the `allowBuilds` entry, and the flow adds it.
- The migrate flow staged every build of one VibeLang version under the same tarball name, so a target's npm, Bun or pnpm install could keep parts of the earlier build and a rebuilt toolchain's `vibelang-format` command was missing; setup now names each staged tarball for its content.
- An exported value whose inferred signature comes from a library, such as `Schema.decodeUnknownSync(Schema.String)`, declared `SchemaAST.ParseOptions` and added `import { SchemaAST } from "effect"` although the file never wrote `SchemaAST`, so its declaration differed from TypeScript's; it now declares `import("effect/SchemaAST").ParseOptions`, as TypeScript does.
- The specification's method-call example consulted mutable invocation helpers and changed native errors. Its counterpart now uses an ordinary call, preserving receiver and callee evaluation.
- A comparison-table row appeared to allow both execution operators in either function body. It now explicitly pairs `await` with its `async` context and `try` with its effect context.
- The specification left template-pattern admission and signed-zero exhaustiveness inconsistent. Primitive templates now require no substitutions and compare without coercion; signed Number-zero arms no longer claim to cover both zero signs.
- The specification nested async-match Promises and gave default or negated custom-matcher arms incorrect types. It now adopts async results and follows TypeScript control flow for the actual ordered matcher tests.
- A cached-match counterpart read mutable `Reflect.apply` and diverged when it was overridden. The specification now keeps the behavioral cache rule and a fixed native-generator witness, removing the lowered helper recipe.
- The execution overview omitted fiber joins and typed throws and said calls perform no work. It now lists both execution sites and distinguishes ordinary call evaluation from running a returned Effect.
- The tooling reference implied every compiler error used a VibeLang code; it now distinguishes native TypeScript errors from VibeLang grammar and proposal errors, including independent errors inside embedded code.
- The specification gave conflicting diagnostics for `try x catch (e) { … }`; it now reports the missing handler function first and shows an explicit plain or Effect-handler repair.
- The specification omitted `fork` and `join` in ordinary async-arrow heads inside Effect code; those heads now inherit the same reservation as plain arrows, while their bodies keep ordinary async behavior.
- The documented `Fiber` and `Deferred` warnings suggested Effect-only syntax in `async` functions; their repairs now use the existing `runPromise` bridge and keep the source function asynchronous.
- The specification left Effect type slots ambiguous beside tuple markers, object types and expression operators; it now preserves the surrounding TypeScript syntax and states when the requirement slot is present.
- The advice for renaming an imported `join` used a forbidden Node value import. It now uses an admitted relative VibeLang import.
- The specified service shape alias created circular base types for recursive contracts, while local services could capture incompatible generic shapes under one key. Shapes now name their member object directly, and captured outer type parameters are `EK3005`.
- The pattern grammar left empty-array patterns ambiguous, omitted regex-literal extractor suffixes, and let a local `not` binding compete with prefix negation. Each now has one syntax-based meaning, and identifier presence keys explicitly retain their accepted meaning.
- The Promise analogy appeared to admit `async do`, which VibeLang does not adopt. It now uses a native async arrow call, and `async match` jump rules cite their accepted VIP.
- The Promise comparison omitted that returning an Effect leaves it unrun. It now contrasts `async` return assimilation with Effect success data and shows `return try e` when the inner result is intended.
- The pattern specification left failed `or` binding replacement and repeated lexical `is` loop bindings inconsistent. Alternatives now retain one shared cell, while loop conditions use fresh cells and preserve the initial do-body TDZ.
- The matching specification inherited inconsistent iterator records, list cardinality, expression reads and property order from the pinned draft. It now states one set of source-order and ECMAScript protocol rules, preserving primitive iterables, optional absence, ordinary rest copying and inclusive comparisons.
- The catch explanation incorrectly attributed a mixed failure/defect Cause to `try.any`. It now describes recovery without that origin claim; the native operation already elects those failures to defects.
- Imported generic `data` constructors could report `EK4401` when read from a standalone declaration file; their declarations now retain Effect’s constructor signatures, so direct calls and aliases work without a boundary wrapper.
- Bare `Model` and `Prompt` gave generic missing-name errors, while `Utils` silently chose the root module; `EK1401` now lists every exporter and offers each import, and `--fix` preserves a previous root `Utils` binding with an explicit import (VIP-14, detail 55).
- Host-specific `import.meta` members and copies of its object compiled in `.vibe` files; only direct `import.meta.url` reads are now allowed, with `EK4402` explaining how to move host access to TypeScript.
- Copies of `globalThis` and reads through nonliteral keys bypassed its access restriction; they now report `EK0107`, while literal member access, type queries and local shadows keep working.
- Literal `data:` and `blob:` imports could load string-supplied code from `.vibe` files; they now report `EK0107`, including URL-equivalent scheme spellings and imports inside Effect wrappers.
- Inline type-only and empty Node imports could retain runtime module loads under `verbatimModuleSyntax`; they now report `EK4402`, and the type-binding fix writes an erased `import type` clause.

- A `service` could silently accept index signatures or constructor bodies; both now report `EK0902` with guidance to declare named contracts.

- Effect functions such as `andThen`, `scoped` and `tryPromise` needed a qualified name, and the skill's first program failed with `TS2304`; every non-clashing `Effect` export is now global, and `vibe.effectGlobals` can turn them off.

- A `match` or `if`/`else` chain with thousands of arms over a large union took about a minute and a half to check; repeated narrowing now reuses its results, so a 2000-arm `match` checks in about 10 seconds.
- The specification checked throwing calls in plain handlers' bodies but skipped eager parameter initialization. The same check now covers defaults, destructuring and computed binding keys, while implicit exceptions and uncalled functions keep their existing behavior.
- Formatting a `catch` expression with a comment before its handler was refused; those comments and their line breaks now stay in place.
- The specification lost loop-head binding scopes and allowed forbidden returns to hide in binding defaults. Both loop forms now retain JavaScript's operand scopes and apply their outward-jump restrictions to head initialization as well as the body.
- The specification could lose a synchronous throw when a generic result became an Effect or a callback default disappeared from a declaration. Existing generic contracts and conservative default-callback bounds now survive both boundaries.
- A required schema field could silently become optional through a referenced codec; conflicting or uncertain decoded optionality now reports `EK2109`, with a preserving `--fix` expansion to explicit codecs.
- The platform decision gave banned `globalThis` members the wrong diagnostic and omitted the allowed `Function` checks; it now agrees with the language reference and the accepted `Function` exemptions.
- Closing a bundler build or watcher during compilation could leave the compiler and its output pipes running. The `vibelang-vite` and `vibelang-unplugin` integrations now await teardown and stop a compiler that exceeds a one-second grace period.
- The specification’s priority statement relied on an unspecified decision layer. It now points readers to accepted VIPs, their public amendments and cited counterparts, with the same publication rule in the VIP index.
- Region completion examples exposed compiler control records or normal block values to layer finalizers. Finalizers now see the original generator payload while source values and jumps remain intact.
- The specification widened every `do` literal and dropped values crossing transparent blocks. It now keeps ordinary expression typing and complete source completion values, including empty completions and values carried by jumps.
- Forbidden Effect modifier positions lacked a specified diagnostic, and error members could lose a second modifier diagnostic. The specification now assigns `EK0108` and preserves applicable `EK0104` and `EK0105` without an extra member-category error.
- Editor formatting and the formatter companion ignored project style or used different output; the language server, `vibelang format` and formatter plugins now share the project's dprint configuration and format unsaved editor text without writing it to disk.
- The specification implied that running a completed Effect always suspends like `await`. It now states Effect's native scheduling behavior and when to request a cooperative yield.
- The specification omitted Promise-returning tagged templates from its explicit bridge trigger. The same Promise-result rule now covers tagged invocations and keeps the original call inside the bridge.
- The specification mixed generator-body throws with construction and copied synchronous callback throws onto async declarations. Call contracts now follow execution phase, and async declarations retain callback admission without inventing synchronous throws.
- The formatter specification did not distinguish executable JavaScript from embedded source maps. It now preserves code and diagnostic codes while requiring fresh maps for the formatted source.
- Producer docs promised a global two-element lead even with concurrent yields. That bound now applies to one sequential emitter; concurrent item fibers can each compute a value before waiting to offer it.
- The runtime specification omitted construction traces, so equal `Exit`s could hide an eager body. It now requires call-time and full run traces, including eager defaults and repeated runs.
- The severity guide described only four-digit codes. It now shows how to configure full printed codes such as `EK38100`.
- The producer specification still required one receiver-passing recipe after the shared binding rule had replaced it. Producers now use the same source-binding behavior as Effect functions, with the implementation left to the compiler.
- The specification gave conflicting meanings to `fork` and `join` in class and enum initializers. It now follows their ordinary initializer context, keeps class heads in the enclosing context, and distinguishes static keyword reservation from permission to run Effects.
- The specification required recursive thrown types that could grow forever or produce invalid declarations. Expanding summaries now conservatively use `unknown`, while finite recursive summaries stay precise.
- The public pattern decision omitted the accepted rule for negated custom matchers; it now states that narrowing follows the actual recognition test and demonstrates the ordinary-class and custom-matcher cases.
- The reference did not explain how to provide a local named `effect`; it now shows `provide (effect) { … }` and distinguishes it from an Effect-block provider.
- The public pattern decision omitted Promise adoption and default-arm flow; it now states the accepted TypeScript rules and shows that a failed guard can leave both subject types possible.
- The `try` reference omitted unchecked `any` operands; it now explains native delegation, including noniterable defects and iterable completion.
- The concurrency reference omitted when inputs are pulled or closed; it now states the pinned Effect behavior for sequential traversal, parallel materialization and array reuse.
- The specification described every numeric concurrency limit as an exact upper bound. It now delegates the full numeric domain to Effect, including zero and below-one limits that still run all items sequentially.
- The specification’s mixed-modifier diagnostic omitted blocks. Both `effect async { … }` and `async effect { … }` now recover with `EK0105`; the valid repair removes `async` and keeps the Effect block.
- The specification admitted data variants named `$is` or `$match`, whose calls reached Effect helpers instead of constructing variants. It now reports `EK1602` and suggests renaming the variant and its references.
- The accepted interruption rules named only some callable forms and could appear to reject a callable's own mask. They now cover every independent effect activation and explicitly allow its local mask.
- `Date.now()`, `Date()`, `new Date()`, and `Math.random()` were incorrectly rejected with `EK4403`; these ECMAScript built-ins now compile as VIP-33 requires.
- `vibe.effectModules: false` left implicit Effect names available; it now requires imports, filters implicit editor suggestions and keeps required imports during `--fix`.
- A module-level `provide` block reported a generic top-level error and suggested implicit execution through `main`; `EK1201` now points to an `effect function` or `effect { }` block (VIP-12).
- Bare internal HTTP, TLS and legacy stream imports escaped the Node platform check; they now report `EK4402` like their `node:` forms, while type-only imports remain erased.

- `service` accepted extra static helpers and could crash on a computed static name; those members now report `EK0902`. The supported `static readonly default` migration still reports `EK4855` and can be repaired without an extra `EK0902`. The same rule covers inline object and scalar shapes.

- Local services and services without a named package silently received fallback keys; they now require an explicit key, with a quick fix that preserves the existing identity.

- Service keys accepted class modifiers, and default properties could omit `readonly` or an initializer; these malformed declarations now report `EK0902`.

- Config migration could put severity settings inside a JSONC comment containing `{`; it now keeps the settings active and the comment intact.
- The specification left import-free `.vibe` files with conflicting scope rules. It now requires module scope before checking, preserves it in JavaScript and declarations, and states the `moduleDetection` exception and ordinary host behavior.
- The specification incorrectly required `for concurrent` on one line. A newline after `for` is now allowed, matching native `for await` and leaving the loop behavior unchanged.
- The specification could misread `effect is …` and `async is …` as invalid function shorthand. Both now retain their pattern-test reading, alongside the existing `as` and `satisfies` expression exclusions.
- The introduction hid contextual keyword parsing behind its promise about plain TypeScript code. It now states that those rules also apply in plain code and links to their declaration and expression boundaries.
- Project warning severities under `vibe.severities` were ignored; they now apply with config validation and inheritance, and `vibelang --fix` migrates legacy `vibelang.diagnostics` settings.
- Severity overrides for `EK0508`, `EK0703` and `EK0801` lost their leading zero during lookup; all four severity values now apply to these warnings.
- Terminal diagnostics dropped leading zeros from VibeLang codes; they now preserve them. See the [diagnostic code map](../vibelang-features/diagnostic-code-map.md).
- `for try (x of s)` and `for try (var x of s)` reported a generic `Variable declaration expected` syntax error with no fix. They now report `EK2005`, which says to declare the element with `const` or `let` and assign the existing variable in the body.
- `Stream` loops previously depended on the operand type; `for try` now explicitly consumes a `Stream` with `continue` and `break`, and rejects a `return` or a labeled jump out of the loop in its head bindings or body (`EK2002`, `EK2003`).
- An identifier or call followed by a separate block on the next line was rejected with `EK1022`. Standalone blocks now compile normally, including after identifiers named `uninterruptible`, `interruptible` and `restore`.

| A user-written `static` member in `error` or `schema error` | `EK1302`; run `vibelang --fix` to keep the fields and `static` members in an equivalent Effect TypeScript class. |
| A setter in `error` or `schema error` | `EK1302`; run `vibelang --fix` to retain it in an equivalent Effect TypeScript class. |
| Type parameters on `error` or `schema error` | `EK1303`; `vibelang --fix` converts a plain generic `error` to an Effect TypeScript class. A generic `schema error` needs concrete fields or a TypeScript schema factory; no class fix is offered because it would introduce `TS2562`. |
| `when -0:` or `when +0:` written to match either zero | Write `when 0:`, which matches both zeros. A signed zero now matches only that zero, and `EK4701` reports a `match` that relied on it to cover `0`. |
| An explicitly `readonly` schema field referencing mutable or uncertain decoded key flags | `EK2109`: run `vibelang --fix` to retain the existing codec as an explicit `Schema.Struct` value. Nested value mutability is unchanged. |
| A `match` arm that ends in a new line, in `,`, or at `}` without `;` | `EK0701`: run `vibelang --fix` to write the `;`. |
| Required tuple positions used a schema reference with optional decoded keys | `EK2109`; run `vibelang --fix` to preserve the existing codec, declarations and decoding with explicit Effect codecs. Schema-error declarations keep their constructor and matcher behavior. |

- EK4802's quick fix "Call it to run it" was offered in a function whose written contract rejects what the call runs, such as `return Exit.fail("data")` in an `unknown!!` function, and applying it added EK2001. It is now offered only where the contract accepts the call's failure, requirements and success.
- `vibelang --fix` could write a fix that added a type error when the file also had an unrelated syntax error, because its check of the fixed program then saw only syntax errors. It now checks every error, so such a fix is listed as not fixed.
- Bun, `vibelang/register`, Vite and unplugin could report `Cannot find module` for extensionless or directory imports after their TypeScript targets became `.vibe` files. They now resolve those imports with TypeScript's file priority and `index.vibe` fallback, preserving existing source files.
- The diagnostic reference omitted compatibility checks and the three existing requirement/service migration warnings. It now lists all eight interim `EK92xx` checks with their meanings and retirement owners, plus the migration warnings and their defaults.
- Async conversion could put a directly nested `await` inside a plain callback; the refactors now decline that body and preserve nested function boundaries.
- Async conversion could leave a returned Promise unbridged in an effect body; the refactors now require an explicit `await` for Promise or thenable returns, including unions that may contain one.
- Async conversion could pass a scalar or unproven `await` operand to `Effect.tryPromise`; the refactors now require Promise-like operands and retain nested async functions unchanged.
- A producer could silently discard a returned value. It now reports `EK2128`: a Stream has no return value. `vibelang --fix` keeps the value's evaluation and ends the stream with a bare `return`.
- The specification admitted generic parameters and return annotations on a bare effect-arrow parameter. Arrow heads now follow TypeScript: those decorations require parentheses, while `effect x => x` remains valid.
- The specification excluded valid effect-function overload signatures, decorated class methods and ordinary error-method overloads. Their grammar now follows the corresponding TypeScript declaration positions and checks.
- The specification inherited pipe-draft errors that rejected valid topic use or left chains and precedence undefined. Its effective grammar and operations now preserve sequential chains, nested topic scopes and ordinary TypeScript operators.
- The specification could lose a synchronous throw behind an effectful overload or an escaped rethrowing callback. It now checks every exposed overload bound and preserves the callback contract on returned and nested callables.
- The specification omitted the surviving TypeScript-form advisory codes and their safe repairs. The reference now lists them as configurable warnings and excludes advice for retired language features.
- The specification introduction described every Effect TypeScript comparison as an unchecked fragment. It now distinguishes partial examples from complete comparisons that can be checked directly.
- The specification did not prevent generated temporaries from changing anonymous function and class names. It now preserves source naming context, including names observed by class static initializers.
- The proposals comparison still listed handlers as shipped, and upstream drafts linked retired local research sources; handlers now remain explicitly open under VIP-35, archived chapters state that the first release has no handlers, and historical evidence links to its source revision.
- Benchmark projects could miss packages when the experiments and docs installs shared an npm scope. Staging now merges each scope's packages while keeping the first package found and the runtime's `effect` copy.
- Enabling `strictEffectProvide` silently skipped functions named `main`; it now reports those sites too, matching Effect TypeScript, so entry points can suppress the warning explicitly (VIP-26, VIP-38).
- A failed `scripts/remote.sh` sync could leave a temporary tracked-files list behind. The list is now removed on success and failure.
- `Headers`, `Request`, `Response` and `Event` used host constructors instead of Effect namespaces; values now name Effect modules while ambient types keep their meanings, including in emitted declarations.
- Migrating a retired `catch (cause: Cause)` could leave it unchanged because the replacement passed a plain value to `exit`; the fix now captures and runs the protected code inside an `effect` block.
- Nested `provide` hints falsely claimed separate builds and recommended removed `wire`. `EK4808` now suggests native composition that retains both layer outputs; the unsafe automatic merge is retired because it can change when provider expressions run and layers build.
- Editor input quick fixes could introduce argument errors, and helper annotation fixes could leave a callback error unchanged; unsafe repairs are now withheld, and captured inputs keep their types.
- Repository example staging now uses one local-package mapping for dependencies and overrides. The staged versions and published example manifests stay unchanged.
- Plain service method return types such as `number` reported `EK9205`; written plain and Effect return types are now accepted, while a missing return type still reports the error (VIP-9).
- Assigning to a service property without `readonly` reported a read-only error; service shapes now preserve the written property modifier, and service migration keeps read-only properties read-only (VIP-9).
- Outside its own member types, a local service's `S.Shape` compiled even though its namespace cannot exist inside a function or block; it now reports TypeScript's namespace error and offers `Context.Service.Shape<typeof S>`. Recursive own-member types keep the private shape hook, and `--fix` preserves them (VIP-9, detail `181`).

- The specification described how an `effect` body reads `this` and `super` with a helper recipe that was wrong in five separate edge cases. It now states the behavior: the body reads them exactly as the same body in an `async` function does, and building the Effect reads none of them.
- The specification restated class-pattern and cleanup rules in several chapters, and the copies drifted. Each rule now has one definition that the others link to, and chapter 2 lists every place `try` differs from `await`, with its reason.
- The specification described `do` and defaults with hand-written lowering recipes, which disagreed with JavaScript in new ways each round. It now states the behavior: a default behaves as in JavaScript with the `do` proposal, a `return`, `break` or `continue` in an array pattern's default closes its iterator as the same jump does from a `for…of` body, and a throw in an `effect` function's parameter default gives an Effect that dies instead of throwing at the call.
- `EK4402` banned `AbortSignal.timeout` by name, with no rule that covered `const { timeout } = AbortSignal`, and the inventory the specification cited did not exist. One rule now covers platform members: a statically named value is `EK4402` when its symbol reaches the host. `docs/design/inventory/platform-globals.json` is generated and test-checked, and it also bans `URL.createObjectURL` and `URL.revokeObjectURL`, which store Blobs in the host.
- The specification's `EK4701` rule for `_tag` said "exactly one string literal type", which left optional tags, union tags and members that share a tag undefined. It now follows TypeScript's `switch (s._tag)`: each literal in the tag's type is a case, an optional tag adds the case `undefined`, and a `_tag` that is not a literal type turns the check off.
- The specification's fix for `fork e catch h` moved `e` onto the forked fiber, so a failure in `e` no longer reached the caller. The fix is now `fork Effect.catch(e, …)`: `e` runs on the caller, as a Promise's operand does, and the handler runs on the fiber.
- The specification's `A!E!R` productions allowed a line break between a `!` and its slot, while its notes called the same program a syntax error. One rule now covers every `!`: a line break ends an Effect type, as it ends TypeScript's postfix type operators.
- The specification left a `return`, `break` or `continue` out of a `match` arm undefined, and the pinned draft read literally turned `return 7` into `throw 7`. A jump out of an arm now behaves as the same jump out of a `for…of` body: cached iterators close, then the jump goes on. Chapters 3, 4 and 8 gave three different answers for which `throw` skips that closing; there is now one rule, and a no-match error is `new TypeError()` everywhere.
- Renaming the `_` in an old `infer _` return annotation could change inference and introduce type errors. The editor now declines that rename; ordinary generic and conditional `infer` bindings still rename normally.
- Organizing imports or renaming an old inline `module` declaration could introduce unresolved imports and new errors. The editor now refuses these unsafe edits; move the code to a `.ts` file, as inline modules are denied by VIP-25.
- The specification gave conflicting throw contracts for foreign callables and callback propagation; it now composes own throws with `@rethrows`, preserves contracts across declarations, and distinguishes both synchronous schema decoder builders from the decoders they return. Platform-global and namespace rules now agree across chapters. Stream-loop jump diagnostics now agree with the shared rule that a label on the loop itself is consumed there.
- `await.all`, `await.race`, `await.any` and `await.allSettled` still compiled beside VIP-18's `try` operations, with their own element rules and runtime helpers; they are now `EK1802`, and `vibelang --fix` rewrites them to `try.all` and its siblings with the same behavior.
- `sh scripts/bench/compiler.sh` could miss the compiler after a normal build; it now prefers the native build output while preserving `VIBELANG` overrides and legacy builds.
- `vibelang --fix` could refuse an `Effect.gen` rewrite because a yielded SQL query became unexecuted data. It now calls structured Effect results returned by `.vibe` helpers, preserving their execution.
- With `noUnusedLocals`, `vibelang --fix` could refuse a valid rewrite because it made an import from `effect` unused. It now removes those imports as part of the safety check.

- Commas between service method signatures were rejected as missing method bodies; methods now accept interface separators, including trailing commas (VIP-9).
- Commas between service properties reported `EK1013`; properties now accept interface separators, including trailing commas (VIP-9).

- The specification's `try.allSettled` counterpart, `Effect.all([a, b].map(Effect.exit))`, was a TypeScript error when the operands had different types, and lost the tuple when it compiled. An array literal now maps to `Effect.all([Effect.exit(a), Effect.exit(b)])`, typed as a tuple of `Exit`s, as `Promise.allSettled` keeps one.
- The specification lowered a destructuring default that contained `try`, `await` or a returning `do` into an arrow, so `const { x = do { return 9 } } = {}` returned from the arrow instead of the function. Such a default now runs in the enclosing function, keeping evaluation order, TDZ, `var` scoping and iterator closing.
- Running the optional Windows compiler check with `--vitest` in a path containing `#` failed with an unhelpful module error; it now explains Vitest's limitation and how to run compilation checks and `--vitest` checks separately.
- The repository hygiene scan rebuilt its fixed scratch-path rules for every file; those rules are now shared across the scan, preserving the same diagnostics.
- Effect tagged-error patterns rejected branded copies and namespace aliases; they now use the resolved module's guard, including in extractor patterns.
- The VIP migration left by-name arguments such as `Effect.retry(load() + 1, …)`, function values at program positions and `fork` callbacks implicit, so marking their functions could run the work at the wrong time. `vibelang --fix --fix-vip-only` now writes `effect { … }` blocks for by-name arguments, captures function values with `Effect.suspend` or `Effect.sync`, and writes `fork effect { … }`.
- The VIP migration left function literals in collections passed to `Effect.all` and racing combinators, so marking functions could leave their work unrun. `vibelang --fix --fix-vip-only` now writes explicit Effects at those program positions and keeps callback arguments as functions.
- A failed register benchmark left its temporary workspace on disk; it now removes that workspace on setup or compiler failure while preserving an explicit `--out` directory for inspection.
- Knip export collection duplicated rest-binding handling between object and array patterns; both now use one traversal, preserving nested defaults, omitted elements and exported names.
- Published Markdown now has explicit checks for links around quoted, nested and unclosed code fences, keeping code intact while rewriting prose links.
- Ordinary classes with computed static readonly fields, such as `static readonly [kind] = "name"`, could crash `vibelang` or `--fix`. They now check normally, and their computed members stay unchanged.
- Documentation hover generation could leave temporary projects behind when the language server failed to start; it now removes them on startup failure as well as after a refresh.
- A payload field named `constructor` in `error` or `schema error` failed to parse as though it were a constructor method. Typed fields with that name now compile and retain their payload values.
- Packaging a `dprint` plugin could leave a temporary archive behind when replacing the archive failed; it now removes that temporary file on every return path.
- An initializer directly after `!!` caused a syntax error; `const e: number!!=Effect.succeed(1)` now parses with the same meaning as the spaced form.
- Inline object types in an Effect error slot were rejected; `number!{ message: string }` now works like the corresponding `Effect` type.
- Effect tagged-error patterns written with a directly imported constructor, such as `when TimeoutError:` after `import { TimeoutError } from "effect/Cause"`, did not use the module's guard, so branded errors from another package instance fell through. They now call the guard and narrow the matched error to its type.
- Imported aliases in `Option`, `Exit` and `Result` patterns could fail to compile; they now use the resolved module guards and extract the specified fields, safely rejecting unbranded subjects.
- Docs content tests repeated the same page-link assertions under duplicate names; the redundant test is removed, and every mapping remains checked.
- Automatic tracing settings could silently insert function spans that no accepted language proposal defined. The compiler and TypeScript mapper now reject `tracing`; add operation spans explicitly with `withSpan`.
- The `alchemy-stack` example failed on `effect@4.1.1`: importing `@alchemy.run/cloudflare` failed with `Cannot find module .../effect/dist/Crypto.js`, because `alchemy@2.0.0-beta.84` imports the removed `effect/Crypto`. The example now patches `alchemy` with Alchemy's own Effect 4.1 port on install, and the Alchemy page shows how to apply the patch.
- Global throw annotations could not be inspected as data; a generated snapshot now lists their overloads, shipped own-throw contracts and exact declaration inputs, and checks when they become stale.
- Host messaging references such as `postMessage` and `globalThis.postMessage` could bypass the platform check; they now report `EK4402`, while local bindings keep working.
- Projects configured only with `vibe.config.json` could lose editor settings, and imported packages could miss `vibe.config.json` or `jsconfig.json`. Editors and package settings now use the nearest config in the documented precedence order and refresh when a canonical config is created.
- Throwing a `Cause` object was rejected; it now fails with that exact object in Effect code and throws it normally in plain JavaScript code.
- The specification and producer guide made a labeled `break` or `continue` naming the `for try` itself `EK2003`, unlike JavaScript and `for concurrent`. It now means the loop's own unlabeled jump; only labels on enclosing statements are `EK2003`.
- The specification promised that `match` class arms on ordinary classes would emulate the TC39 draft's construction-identity test, which compiled JavaScript cannot do for classes from `.ts` or `.js` files. A class without its own `Symbol.customMatcher` now matches by `instanceof`.
- Typed ESLint programs required `tsconfig.json` even when a project used `vibe.config.json` or `jsconfig.json`; `typedProgram()` now discovers the nearest project in the same order as the compiler and still honors an explicit `project`.
- The editor parser accepted repeated statement `catch` clauses; it now marks them as invalid syntax while preserving TypeScript's `any` and `unknown` catch annotations.
- `vibelang --fix` left some arrows with Effect return annotations unmarked, so they lost their Effect behavior when only the `effect` keyword decided their form. It now marks these arrows `effect`, including arrows whose bodies qualify for direct-call optimization.
- Concurrent arrays could not use the documented concurrency spellings; they now run with `try.all`, `try.race`, `try.any` and `try.allSettled`; settled outcomes include defects and interruption as `Exit` values.
- Formatting a concurrent loop whose limit used `try` could fail with an overlapping-edits error; the formatter now preserves the complete loop head.
- Building from source could fail the runtime test of a 100,000-element delegated producer on a busy host after five seconds, while it was still delivering elements; it now allows 30 seconds.
- The module and resource VIP references still named `effect@4.0.6`; they now describe the accepted `effect@4.1.1` pin, with its 149 root exports and scope functions checked.
- On the docs site, a specification link whose text held code with brackets, such as ``the `[Effect]` parameter``, kept its `.md` path, so the site build failed on a dead link; it now links to the section on the site.
- Effect functions and program literals had no explicit spelling for migration; `vibelang --fix --fix-vip-only` now writes `effect` functions and `effect { }` blocks while preserving their behavior.
- `Date` patterns accepted objects with only `Date.prototype`; they now require a real date, including valid date subclasses and invalid dates.
- A `schema` or `schema error` declaration could throw `ReferenceError: Schema is not defined` when an explicit `Schema` import was used only by the declaration. Generated schema references now retain a runtime import.
- Editors still highlighted `layer` declarations and `service class` as VibeLang syntax after those spellings were removed; tree-sitter and VS Code now recognize only the accepted service spelling.
- The TypeScript mapper still read the built-in failure list that VIP-4 replaced, so it knew only `JSON.parse` and `decodeURI` and its contract test failed; it now takes every single-class annotation from VIP-4's table, such as `Intl.getCanonicalLocales` throwing `RangeError` and `atob` throwing `DOMException`.
- The `examples/pipeline` README and sample output showed producer logs in the wrong order; both now show `Stream.take` closing the producer before the loop logs the second alert (VIP-21).
- Source maps from `vibelang-vite` and `vibelang-unplugin` named each `.vibe` source by `file:` URL, so webpack listed `src/file:/…/main.vibe` and Vite tests could not find the source. Bundler maps name the absolute path again; `vibelang/register` alone gives Node `file:` URLs, which a Windows drive path or a `#` needs.
- Generic `data` declarations could collide with a user’s `NameDefinition` interface; generated helpers now choose a free name.
- `vibelang lint` skipped projects using `vibe.config.json` or `jsconfig.json` and ignored invalid project settings; it now uses compiler config precedence and reports configuration errors.
- Cyclic schema declarations incorrectly reported that a schema was not a schema; they now report only TypeScript’s initialization diagnostics.
- Schema declarations accepted comma field separators; the compiler now reports `EK1013`, and `vibelang --fix` writes semicolons.
- Schema declarations inferred mutable arrays, tuples, and records as readonly; they now preserve the collection type's mutability, support `Readonly<Record<K, V>>`, and keep the same types through `vibelang --fix`.
- An unused local `main` previously warned that it should be exported; it now compiles without that warning (VIP-26).
- The obsolete `with Layer { ... }` provider alias previously compiled with a warning; only `provide Layer { ... }` is now supported, and the old alias receives TypeScript syntax errors (VIP-12).
- Module-level `using`, including nested blocks and class static blocks, previously failed; these declarations now compile and dispose at the end of their TypeScript scope (VIP-8, VIP-26).
- Coding agents initialized with `vibelang agents init` missed Effect lint checks; their instructions now include `vibelang lint` and its Oxlint configuration.
- Agent instructions taught retired call and function forms; the shipped skill and starter essentials now follow the accepted syntax, distinguish Promise `await` from Effect `try`, and explain failure handlers and cleanup.
- Lower the Node.js floor from 26 to 22.22.3 (22.x) or 24.11.1 across packages, starter, build and release checks; Node 22.22.3 supplies main-module detection, synchronous import hooks and the imported-CommonJS ESM cache fix (Node.js #59679).
- VIP-21: a producer ran its body only when its consumer pulled, through a continuation handoff that VIP-21 replaced. A producer is now Effect's `Stream.callback` with a one-element buffer, ended by `Queue.end`: its body runs on a fiber of its own and may run up to two elements ahead of the consumer. A `for...of` or `yield*` over a Stream that needs a control operation is now EK4201, as other Stream consumers were, and a failure in a producer's cleanup after its consumer stops is no longer reported.
- VIP-4: a TypeScript function documented with `@throws {E}` or `@throws {never}` still needed `@vibelang trusted` before Effect code could call it, and every JavaScript built-in was trusted except `JSON.parse`, `decodeURI` and `decodeURIComponent`. `@throws` alone now says what a function throws, `@throws {unknown}` means what no tag means, and VibeLang ships one generated table of `@throws` annotations for the ES built-ins: `JSON.parse` throws `SyntaxError`, `BigInt(text)` `SyntaxError` or `RangeError`, `RegExp(text)` `SyntaxError`, the `Intl` locale lookups `RangeError`, `eval` `unknown`, and `Math.max` and the rest `never`. A DOM function has no annotation, so it throws `unknown` (`EK4401` outside a wrapper).
- Migration now includes `.vibe` in formatter, lint and ast-grep commands: the compiler ships a Prettier plugin and formatter companion using its own dprint formatter, ESLint checks VibeLang beside Oxlint, and ast-grep loads the shipped tree-sitter grammar.
- VIP-30: project discovery checks `vibe.config.json`, `tsconfig.json`, then `jsconfig.json` in each directory; explicit config paths still select that file.
- An LSP client that only accepts pushed diagnostics, such as Claude Code's, showed no errors in `.vibe` or `.ts` files, because the language server answered only `textDocument/diagnostic` requests. The server now publishes each open file's diagnostics to such a client after every open, change and save.
- Effect's type-aware lint, the `effecttsgo/*` rules that `alchemy lint` and `foldkit lint:effect` run through Oxlint, never checked `.vibe` files, so a migrated file lost its Effect lint. `vibelang` now carries those rules (VIP-38): the `@effect/language-service` plugin in `tsconfig.json` reports them in builds and the editor, and `vibelang lint -c <oxlint config>` runs the configuration's rules on `.vibe` files in CI.
- A target set up from a staged toolchain (`step.mjs toolchain`) installed `vibelang-runtime`, `vibelang-vite` and `vibelang` without their `LICENSE` and `NOTICE` files, so license tooling such as a bundle's third-party notices rejected them. The staged tarballs now carry the files the published packages carry.
- Under `vibelang-vite`, an import of a directory whose `index.ts` had become `index.vibe`, such as an alias to `src/mount`, failed with `Could not load ... Is a directory`, and an extensionless `./x` did not reach `x.vibe`. The plugin now adds `.vibe` to `resolve.extensions`. The migrate flow also wires a config written `defineConfig(() => ({ ... }))`.
- The migrate flow wrote `package.json`, `tsconfig.json`, `pnpm-workspace.yaml` and Vite configs in its own format, so the repository's `format:check` failed on them. Upgrade-effect, setup and each batch's record now run the repository's own formatter (Oxfmt, Vite+ `vp fmt`, Prettier, Biome or dprint) on the files they wrote.
- Knip could not read `.vibe` files: it reported every import of a migrated module as unresolved and never an unused export of one. `vibelang` now ships `vibelang/knip`, a Knip compiler for `.vibe`, and the migrate flow writes it into a `knip.config.ts`, keeping a `knip.json`'s settings.
- After the migrate flow, an app, example or website whose Vite config bundled a migrated package's sources failed with `PARSE_ERROR` or `Module not found` on its `.vibe` modules: setup added `vibelang-vite` only to the tests' config. It now adds the plugin to every Vite and Vitest config of a migrated package or of a package that depends on one through workspace packages.
- A package the migrate flow set up for `bun test` failed with `Export named '…' not found` on its first `.vibe` import: the repair wrote a top-level `preload` in `bunfig.toml`, which `bun test` ignores. Setup now writes `preload = ["vibelang/bun"]` under `[test]` for a test command that runs `bun test`.
- After the migrate flow (`.smithers/flows/migrate`), a project that checks the migrated sources with stock `tsc`, `tsrs`, `bun check` scripts that invoke TypeScript, or TypeDoc failed with `TS2307` on every import of a migrated module. Setup now supplies declaration sidecars and enables `allowArbitraryExtensions` in every tsconfig, and the codemod names a migrated module `./x.vibe` from `.ts` files, so those checkers read its sidecar.
- Stock `tsc`, `tsrs`, `bun check` scripts that invoke TypeScript, and TypeDoc failed with `TS2307: Cannot find module './x.vibe'` in a project that imports a `.vibe` module, or skipped it. The compiler now writes `x.d.vibe.ts` beside each `.vibe` module, which those tools read under `allowArbitraryExtensions` ([Let TypeScript tools read .vibe modules](vibelang-cli.md#let-typescript-tools-read-vibe-modules)).
- In a project that emits declarations, `vibelang --fix` changed the declaration files: it removed an import such as `import * as Schema from "effect/Schema"` that an export's type used, and rewrote `Effect.Effect<void, never, never>` as `void!!`, which dropped the `never` arguments. It now keeps such an import and writes `void!never!never` in an exported statement, so the declarations stay the TypeScript's.
- In a project that emits declarations, `vibelang --fix` rewrote an exported `Schema.Struct` constant that had no type of its name as a `schema` declaration, which added `export type Name = typeof Name.Type` to the declaration file. EK4832 now leaves such a constant; with its type written beside it, the pair still becomes `export schema Name { … }`.
- The experimental TypeScript mapper reported `EK9001` for imports from inline modules. It now reports `EK9100` for inline modules and their imports, explaining that they require building with `vibelang`.
- The experimental TypeScript mapper required a `$plain` member on exported functions with an Effect return contract, rejecting valid assignments to `typeof f`. Their projected types now keep only the Effect contract.
- In JavaScript that the experimental TypeScript mapper emits, passing an imported plain function with a written return type as a callback, as in `[1, 2].map(square)`, failed with `Plain call of square found no plain form`. The callback now receives the function as written.
- A nested module type such as `Layer<HttpClient>` could emit a declaration with an unqualified inner type. Declarations now qualify nested module types too, such as `Layer.Layer<HttpClient.HttpClient>`.
- Unrelated baseline type errors could prevent Bun, Node and bundler loaders from loading a clean `.vibe` module. Loaders now reject only errors in the source they load and project-wide errors.
- Under `bun --preload vibelang/bun`, a TypeScript module that imported `./x.js` failed with `Cannot find module` when `x.ts` had been replaced by `x.vibe`. Bun now loads `x.vibe`; an existing `x.ts` still wins.
- `vibelang/bun` and `vibelang/register` refused a project with `"composite": true` with `TS6304` and `TS6379`. They now compile it.
- Tree-sitter rejected block-param calls named `error`, such as `error{}`; it now accepts them as the compiler does.
- Writing a contract such as `number!!` on a function whose `try` block returned a `do` block, or a `throw` expression beside a `match`, reported `TS7024` and `TS7022` on the catch binding, though the same function compiled without the contract. The function now compiles either way, and the catch binding has the try block's error types.
- A `join [a, b]` inside `uninterruptible { }` never finished when one fiber failed while another was still waiting. The join now interrupts the waiting fiber, runs its cleanup, and fails with the first fiber's error.
- A `match` at the end of a `do` block incorrectly reported `TS1109`. The block now returns the selected arm’s value.
- Formatting a statement-level `match` after a statement without a semicolon could refuse the file after joining the statements. Formatting now preserves that boundary.
- Tree-sitter accepted unescaped line breaks inside quoted strings; it now rejects them as the compiler does, while preserving escaped line continuations.
- Tree-sitter highlighting could misread `catch`, `??`, statement starts, `!T`, empty type parameters and bare `await`; these forms now parse as the compiler parses them.
- The starter now starts after a Yarn Classic install without needing Redis.
- The starter's tests could not find Vite after a Yarn Classic install. The starter now installs Vite explicitly.
- Importing both `vibelang-runtime` and `vibelang-runtime/kernel` in Bun no longer fails at startup, in either import order.
- A running call used as a bare statement in a constructor, static block, getter or setter now reports `EK1001` and explains that the surrounding code runs as plain JavaScript.
- Running calls in getters, setters and parameter defaults now report `EK1001` instead of silently returning or storing an unrun Effect, including defaults of Effect functions.
- Effect functions now report EK4301 when assigned, returned or stored in a typed element that expects a plain function, including members of objects and class instances.
- A plain call that finds no plain form now fails with a defect naming the function, instead of returning an unrun program.
- An owned fiber could escape through an assignment, return, call or capture inside an await, fork or concurrent loop operand. The compiler now rejects those escapes while allowing direct reads there.
- Repeated calls along a chain of functions without written contracts could make the compiler run out of memory. Inferred error and service channels now keep each type once, so repeated calls no longer multiply inference work.
- A `module` declaration's exports were copies: after `bump()` changed an exported `let count`, the file and its re-exports still read `0`, and the module's imports ran before the file's earlier imports. Each module declaration the file imports now compiles to a JavaScript module of its own, `main.vibe.text.js` beside `main.js`, so its exports are live bindings and it runs in import order; `vibelang/register`, `vibelang/bun`, `vibelang-vite` and `vibelang-unplugin` load it from the file's compile.
- Quick fixes dropped the comments inside what they rewrote: a comment in an error's field list or before an `Effect.succeed` argument disappeared. Fixes now keep those comments, and a rewrite that cannot keep its comments is not offered.
- `vibelang --fix` stopped after 16 rounds, so a file with more than 16 nested `Effect.Effect<…>` types was only partly rewritten and a second run changed it again. It now continues until nothing is left to fix, and reports a rewrite that repeats a source state instead of writing a partial result.
- The editor's error-declaration quick fix cut a generic parameter list at the first `extends` inside it, turning `class Bad<T extends string>` into `error Bad<T { n: T }` and leaving `TS1005: '>' expected`. The fix now copies the whole type-parameter list from the parsed class.
- The formatter sorted import and re-export declarations, so modules initialized in a different order after formatting and the program's output changed. Declarations now keep their source order; the names within one declaration may still be sorted.
- `--fix` and the editor removed an import when a rewrite dropped its last binding, including an import of a local module whose initialization the program relied on, so that module no longer ran. A module that was loaded now keeps a side-effect import, `import "./adapter.ts"`, in the same position.
- The `Effect.provide`, `Effect.provideService` and `Effect.withSpan` quick fixes moved the program expression into the block, so a getter or a factory call ran after the providers instead of before them. A program expression other than a call passed by name, an arrow function or a variable the file never assigns now stays in its original call, and its warning offers no fix.
- The service-class quick fix replaced a class whose key is an expression, such as `keys.pop()!`, with a `service` declaration, so the key's evaluation and its side effects were lost. A class with a dynamic key now stays as written; only literal keys are rewritten.
- The `catchTag` and `catchTags` quick fixes wrote a class test, `when Gone:`, so a failure that carries the tag without the class's prototype, such as a copied error object, failed at run time with `No match arm matched`. The fixes now write the structural test the call made, `when { _tag: "Gone" }:`.
- The `catchTags` quick fix gave the merged handlers one shared `catch (e)` parameter, so a handler that read an outer variable named `e` read the caught failure instead and returned the wrong value. Handlers now keep their own bindings: the shared variable is renamed when a handler's own name would be captured.
- Migration could record formatted sources whose public declarations no longer matched the bytes verified earlier; verification now covers formatted sources, and recording rechecks any later formatting change. Protected test edits are rejected before verification runs again after formatting.
- A `catch` quick fix could shadow an outer name read by the handler, changing its result; CLI and editor wrappers now choose a free parameter through the checker, including escaped names and exhausted fallback names.
- A catch-handler editor fix removed `async` or `*` even when its body still used `await` or `yield`, leaving new compile errors; CLI, editor and diagnostic guidance now withhold that edit and ask for an explicit body conversion.
- Removing `async` from a `catch` handler deleted comments after it; modifier repairs now preserve every comment and the handler body.
- `vibelang --fix` removed an `effect` import with a doc comment before it, such as a module header, when the declaration did not write the import: tsc drops the comment with the import, so without it the comment led the declaration and the published `.d.ts` changed (Smithers `Canonical.d.ts`). `--fix` now keeps such an import when removing it would change the declaration.

#### Compiler and diagnostics

- The compiler crashed on a service declaration with a static member whose name is computed, such as `static [Symbol.iterator] = 1`, while looking for the service's `key`. It now treats only a member named `key` as the key.
- A call of a union of a plain function and an Effect function, such as `(flag ? double : Math.abs)(3)` with `double` unannotated, compiled and gave the Effect function's program back unrun when it was chosen. It is now EK4301; annotate `double` or call each function where it is chosen.
- A `schema` declaration's `.d.ts` declared an interface, `interface User extends Schema.Schema.Type<typeof User> {}`, before the constant, so a library that rewrote `const User = Schema.Struct(…)` and `type User = typeof User.Type` as a `schema` changed its public declarations. It now declares the constant and then `type User = typeof User.Type`, byte for byte what the Effect TypeScript declares.
- A function's form followed its body: adding a log call to an unannotated exported helper changed its declaration from plain to Effect and broke callers compiled earlier, a callback type written in place accepted Effect callbacks while the same type through an alias did not, and an unannotated protocol method such as `static [customMatcher]()` or `[Symbol.dispose]()` that ran an Effect returned it unrun. A function's form is now written: a plain return annotation or `: infer _` makes it plain, a function without one is an Effect function, a literal takes its destination's form, and a callback type means what TypeScript means; see [Upgrade from 0.0.10](#upgrade-from-0010).
- A match whose last arm only binds the value, `when let other: …`, reported EK4701 over a union of literals or tags as if that arm handled no case. Such an arm now handles every case, as `default` does.
- A structural type could stand for a service. A requirement for one service could be relabeled as another and fail at run time with `Service not found`. Services are now nominal by their key; see [Upgrade from 0.0.10](#upgrade-from-0010).
- A `service` declaration's `.d.ts` declared VibeLang's own interface, runtime key type and `Shape` namespace, and its key was always derived, so a library that rewrote a `Context.Service` class as a `service` changed its public declarations and its key (foldkit's `Dispatch`, alchemy's `Correlation`). It now declares Effect's own `Context.Service` class, byte for byte what the TypeScript declared, and `static readonly key = "…"` in the body keeps the original key, which the `Context.Service` quick fix and `vibelang --fix` now write.
- An `error` declaration's `.d.ts` declared VibeLang's own `#private` member and a `namespace E { type $error = ErrorBrand<…> }` marker beside the class, so a library that rewrote a `Data.TaggedError` class as an `error` changed its public declarations. It now declares exactly what the `Data.TaggedError` class declares, and a match counts an arm over any error class extending `YieldableError` toward exhaustiveness, wherever the class is declared.
- Pre-release builds of 0.0.11 reported EK4701 for a `match` without `default` over an open subject, such as `match (x: number) { when 1: 1; }`, though VIP-7 checks only finite unions. Such a match compiles again, and a value that no arm matches throws the proposal's `TypeError`.
- A non-tail `resume` could receive a value outside its type and crash after only EK2119 warned. EK2119 is now an error; write a success type covering the handler's answers.
- A `using` initializer that was not a single call, such as `flag ? acquire() : acquire()`, `(acquire(), handle())` or `wrap(acquire())`, ran its inner acquisitions in the caller's scope. `using` disposed the value a second time, the acquisition's release ran after the block, and the function falsely needed `Scope` (EK2002 or EK3205). The whole initializer now runs in the block's scope, so each resource is released once, when the block exits.
- A function whose `using` initializer had a generic requirement, such as `using r = open()` with `open: () => A!!R`, kept `Scope` in its own requirements, so a caller that passed a scoped acquisition needed `Scope` it never used. The function now omits it: its requirement is `Exclude<R, Scope>`. With `R extends Scope`, the initializer now requires `Scope`, so `using` binds a value with no disposal method instead of reporting TS2850.
- Providers now remove only services supplied on every path. Invalid providers report EK3207; unions, optional tuple elements and array spreads keep requirements they cannot guarantee, and service defaults are checked against their shape and member contracts.
- The process.exit and process.exitCode replacements did not state their exit statuses. The diagnostic and table now say to return for 0, fail for 1 or interrupt for 130.
- Experimental FileSystem and Crypto requirements could be mistaken for Effect's services and fail with a missing service at runtime. Their keys now have distinct identities, and the entry selects their experimental layer.
- A local method named runSync could suppress main, while an aliased runner could go unrecognized. Runner detection now follows the resolved function.
- A browser entry could import Node's runner and fail to load in a browser. It now uses BrowserRuntime and imports no Node modules; the page starts main explicitly.
- Conflicting platform imports silently chose one platform. EK3206 now rejects a second, different platform import; keep one per file.
- An entry using standard and experimental services could build the platform twice. It now provides one shared platform layer.
- EK3205 could name a missing platform service without its provider. It now names the layer that supplies each service.
- Class and object methods with plain return annotations could hide an unrun Effect. They now report EK2003, with the contract repair in [Upgrade from 0.0.10](#upgrade-from-0010).
- Reading Path.sep produced an unexplained missing-property error. EK4503 now points to Path().sep on the service implementation.
- Errors on shared prelude and global names could leave their meaning unclear. Notes now identify the selected module or global and explain how to reach the other.
- A misspelled name could suggest a platform global that EK4402 bans. Suggestions now omit banned globals outside TypeScript escapes, and missing Process or Locks names point to Experimental.
- Subclasses of fieldless error families could reject their own constructor fields. They now accept those fields for abstract bases and bases with a widened tag.
- Passing a running call to prelude pipe could give only a TypeScript type mismatch. EK4502 now explains that the call already ran and shows how to pass a program.
- Returning a block-owned fork could silently hand the caller an interrupted fiber. EK4838 now warns and suggests a caller-owned scope or explicit detachment.
- Using provide in an expression could produce unrelated parser errors. The diagnostic now explains that provide is a statement.
- Wide failure, service and match lists could overwhelm diagnostic messages. Each list now shows at most ten members and counts the rest.
- An unsupported Effect installation could be reported as missing. EK1011 now names the resolved version and the required installation.
- A `for...of` whose binding default failed, a `for...of` over an array with its own iterator, and an array destructuring whose default failed left the iterator open: its `return()` never ran. Every live iterator is now closed as JavaScript closes it, innermost first, before the failure is reported.
- Explicitly empty service keys could be missed. A `service Empty {}` key is now recognized.
- Imports from paths containing spaces, `#`, `?` or percent signs could fail at runtime. Generated imports now escape those characters.
- Deeply nested arrow functions could take a long time to check. Effect return inference now shares the guarded type lookup.
- Files with many generated helper names could compile slowly. Generating those names now takes linear work.
- An unresolved or invalid call could also get a misleading unsafe-call error. The compiler now reports the original error without that extra message.
- Cyclic error inheritance could produce errors about generated constructors. Those follow-on errors are now suppressed.
- An error base written as an expression could appear as an internal name in a diagnostic. The message now shows the source expression.
- A missing call pipe could suggest the wrong operation. The diagnostic now gives guidance that applies to the operation you used.
- A large function could get a false non-exhaustive-match error after TypeScript stopped flow analysis. It now keeps only the flow-analysis-limit error.
- Bare program names such as `interrupt` could silently run nothing. See the new diagnostic and call fix in [Upgrade from 0.0.10](#upgrade-from-0010).
- A trailing throw could throw the wrong operand or get a misleading contract error. See the parentheses repair in [Upgrade from 0.0.10](#upgrade-from-0010).
- Error subclasses with a primitive or list base constructor could fail only when instantiated. See the earlier declaration error in [Upgrade from 0.0.10](#upgrade-from-0010).
- A nameless `module { … }` could get platform and call errors. See the naming hint in [Upgrade from 0.0.10](#upgrade-from-0010).
- An `await` binding could compile into invalid JavaScript. See the binding check in [Upgrade from 0.0.10](#upgrade-from-0010).
- An entry could pick a platform layer from the runtime's development dependencies. It now resolves platform packages from the entry's project.
- `const fs = FileSystem; fs.writeFileString(...)` gave an unexplained missing-property error. The message now suggests `FileSystem()` or a direct service call.
- Platform diagnostics could recommend a hatch for an API that has a service. They now point to Effect's `lstat` and home-directory APIs or the [experimental replacements](#experimental-platform-apis).
- An Effect arrow that read `this` only in a parameter default or a class's `extends` clause, or an Effect method that read it only in an `extends` clause, lost `this` and failed with a `TypeError`. Both now keep the enclosing `this`.
- An Effect arrow that read its enclosing function's `arguments` saw a different object, shared by every run of the same Effect; in an anonymous function expression that named its own variable it failed with a `ReferenceError`, and in a plain function it crashed the compiler. It now reads the arguments of the same call, afresh on each run.
- A producer that read `arguments` got an empty object. It now reads the arguments of the call that made its Stream.
- An Effect arrow created in a constructor read `undefined` for `new.target`. It now reads the constructor call's `new.target`, as a plain arrow does.
- An Effect method or arrow that wrote a super property in any form but `super.x = v` and `super.x += v`, such as `super.count++`, `super[key] += v` or `[super.x] = pair`, and an Effect arrow in a class field that used `super`, could compile to JavaScript that failed to load with `'super' keyword unexpected here` or `Invalid left-hand side in assignment`. They now run as JavaScript runs them, evaluating the key once, and a `super.tag` template tag keeps `this`.
- Inside a named Effect function expression or producer, such as `function self(n) { … self(n - 1) … }`, the name meant an internal generator: a call passed by name failed with `Not a valid effect`, deep recursion overflowed the stack, and returning the name returned the generator. The name now means the function itself.
- A binding spelled like a name the compiler generates, such as `answer$direct` beside a function `answer`, `sum$recur`, `work$try` in a function `work`, or `Users_base` beside a service `Users`, could change which function a call ran or what a local held, stop the module from loading with a `SyntaxError`, or make its declaration file invalid. Generated names now avoid every name the file spells.
- An Effect function whose parameter default names the function itself, such as `function f(g: Self = f)`, got the generator that runs its body instead of the function, so the default was not an Effect function. The name now means the function, as in TypeScript.
- A binding or label spelled like a name that `match` or `is` writes, such as `const $match1 = 99` read in an arm, could read the match subject instead of its own value, or stop compilation with a duplicate label. Those names now avoid every name the file spells.
- A binding spelled like a helper that a form calls, such as a `$is` or `$noMatch` function beside a `match`, or `$awaitAll` and `$forConcurrent` beside `await.all` and `for concurrent`, replaced the helper: a match chose the wrong arm or returned the binding instead of failing, and the fiber forms ran the binding instead of their fibers. The forms now always call the runtime's helpers.
- A parameter or local named like a failure class that a call lists, such as `SyntaxError` around `JSON.parse`, replaced the class in the call's generated test: the failure became a `TypeError` defect that `catch` could not receive. The test now reaches the class itself.
- Plain functions that call one another, with a parameter or local named like the function, such as `function even(even: number)`, failed with `TypeError: even is not a function` once the recursion ran deep. The deep path now calls the function.
- A by-name `a() || b()` or `a() ?? b()`, such as `retry(first() || second(), policy)`, tested the Effect that runs `a()` instead of its value, so `b()` never ran. It now tests the value, as the same expression in a lambda does.
- A pipe whose topic stands alone, such as `source() |> sink.take(%)`, could read a getter or a reassigned `let` in its body before it ran its left side. The left side now runs first, unless the body reads only values that can't change.
- `try(f, mapper, input())` evaluated its inputs before its mapper. It now evaluates its arguments in the order written.
- `wire(a(), b())` evaluated `b()` before `a()` when `b()`'s layer needs a service that `a()`'s layer provides. The arguments now run in the order written; only the layers they make are reordered.
- `for concurrent(limit()) (const x of items())` evaluated `items()` before `limit()`, so the loop could iterate items that `limit()` had replaced. The head now runs in the order written.
- An optional chain that went on after a call that runs an Effect, such as `box?.read().value`, crashed with a `TypeError` when `box` was absent, and an optional call such as `codec.parse?.(input())` could run its arguments when skipped. The rest of the chain is now skipped, arguments included.
- A call with expected failures, such as `JSON.parse` read through a getter, read its function after arguments that run an Effect, so the getter ran late and the call could reach a function an argument had replaced. It now reads the function first, as JavaScript does.
- A tagged template whose tag declares expected failures, such as ``tag`text` ``, threw them as defects that `catch` never received, and EK2004 said its `try` could not fail. The template now uses the tag's failures, as a call does.
- A nested pattern that tests and binds a property, such as `{ value: 1 and let n }`, read the property twice, so a getter ran twice and `n` could differ from the value tested. A pattern now reads each part of its subject once.
- An exhaustive `match` without `default` skipped code in its last arm's pattern, such as the getter in `when registry.State.Waiting`. That code now runs.
- `wire(Decorated)`, where `Decorated` provides and needs the same service, was typed as needing nothing and failed with `Service not found`. Its type now keeps that input, as `Decorated`'s does.
- `wire` imported under another name (`import { wire as compose }`), called as `Runtime.wire`, or given a spread array (`wire(...[LA, LB])`) skipped dependency ordering, so a layer could be built before the layer it needs and fail with `Service not found`. These forms are now ordered and checked as `wire` is, and a spread whose layers cannot be listed is EK3204.
- A service declared inside a namespace, `export namespace N { export service S { … } }`, had a declaration file entry without its key type, so TypeScript code could not pass `N.S` to `Layer.succeed` or `Effect.provideService`. Its declaration now matches a top-level service's.
- Effect's `pipe` imported under another name, such as `import { pipe as flow } from "effect"`, or read as `Function.pipe`, got none of the diagnostics that point out where 0.0.10's look-ahead made its first argument a program. It is now recognized under any name, so EK1023, the migration note and `--fix` cover those calls too.
- A `sync` or `try` hatch whose function returned `number | Promise<number>` gave the Promise object where its type promised a number, and one that returned data with a `then` field, such as `{ then: 7 }`, crashed with `then is not a function`. The hatch now waits only for a value whose `then` is a function, deciding per value when the type allows both.
- A pattern recognized built-in matchers by spelling: with a parameter named `String`, `when String` still tested `typeof x === "string"`, and `when Option.None` on your own `data Option` failed with EK2127. A matcher now means what its name resolves to, so those are a variable pattern and your type's variant.
- A function with a plain return annotation, such as `function sumTo(n: number): number`, died with a `RangeError` on deep recursion, while the same function without the annotation completed. Its call cycles now continue on heap frames past the depth limit, as unannotated ones do, and its callers, TypeScript ones included, still call it as a plain function.
- A `match` without `default` that handled every case of a finite union ran its last arm without testing it: a getter the test reads was never read, and a value outside the declared type, from an unsound cast or `any`, took the last arm. The last arm is now tested like every other arm, and a value that fails it throws a `TypeError`.
- An object pattern never matched a function, so `when { size: let n }` skipped a function with a `size` property. It now matches any object or function, and still reads no property of a primitive.
- A default in a catch binding, such as `catch ({ id = fallback() })`, could fail or need a service that the function's contract left out, so a `number!!` function compiled and its callers could not catch the failure. The compiler now counts the default's failures and requirements in the function's contract.
- An error subclass of a generic base, such as `error Child extends Base<number> { own: string }`, failed to compile with TS2345 because its generated constructor dropped the base's type arguments. The constructor now takes what `Base<number>` takes, plus the subclass's fields.
- A `for concurrent` loop let its body assign a `const` binding, as in `for concurrent (const n of xs) { n = 99 }`, destructured bindings included. Assigning one is now TS2588, as in a `for...of` loop; a `let` binding stays assignable.
- `join` rejected a dictionary of fibers typed with an index signature, such as `Record<string, Fiber<number>>`, with EK4611, and accepted an object whose index signature also admitted non-fibers, which then failed at runtime. It now checks index signatures as it checks properties.
- A `.vibe` file's declaration file imported Effect's types from `vibelang-runtime` (`import type { Effect } from "vibelang-runtime"`), so it differed from the declarations of the Effect TypeScript it replaced and made consumers' types depend on the runtime. Declarations now import `Effect`, `Layer`, `Schema` and `Scope` from `effect` and write `Effect.Effect<…>` and `Scope.Scope`, as Effect TypeScript does.
- `Readonly<{ path: string }>` in a `.vibe` file declared `Readonly<{ readonly path: string }>`: the same type, but other declaration text than the TypeScript it replaced. The members of an object type that is `Readonly`'s type argument now declare no `readonly` of their own unless the source writes one.
- A type that a `.vibe` file's declarations inferred from one of Effect's modules was written as an import type, `import("effect/Option").Option<string>`, where Effect TypeScript that imports `Option` declares `Option.Option<string>`, so removing a prelude module's import, as `--fix` does, changed the declarations. Declarations now name such a module through the name the source writes, the Effect module always, and import it from `effect`; a module the source never names keeps its import type.
- An Effect type in the `!` form declared every channel, `number!!` as `Effect.Effect<number, never, never>`, where the Effect TypeScript it replaced wrote `Effect.Effect<number>`. Declarations now leave out the empty slots at the end of a `!` form, and dependencies that a return annotation leaves for the body when they come to `never`; a slot the source fills, `never` included, stays.
- A `.vibe` file that kept an import of `effect`, such as `import { Array } from "effect"`, declared the other names its declarations needed in a second import of `effect`, where the Effect TypeScript it replaced had one. They now join the kept import.
- A `.vibe` function with a callback parameter that has no contract, such as `mapAll<A, B>(items: ReadonlyArray<A>, f: (a: A) => B)`, declared the callback as `(a: A) => Effect<B, E, R>`, which names `effect`'s `Effect` module rather than its type, so stock TypeScript rejected the declaration file with `TS2709`, and with `skipLibCheck` on a TypeScript caller could pass a plain function that then failed with `Not a valid effect`. Declarations now write `Effect.Effect<B, E, R>`, through the file's own import of `Effect` when it has one, as Effect TypeScript does.
- A method with a plain return annotation that called itself, such as `size(): number { return 1 + (this.next ? this.next.size() : 0) }`, a recursive `toString(): string` or `static depth(n: number): number`, or two such methods that called each other, was rejected with `EK2003`, as if its call of itself ran an Effect. Such a method now compiles to a plain method, and a synchronous callback can call it.
- `new` on a function declared in a `.vibe` file, such as `new make()`, reported only TypeScript's `TS7009`, and through a cast, `new (make as any)()`, or under `@ts-ignore` it compiled and returned the function's program instead of an object it constructed. It is now `EK1020`, which names the function and says to declare a class; a function of a `module` declaration keeps TypeScript's meaning.
- Calling a service key with arguments, such as `Fn(3)` for `service Fn: (n: number) => number`, reported TypeScript's `TS2348`, which suggested `new`, itself an error for a service. It is now `EK3007`, which says that `Fn()` returns the implementation, and its quick fix writes `Fn()(3)`.
- `EK4836` did not warn at `Effect.withSpan(() => load(id), "load")`, whose program is already an arrow, or at an `Effect.provide` or `Effect.provideService` call that did not stand as a statement or a return, such as `const user = Effect.provide(() => load(), AppLive)`. Both now warn: the first's quick fix writes the prelude's `withSpan(() => load(id), "load")`, and the second says why it has no fix.
- The `Effect.catchTag`, `Effect.catchTags`, `Effect.catch` and `Effect.provide` quick fixes wrote a program passed as an arrow, `Effect.catchTag(() => load(id), "Gone", …)`, as that arrow called in place: `((() => load(id))()) catch (e) => …`. They now write the call it returns, `load(id) catch (e) => …`, which means the same.
- An inferred type that the compiler reached through the runtime's alias of `Effect`, such as the type of `export const idE = identity<Effect<number>>`, was declared as `import("vibelang-runtime").Effect<number, never, never>`, so TypeScript consumers' types depended on the runtime. Declarations now write it `Effect.Effect<number, never, never>`, imported from `effect`.
- `vibelang --fix` and the editor's quick fixes walked the whole file once per fix to find the imports the fix left unused, so the time to fix a large file with many TypeScript-style forms grew with the number of fixes times the file's size. They now read one index of the file's names per check.
- A `const` that held an arrow with a plain return annotation, such as `const countdown = (n: number): number => n === 0 ? 0 : countdown(n - 1)`, died with `RangeError: Maximum call stack size exceeded` when it recursed deeply, where a function declaration completes. It now recurses as a function declaration does, continuing on heap frames past the stack's depth.
- A call that runs an Effect in a generator method, such as `*items() { yield load(2) }` in a class or an object literal, compiled and yielded the program unrun. It is now `EK2003`, since a generator method is a JavaScript generator, whose body is plain code; yield a program, `() => load(2)`, to hand one out.
- `export const main = () => { … }` compiled, but no host ran it, since only a function declaration named `main` is an entry, so the program printed nothing. It now draws `EK4843`, a warning whose quick fix writes `export function main() { … }`.
- A function you declared named `fork` captured the keyword form: with `function fork(x: number)`, `fork slow()` called that function, so `join` of its number was EK4611. `fork x` and `fork { … }` now always start a fiber; only the call form `fork(x)` calls your function.
- `join(fiber)` with parentheses was TS2304, an unknown name. It now joins the fiber, as `join fiber` does, and `join([a, b])` keeps the shape; a function you declare named `join` makes it an ordinary call of yours.
- Clearer messages for a plain function that throws or runs an Effect (EK2003). The message led with the annotation, `number is a plain return annotation, but quantity can fail with InvalidQuantity`, offered only the contract and a hatch, and for a function that runs an Effect suggested `number!Errors!`, which closes `R`, so a function that needed a service got EK2002 next. It now leads with the rule, `quantity can't throw InvalidQuantity` or `read can't run Count(), an Effect`, names the throw or the call, and lists each way out as code: the Effect contract with the channels the body adds, `number!!Count` included, which the quick fix also writes for a function that runs an Effect; `die(…)` under `number!!`; or a `.ts` file, a `module` block or a `sync` hatch. A throw that escapes a constructor, an accessor, a static block, a JavaScript generator or a module's top level reads the same way, and its note no longer cites a decision number.
- Clearer messages for a callback that runs an Effect or throws where a plain function is expected (EK4301). The message said `this callback can pause (find)`, its fix pasted the whole callback into `Effect.forEach(…)`, however long, and its notes cited decision numbers and a "Visitor spelling". It now says what the callback can't do and why, `This callback can't run find(id), an Effect: ReadonlyArray.prototype.map calls it synchronously, as a plain function`, writes a long callback as `(id) => { … }` in the fix, and shows the one spelling that returns the program, `(id) => () => find(id)`. A callback that throws also suggests catching inside it, a function passed by name says it `can't be passed to` the callee, and a discarded Effect subtype, such as an SQL statement, says the statement discards it and shows the call that runs it.
- Clearer messages for a `match` that leaves a case (EK4701), a call of a callback parameter that can fail (EK2001), a `pipe` whose first argument changed meaning (EK1023), and the content mapper's errors. Their notes cited the decision log by number and spoke of a program "by look-ahead". They now say the same in the docs' words, and EK1023 shows the code that keeps the old meaning: `const first: A!E!R = () => …`.
- Clearer messages for services and providers (EK3001-EK3006, EK3201-EK3207), catches (EK2004, EK2114), and two notes of EK3101 and EK4838. Some started in lower case, such as `no provider for Todos.`, and EK3201's only fix was `Effect.provide(() => …, layer)`, where the docs teach a `provide` block; EK3203 and EK3206 offered no fix. They now start as sentences, `Nothing provides Todos, which this program needs.`, EK3201 offers `provide layer { … }` first, and EK3203 and EK3206 say how to break the cycle or split the entry. A lint keeps every message, variant and note starting as a sentence.
- Clearer messages for `.pipe` on a call that already ran (EK4502). Its fix suggested `|>` with `%`, or passing the call by name, two forms being retired. It now writes the call with the program passed as a function, stage by stage: `f(1).pipe(Effect.retry(policy), Effect.timeout(t))` suggests `Effect.timeout(() => Effect.retry(() => f(1), policy), t)`, as Chapter 28 already said.
- Clearer messages for errors that offered no fix: an unreachable catch clause (EK2106), a second clause for one operation (EK2108), `await` on a plain value (EK4603), a binding inside an `or` pattern (EK4702), a regular expression or relational pattern (EK4704), and a condition that isn't a boolean (EK4822). Each now says how to repair it, such as `when let v and (A or B): …` or `when let v and if (…): …`. EK2002 also names the `provide` block: `Provide Users inside find with provide layer { … }, or add it to the contract: string!!Users`.
- Clearer messages for a program run at a module's top level (EK1001) and a throw in a factory's body (EK2115). `export const config = loadConfig()` suggested only "Export a function instead"; it now shows the code that holds the program, `const config = () => loadConfig()`. A top-level `provide`, `handle`, `uninterruptible`, `interruptible` or `restore` block now says to move it into a function, a top-level throw expression reads like a throw statement, `A module's top level can't throw Bad`, and EK2115 no longer says a body "cannot run throw".
- Declaration output left ordinary `async` function declarations without a thrown-type contract, so a consumer treated each call as possibly throwing `unknown`. They now carry `@throws {never}`, because a throw in an `async` body rejects the `Promise`; a written `@throws` is kept, and a written doc comment gains the tag.
- While an argument such as `Layer.effect(Reports, {` followed by `const printer = try Printer` was half written, the language server could recurse until its stack overflowed and the process died: checking the argument asked for the call's signature, whose resolution checked the argument again. The check now answers from the resolution already in progress.
- An ordinary `.ts` file could get TypeScript errors that stock TypeScript does not report, in code TypeScript never checks, such as a function that error recovery reads as an import's module specifier (`import { a } from` followed by `function f() { missingName }`): a VibeLang pass whose diagnostics no longer apply to `.ts` files still asked the checker for types across the file. The pass no longer runs, so `.ts` files keep exactly TypeScript's diagnostics.

#### Runtime

- A `provide Key = value { … }` block built a one-service Layer on every pass, with a new Scope and Layer MemoMap around its statements, so a hot path paid about five times the cost of `Effect.provideService` and a layer the block's statements provided was memoized with the caller's layers. A `Key = value` provider now provides its service as `Effect.provideService` does; only a layer the block lists builds one.
- A `using` whose initializer did not require `Scope`, such as `using db = openDb()` where `openDb` waits and returns a Disposable, held cancellation off until `openDb` finished, so a `timeout` around it waited for the whole wait. Every initializer now runs with the interruptibility around the `using`, as `yield*` runs it, so the deadline ends the wait and nothing is disposed.
- A Disposable acquired by an Effect with its own release was disposed twice by `using`. It is now released once.
- A fiber returned from a block-bodied arrow was already interrupted, with only a warning. A fiber that escapes the region that owns it is now an error.
- Experimental platform layers had the same names as Effect's layers and were easy to confuse. Their exports now start with Experimental; see the import repair in [Upgrade from 0.0.10](#upgrade-from-0010).
- An unhandled typed error from main could print only its tag and omit useful fields. Failure reports now include the error's fields while preserving redaction.
- Loading the native runtime with an incompatible Effect could fail during module linking before the version check. It now reports the supported Effect version first.
- Traced calls could lose their logical caller while forwarding to another function. Tracing now captures that caller before forwarding, including named function expressions and methods.
- Calling a plain VibeLang function from TypeScript with `call`, `apply`, `bind` or as a method could lose `this` and throw a `TypeError`. The generated Effect wrapper now forwards the receiver (reported by Vladimir Kalnitsky).
- Running the same Effect again could see an earlier run's changes to a rest-parameter array or to a method's default parameter value, and program lambdas with optional or rest parameters could fail with a missing-variable defect. Each execution now binds its parameters afresh.
- Running the same Effect again could start from an earlier run's assignment to a parameter, such as `++n` or `n += 1`. Each execution now starts from the original arguments.
- `using` read a value's `[Symbol.dispose]` again at block exit, so replacing the method, or a getter that returned another one, changed which release ran. It now reads the method once, when it acquires the value, as JavaScript does.
- `join` on an object or array read each element twice, so a getter could make it join one fiber and interrupt another. It now reads each element once.
- In a function that compiles to plain JavaScript, a `finally` block that failed while another failure was in flight replaced it, so an outer `catch` saw the cleanup failure instead of the first one. The two failures now join as `Effect.ensuring` joins them, and the outer `catch` receives the first, as in an Effect function.
- In a function that compiles to plain JavaScript, a `finally` block that crashed while another failure was in flight kept only the first: a TypeScript caller saw one exception, and an Effect caller one defect. The exception that leaves is now a `SuppressedError` whose `error` is the cleanup's and whose `suppressed` is the first, and an Effect caller sees both defects in order, as in a function that compiles to an Effect.
- A `for...of` loop whose body or destructuring crashed over an iterator whose `return()` then threw too kept only the body's defect, as JavaScript's loop does, in plain code and in Effect functions alike. The loop now fails with both, in order.
- A failed `join` or `await.all`, or a decided `await.race`, interrupted the other fibers one at a time and waited for each one's cleanup before interrupting the next, so it hung when one fiber's cleanup waited for a sibling's. It now interrupts them all at once, as `Fiber.interruptAll` does, then waits for their cleanup.
- A program holding an await operation over an operand that is not a literal, such as `const p: number[]!! = await.all items`, read `items` once, when the program was built, and reused that reading on every run. Each run now reads the operand afresh, as `Effect.all` does.

#### Editor and language server

- The refactor "Convert to a VibeLang function" turned the removed shorthand `async later(n: number) { ... }` (`EK0101`) into `later(n: number) { ... }`, which does not parse. It now writes `function later(n: number) { ... }`.
- Hover text could run the inferred contract into the behavior paragraph. A blank separator now keeps them readable.
- Completion after `FileSystem.` or `Experimental.Process.` could omit service members. It now includes the shorthand members.
- Canceling a request during contextual type lookup could leave the editor waiting. That lookup now checks for cancellation.
- Rename could insert an invalid identifier and break the file. The server now rejects invalid replacement names.
- An ordinary `fork` identifier before an operator could be highlighted as a keyword. It now keeps identifier highlighting.
- An ordinary `join` identifier before an assertion or operator could be highlighted as a keyword. It now keeps identifier highlighting.
- Interruption blocks lacked keyword highlighting. `uninterruptible`, `restore` and `interruptible` now receive it in block form.
- Tree-sitter rejected `using` as a parameter or ordinary identifier. It now accepts those contextual uses.
- After an edit to a `vibelang.manifest.json`, the language server kept the diagnostics of the old manifest, such as no EK4401 for a call of a declaration the manifest no longer listed, until the project reloaded. A change to a manifest now rebuilds the project's program, as a `package.json` change does.

#### Tooling and bundlers

- `vibelang lint` with an Oxlint configuration skipped every `effecttsgo/*` rule VibeLang answers with syntax or a build diagnostic, so `Effect.succeed(undefined)` in a `.vibe` file passed with `effect-succeed-with-void` set to `error`, while the same text in a `.ts` file failed under Oxlint. Each rule the configuration turns on now reports `.vibe` files, under its `EK38xx` code. `missed-pipeable-opportunity` counted the calls `try` and `catch` compile to as pipeline stages, and no longer does. `vibelang lint --help` printed the compiler's help in a directory with no Oxlint configuration, and now prints the lint help.
- Migration converted modules that Node on a package `bin`, `bun file` from a directory with no preload, or Playwright's Babel load, so `ERR_UNKNOWN_FILE_EXTENSION`, `Module not found` or a Babel parse error appeared only when someone ran that tool. A package script's `.ts` path into a renamed module broke the same way. Setup now finds these entries, keeps the modules they reach TypeScript, and names each in `plan.json` and `setup.json`.
- `vibelang-format` and `vibelang format` started one Node and one dprint process per file, about 64 ms each, so a check of alchemy's 8,595 `.vibe` files took 403 to 600 s and its pre-commit hook 863 to 1311 s. They now run dprint once per style and core over all the files, with byte-identical output and the same exit codes, and remember the texts dprint left unchanged, so checking a clean tree starts no dprint: 8 s cold and 1 s clean on that repository.
- The published-declaration checker (`scripts/api-identity.mjs`) stopped every module at the first group of eight when a declaration was missing on both sides, such as t3code's `connection/platform.d.ts` (`TS2883`) or four `packages/contracts` files (`TS7056`), and reported no differences. Callers can now pass each side's emit diagnostics as `absentDeclarations`: a declaration missing on both sides with the same codes and source locations compares equal, an export that reaches a missing declaration is unavailable on its own with the reason, and the other exports are compared. A one-sided or differently caused absence never compares equal.
- A loader's compile, for `vibelang/bun`, `vibelang/register` or a bundler plugin, type-checked every `.ts` file in the package of the `.vibe` module it served, though the loader serves only `.vibe` modules and reports only their diagnostics, and a type error in any such `.ts` file kept the compile out of the cache, so every process compiled again. A one-line `.vibe` module beside a costly `.ts` file took 4.9 s to load instead of 0.2 s, and opencode's standalone server compiled its server package again on every start. A loader's compile (`vibelang --loader-root`) now checks and emits only the `.vibe` files under its package, with the same JavaScript and `.vibe` diagnostics; opencode's server became ready in 2.9 to 4.0 s from a warm cache instead of 8.1 to 8.5 s, as fast as its TypeScript tree, and in 10.9 to 12.7 s instead of 18.4 to 19.3 s from a cold one.
- A cold Vite dev server pre-bundled none of the imports a `.vibe` module's JavaScript adds, such as `effect/Schema` for a `schema`, because its dependency scan read the `.vibe` source. The first request found them, Vite optimized again and reloaded the page, and a browser test running on it failed (2 of opencode's 193 app stories). `vibelang-vite` now lets the scan read each `.vibe` module's JavaScript, with Vite 7 and Vite 8.
- `vibelang --fix` crashed on a file with a malformed import such as `import * ct.sleeon from "effect/Option"` once one of its fixes applied: removing the effect imports the fixes left unused read the import's specifier as a string. It now skips an import whose specifier is not a string.
- The compiler crashed on `@vibelang leakable`, the documentation-comment marker that exempts a service from EK4809, and on any service member whose requirement's declaration has a documentation comment, such as `Effect.Effect<string, never, Maybe!!>`: reading the comment skipped it as trivia. The marker now exempts the service as documented.
- `vibelang --fix` parsed every library and package again for each round of fixes, so a type nesting 20 `Effect.Effect<…>` took half a minute on a busy machine. A run now parses a file again only when a fix edits it, which took that type from 23 s to 6 s.
- Coding agents edited `.vibe` files without VibeLang's skill or diagnostics unless you set each one up by hand. `npx vibelang agents init` now writes the skill, an `AGENTS.md` section, the language server configuration and a post-edit check for Claude Code, Codex, opencode, Cursor and VS Code ([Coding agents](coding-agents.md)).
- Typed ESLint rules read a `.vibe` module's types as unresolved from a `.ts` file, because typescript-eslint's TypeScript cannot load `.vibe`, so rules such as `@typescript-eslint/no-unnecessary-type-assertion` reported code that `vibelang -p` accepts. `vibelang/eslint` now exports `typedProgram`, a program for typescript-eslint's `parserOptions.programs` in which each `.vibe` module, another workspace package's included, reads as the declaration `vibelang` writes for it.
- EK4831's quick fix kept the deeper indentation of a `Context.Service` shape whose type arguments stood on lines of their own, so the `service` declaration's members and closing brace stood one level too deep. They now take the declaration's indentation.
- Code migrated from TypeScript kept `import { Array } from "effect"`, which hides JavaScript's `Array` in a `.vibe` file, for you to rename by hand. An import of Effect's `Array`, `String`, `Number`, `Boolean`, `Function`, `Symbol`, `BigInt` or `RegExp` module under that name now draws EK4842, whose quick fix imports it as `Arr`, `Str`, `Num`, `Bool`, `Fn`, `Sym`, `Big` or `Regex` and renames its uses.
- `vibelang --fix` left a schema constant and its type alias, such as `const Kind = Schema.Literals(["a", "b"])` just before `type Kind = typeof Kind.Type`, for you to rewrite. They now draw EK4841, whose quick fix writes the schema alias `schema Kind = "a" | "b"`. A type written before its constant keeps its form, because the alias's declaration file lists the constant first.
- A `--fix` rewrite that left two names of one import unused, such as `Option` and `pipe`, was refused with TS1005 because its two removals overlapped. The import list is now written once with the names it keeps.
- `vibelang --fix` left `pipe(x, Option.map(f), Option.getOrElse(g))` pipelines for you to rewrite with Option's methods. They now draw EK4840, whose quick fix writes `x.map(f).getOrElse(g)` through the same data-first functions.
- `vibelang --fix` left Effect `Match` chains, `Match.value(x).pipe(Match.when(…), …, Match.exhaustive)`, for you to rewrite as a `match` expression. They now draw EK4839, whose quick fix writes the `match` wherever its arms test and give the same, with the chain's type.
- `vibelang --fix` left every `Effect.gen(function* () { … })` program for you to rewrite by hand (EK1002). It now writes the body in direct style, each `yield* e` as the call that runs `e`, wherever that keeps what the program does, and EK1002's note says why where it does not.
- In JavaScript that the experimental TypeScript content mapper emits, a module in an import cycle that called a plain VibeLang function, or passed one as a callback, before the exporting module had run got programs that never ran instead of values. It now gets the values, and no fiber or runner starts.
- A running call followed by .pipe(Effect.catchTag(...)) had no catch quick fix. The compiler now offers a VibeLang catch rewrite for a single catch operator.
- `--fix` could leave an unnecessary `Effect.succeed` in a rewritten catch arm. It now simplifies that handler.
- A missing `tsconfig.json` could leave the compiler or bundler retrying forever. It now stops with TS5058.
- The runtime loader could claim an included dependency source was excluded by the project. It now explains that no loader output is available and the dependency needs compiled JavaScript or its own project.
- Webpack could keep a stale bundle after compiler backend or build-dependency changes. Those changes now trigger a rebuild.
- Watch mode could rebuild after an unrelated sibling directory changed. It now ignores those events.
- Redirected watch output could contain terminal-clearing sequences. Output is now cleared only on a terminal.
- A nonincremental `noEmit` build could say a JavaScript output was missing. It now explains that this configuration requires rechecking.
- Cache debugging could say a file changed during compilation when it changed just before it. The message now includes the timestamp safety margin.
- The starter could generate a reserved npm package name. It now normalizes reserved names.
- A long target name could generate an invalid npm package name. The starter now limits package names to 214 characters.
- A target that was a file could produce a filesystem exception. The starter now reports that the target is not a directory.
- A missing package-manager executable could produce an unhelpful spawn error. The starter now names the missing executable.
- The starter's next-step `cd` command could break on spaces or shell characters. It now quotes the directory path.
- An npm-created project's README could tell you to run Bun commands. It now uses the selected package manager.
- A program that loads `.vibe` modules from many workspace packages through `vibelang/register`, `vibelang/bun` or a bundler plugin was slow to start with an empty cache: each package's compile type-checked the sources of every workspace package it imports, so a package was checked again for each package that imports it, and a 22-package program took 30 to 40 s to start, against 10 s without VibeLang. Each compile now checks only its own project's files, and the packages it imports only supply types to it, so that program starts in 20 to 25 s. A type error in an imported package's file now stops the import of that package's `.vibe` modules instead of the importer's.
- Each compile of `vibelang/register`, `vibelang/bun` and the bundler plugins started Node to run the `vibelang` launcher, which only finds and starts the native compiler, adding about 70 ms per project. The loaders now start the native compiler themselves.
- VibeLang's ESLint parser failed on a file with an `import` keyword that starts no call, such as `import<A0`, which TypeScript parses without a syntax error and its checker rejects. It now converts the keyword as typescript-estree does, as a `TSImportKeyword` node, so ESLint reports the file's other problems too.

#### Docs

- The contributor compiler-case command could run without runtime dependencies. It now installs them before the case suite.

- Links to inline HTML anchors in the synced documentation did not jump to their sections; synced pages now preserve those anchors and resolve specification links to them.
- Completion could hang the language server in a file with a call left open after an earlier closed one, such as a second `pipe(` typed below `pipe(o, Option.getOrNull)`: matching the earlier `)` searched the whole file and found the later `(`. It now searches only before the token, as TypeScript does.
- The compiler crashed on a file with a broken import whose recovery left a nameless binding, such as `import { Control, handle, resumeWithion nee "vibelang-runtime"`, beside an Effect error class: looking for the empty name in the rewritten code walked past its end. An empty name now matches nothing.
- Language design inconsistencies were missing from these notes. They now list
  confirmed issues, examples and safe patterns in [Known design issues](#known-design-issues).
- Platform-global examples could fail when copied from the page. The page now includes the context needed to compile its browser-service, import and export examples.
- Search descriptions could contain fenced source code. The site now skips code blocks when choosing a page description.
- The site's 404 page could appear in search results. It now tells search engines not to index it.
- Saving a captioned test example could fail with missing helper names. Test files now import what they test; shared fragments no longer claim to be standalone files.
- The language skill incorrectly sent transformed schema fields to `Schema.Struct`. It now explains that a schema declaration can use those fields.
- The language skill used a diagnostic code that does not exist. It now names a code the compiler reports.
- The devtools guide said platform values could be imported or passed directly. It now describes the restrictions in [Platform code](#platform-code).
- The platform installation guide could install mismatched package versions. It now uses the [exact-version setup instructions](../setup/existing-project.md).
- The language skill showed outdated config access and omitted a complete scoped-file example. It now uses Effect 4's `Config.String` and shows scoped cleanup.
- Migrating files with the same stem could overwrite emitted output. The [migration guide](../setup/existing-project.md) now explains the collision and how to rename files.
- Starter tracing instructions were missing. The [getting-started guide](../013-getting-started.md) now shows how to opt in during development.
- Declaration consumers were not told the minimum TypeScript version. The [installation guide](../getting-started/004-installation.md) now requires TypeScript 5.7 or later.
- The Bun test recipe omitted declaration and project setup. The [CLI guide](../setup/vibelang-cli.md) now includes both.
- The Bun preload instructions could imply that watch and hot reload rebuild VibeLang files. The [CLI guide](../setup/vibelang-cli.md) now explains their limits.
- The formatting guide implied that every comment prevented formatting. It now limits that refusal to comments in rewritten clause chains.
- The examples README did not state the required Effect version. It now gives the exact pin.
- macOS VSIX instructions could fail because `code` or `cursor` was not on `PATH`. The [editor guide](../setup/vscode.md) now includes shell-command setup.
- The proposals page described shipped bundler adapters as future work. It now identifies the adapters already available.
- The repository home page showed benchmark results without measurements. It now gives commands to reproduce the benchmarks.
- The agent essentials used an undeclared layer binding. The example now declares the layer before providing it.
- The language skill claimed Node and Bun entries supplied Locks. It now requires an explicit Locks layer and explains its platform limits.
- The diagnostic guide omitted registered codes and their repairs. It now lists them and checks coverage against the compiler registry.
- Spec changes with explicit pending tests were rejected as having no rule evidence. The checker now accepts a changed `test.todo` for its exact rule and reports pending obligations separately from executable coverage.
- The diagnostic appendix omitted the native call-error codes named by trailing-block migration; it now lists `TS2345`, `TS2554` and `TS2769` with their triggers.
- The entry-migration guide described rewriting unmarked `main` functions and retaining retired runtime helpers; it now limits repair to platform-marked modules, names the explicit runners and explains when repair refuses.
- The retired-forms migration guide could fail to publish because its spec links escaped the user-docs root; those links now use the specification’s published URLs.
- The specification could fail its publication check because a retirement rule included internal attribution; the public rule now states the same prerequisites without that attribution.


- The diagnostic guide omitted the adjustable editor warning EK9100. It now identifies its default severity and editor-only behavior.
- The platform guide lacked a complete HTTP request that read the response body. It now checks a JSON request with FetchHttpClient.layer.
- A copied module-block Node import could fail because the starter disables Node declarations. The guide now installs @types/node and enables those types explicitly.
- The process exit guidance did not explain numeric main returns. It now states that normal return exits 0, failure exits 1 and interruption exits 130.
- Bun starter instructions could imply the generated app ran on Bun. They now distinguish the package manager from the Node runtime and link to Bun runtime setup.
- A platform import in a shared module could appear to supply services. The guide now explains that non-entry imports are removed and the entry must supply the platform.
- The Bun stack guide discussed only source-loader locations. It now also explains unmapped emitted-JavaScript stacks and the Node source-map command.
- The Vitest recipe could exclude test sources through the app project. It now selects a separate test project and includes a Node test-runner recipe.
- The React and Vite guides incorrectly required import rewriting for vite build. They now explain the plugin enables it automatically and distinguish direct CLI emission.
- The Vue and Svelte guides incorrectly required import rewriting for vite build. They now explain the plugin supplies it and keep the separate CLI requirements.
- The Vue and Svelte guides said an excluded VibeLang test fails with ENOENT. They now show the project-include error and the glob that repairs it.
- The Vue build guide omitted unresolved imports alongside vue-tsc's rewrite errors. It now identifies TS2307 for ./todos.vibe in runtime.ts and TodoBoard.vue.
- The late diagnostic reference omitted statement, escaping-fiber and mapper guidance. It now explains EK1017, EK4838 and the editor-only EK9101 with their repairs.
- Calling a program value whose type is an Effect intersected with other members, such as an Alchemy Worker (`Effect<Worker> & Named<...>`), reported `TS2349`. The call now runs the program, as it does for a plain `Effect`.
- Compiling a project of several `.vibe` files with declarations on could stop with "fatal error: concurrent map read and map write", because the declaration files of different files were written in parallel over shared state. Each file now works from its own copy, and the compiler finishes.
- An unfinished top-level `await` statement in a module, such as `export {}; await + f(const 0 await !x`, parsed its last tokens twice, into two overlapping statements. The parser now keeps one.
- Formatting a file twice could indent a line again when the first format moved a statement onto a line of its own and the statement continued on the next line: a call's arguments, as in `{{0!\n("")}}`, a binary operator, as in `{{x\n+ y}}`, or a `%` operand. The first format now gives the final indentation.
- Abstract classes could silently become services, and service defaults used a different contract from Effect; services now use `service` declarations and `defaultValue` thunks checked as `() => Shape`.
- The same `A!E` annotation meant different types on a function and a service member; omitted slots now mean `never` everywhere.
- Workspace dependency cycles could make `setup` miss Bun preloads and Vite wiring for packages that imported migrated code. Every package that reaches the code is now wired.
- A passing compiler-case suite gave no warning when a case or phase became slower; `scripts/bench/case-timings.mjs` now compares repeated timing reports, flags median increases over `50%` without blocking correctness checks, and rejects incomplete or mismatched evidence.
- ESLint rules saw adjacent generic openings such as `F<<T>(x: T) => T>` as one `<<` token; they now receive both `<` tokens at their source positions, while left-shift operators stay intact.
- Knip reported a public export as unused when its JSDoc followed a statement separated by CR, U+2028 or U+2029; these line terminators now keep the tag just as LF and CRLF do.
- Knip reported an export marked with `@public` as unused when the comment followed an earlier statement on the same line; the adapter now preserves the context Knip reads in TypeScript.

### Known bugs

These bugs were found and confirmed and are being fixed; please don't re-report them, and each entry moves to the fixed list when its fix lands.

- A `tsconfig.json` broken so that it parsed with a computed property name, such as one with an unterminated string before `"lib": ["esnext"]`, crashed the compiler while it looked for the legacy `vibelang.diagnostics` setting. Looking up a setting now skips names that have no text, and the file's syntax errors are reported.
- Vite cannot load tests when the project's path contains `#`, even in a plain project without VibeLang. Use a directory path without `#`.
- Under Yarn Classic, `import { NodeRuntime } from "@effect/platform-node"` fails at startup unless `redis` is installed, because the package's root module loads its Redis integration. Import the module itself instead: `import * as NodeRuntime from "@effect/platform-node/NodeRuntime"`.

#### Generated names

- Your names can collide with the compiler's own names: for example,
  `answer$direct`, `sum$recur`, `work$try`, `$match1`, `$is`, `$noMatch`,
  `$awaitAll`, `$forConcurrent` or `Users_base`. Calls and patterns can use
  your value, or generated JavaScript and declarations can contain duplicate
  names. A local `SyntaxError` can also break the generated error check for
  `JSON.parse`. Rename the colliding source binding (see Known design issues).

#### `this`/`arguments`/`super` in effectful functions

- An effectful arrow that uses `this` only in a parameter default, a nested
  class's `extends` expression or a computed member name can lose its receiver
  and throw (see Known design issues). Capture `this` in a local before the
  arrow and use that local.
- A named effectful function expression that calls or returns its own name
  can refer to a generator instead of the function: retries can crash and
  recursion can overflow the stack. A declaration's self-reference in a
  parameter default can also return the wrong function. Use an anonymous
  function referring to its outer variable, and avoid self-referencing defaults
  (see Known design issues).
- `super.count++`, `--super.count` and computed compound assignments such as
  `super[key()] += value()` in an effectful method can produce JavaScript
  that fails to load or an invalid assignment target. Use separate reads and
  simple assignments, saving a computed key once (see Known design issues).
- A nested effectful arrow that reads `arguments` can see a different object
  from its enclosing function; mutations can also carry over between runs
  of the same program. Capture `const args = arguments` in the enclosing
  function body and share that local (see Known design issues).
- A producer that reads `arguments[0]` can yield `undefined` instead of its
  first argument. Use named parameters in the producer body
  (see Known design issues).
- An effectful arrow created in a constructor can see `new.target` as
  `undefined`. Capture `const target = new.target` in the constructor and
  read `target` from the arrow (see Known design issues).

#### Evaluation order

- `||` and `??` inside a program argument can test the cold Effect object
  instead of the call's result, skipping a fallback that should run. Pass a
  block program that stores the expression in a local before returning it
  (see Known design issues).

  ```vibe
  // fragment
  Effect.retry(first() || second(), { times: 0 })
  Effect.all([absent() ?? fallback()])
  ```

- Continuing an optional chain after an effectful call, as in
  `box?.read().value`, can throw when `box` is absent. Check the receiver
  explicitly before calling and reading the result.
- A value pipe such as `source() |> sink.take(%)` can read the stage's getter
  or function before running `source()`, reversing side effects or calling
  an old function. Store the left value in a local before applying the stage
  (see Known design issues).
- A trusted method call with effectful arguments can evaluate those arguments
  before looking up the method. Optional trusted calls can run arguments
  that should be skipped and can then throw. Check optional receivers and
  callables first, and save the method before evaluating its arguments.
- A `sync` or `try` hatch returning a scalar-or-Promise union can hand back
  an unresolved Promise despite a scalar result type; ordinary data with a
  non-callable `then` property can instead be treated as a Promise and crash.
  Use an async callback for mixed returns; for data with a `then` field,
  call the runtime's `sync` from a `module` block, where it is an ordinary
  function.
- `try(evaluate, makeMapper(), input())` can run `input()` before
  `makeMapper()`. Evaluate the mapper and inputs into locals in written order
  before calling the hatch.
- `wire(makeA(), makeB())` can evaluate layer factories in dependency order
  instead of the order you wrote, changing their side effects. Build the
  layers into locals in written order, then pass those locals to `wire`.
- `for concurrent(limit()) (const item of items())` can evaluate `items()`
  before `limit()`, even selecting an old collection and skipping work.
  Evaluate the limit into a local before the loop.
- A function with an Effect contract whose body compiles to plain
  JavaScript, such as `function twice(n: number): number!! { return n * 2 }`
  or `(x): number!! => x + 1`, is accepted where only a plain function fits:
  at a module's top level, in a plain function, as a plain callback, or as
  an overload's plain candidate. It runs synchronously there, and adding a
  pause to its body later turns each such use into an error. Call it only
  from Effect code, or remove the Effect contract if it is meant to be plain.

#### Errors

- When both a `try` body and its `finally` fail in an otherwise plain
  function, cleanup can replace the original failure instead of preserving
  both causes. An outer catch can receive the cleanup error instead of the
  original one (see Known design issues).
- A call in a catch binding's default can fail or need a service that the
  function's checked contract and declarations omit. Move destructuring
  and defaults into the catch body.

  ```vibe
  // fragment
  try { work() } catch ({ id = fallback() }) { return id }
  ```

- An error subclass without its own constructor can lose its own fields when its base has a custom constructor that rebuilds the argument object.
- An error subclass such as `error Child extends Base<number>` can be
  rejected because its generated constructor forgets the base's type
  arguments. Write an explicit constructor accepting the base and subclass
  fields and passing them to `super`.
- Throwing `Cause.fail(...)` inside an otherwise plain function can give
  `catch` the whole Cause instead of its error; `Cause.die(...)` can even
  be caught as an expected failure. Use `Effect.failCause` explicitly.
- A trusted tagged-template call can let its declared expected error escape
  as a defect, bypassing `catch`. Use an ordinary call to the trusted function
  where its API supports one.

#### Concurrency and resources

- Aggregate joins and races can hang during cancellation if one child's
  cleanup waits for another child's cleanup: children are interrupted one at
  a time. Avoid dependencies between sibling finalizers; when managing fibers
  explicitly, `Fiber.interruptAll` signals them together.
- `using` looks up `Symbol.dispose` or `Symbol.asyncDispose` again at cleanup
  time. Replacing the method, or using a getter that returns different methods,
  can run the wrong disposer. Keep the disposal method stable for the lifetime
  of the binding.
- `join tasks` can read object getters or array entries twice, joining a
  different child from the one used for cancellation. Copy the selected fibers
  into a plain collection once before joining.
- `join` rejects a valid `Record<string, Fiber.Fiber<number>>`, yet can
  accept a record whose index signature also permits non-fibers and then
  crash. Use an object with explicit fiber properties, or map valid dictionary
  entries through `Fiber.join` and `Effect.all`.
- Assigning to a `const` binding in a `for concurrent` head is accepted and
  changes the value, including destructured bindings. Keep those bindings
  unchanged; introduce a separate local for mutable state.
- A `for...of` whose destructuring default runs an Effect can leave its
  iterator open when that default fails. Move the destructuring and default
  into the loop body.
- Array destructuring such as `const [n = fallback()] = values` can leave
  its iterator open if the Effect default fails. Destructure first, then run
  the fallback after destructuring has finished.
- An effectful `for...of` over an array with a custom iterator can skip
  iterator cleanup on failure. Bind the array as `Iterable<T>` before looping
  so it uses the protected iteration path.

#### Services and layers

- A service's `static readonly defaultValue` is not checked against its declared
  shape or method contracts. Wrong value types, hidden failures or plain
  methods where Effect methods are required can compile and then fail or
  return the wrong type. Use an explicitly checked provider such as
  `Layer.succeed` for the implementation.
- Providing a choice between layers or contexts can claim that every branch's
  services are available, even though only one branch runs. Missing-service
  failures then appear at runtime despite a closed contract. Branch around
  separate provider blocks, or make every branch supply the required services.
- A possibly empty array of layers can count as providing its element type's
  services even when the array is empty. Use a nonempty provider tuple or
  provide the required layer directly.
- Calling `wire` through an import alias, a namespace or a tuple spread can
  skip dependency ordering and fail with a missing service. Use the direct
  `wire(layerA, layerB)` form with explicit arguments.
- `wire(layer)` can erase a layer's requirement for the same service it
  produces, even though building that layer still needs an external provider.
  Use the layer directly and supply its input service.

#### `match` and `data`

- Matching `Option<A> | string` with the Option arms first can be rejected
  because the generated tests require an already narrowed Option. Put the
  disjoint `String` arm first.
- A match covering every nested data variant can still be reported as
  non-exhaustive. Match the nested field separately, or add a fallback arm.
- A nested property pattern that both tests and binds a getter's value can
  read it twice, binding a different value from the one that passed the test.
  Read the property into a local and match that saved value.
- A variable pattern named `String`, `Number` or another built-in matcher
  can ignore your binding and use the built-in test; a data type named
  `Option` can be mistaken for Effect's Option. Rename the source binding
  (see Known design issues).
- A custom extractor inside an `or` pattern can be
  rejected because its generated result is not kept for narrowing. For `or`,
  use separate adjacent match arms instead.
- The final arm of an exhaustive data match can skip evaluating the matcher
  expression, including its getters. Store the matcher value in a local before
  matching if its lookup must run (see Known design issues).

#### Modules and declarations

- A dynamic import of a VibeLang source can keep the source extension when
  extension rewriting is disabled, or fail to escape URL characters such as
  `#` when it is enabled, so the emitted module cannot be loaded. Use a static
  import where possible.
- Importing Effect's `pipe` under another name can reject a program argument
  that works with the name `pipe`. Keep that import named `pipe`
  (see Known design issues).
- CommonJS imports of source modules with spaces or URL characters in their
  names can request an encoded filename that does not exist. Rename the
  source module to avoid those characters.
- A service inside a namespace can work at runtime but lose its service-key
  API in generated declarations, so TypeScript consumers reject it as a
  provider key. Declare and export the service at the top level.
- A generated `.d.ts` types an exported function with no return contract
  and a body that compiles to plain JavaScript, such as
  `export function double(n: number) { return n * 2 }`, as returning an
  Effect. A consumer compiled against the `.d.ts` instead of the source
  gets unrun Effects from `[1, 2].map(double)`, with no diagnostic, and
  `double(2)` at its top level is `EK1001`. Give such an export a plain
  return contract, `double(n: number): number`, which the `.d.ts` keeps.

#### `--fix` and the formatter

- Formatting can reorder value imports and change the order in which their
  modules initialize, changing program behavior. Disable import-declaration
  sorting in the formatter settings when initialization order matters.
- `--fix` can discard comments when converting tagged error fields or
  unwrapping `Effect.succeed` and `Effect.fail`. Preserve those comments when
  applying the change manually.
- Converting `catchTag` or `catchTags` to a class pattern can stop catching
  a copied or structural error that has the right `_tag` but no class
  prototype. Keep a structural tag pattern, or keep the original call.
- Converting `catchTags` can reuse one handler's parameter as the shared
  catch binding and capture a different handler's outer variable, changing
  its result. Apply the rewrite manually with a fresh catch binding
  (see Known design issues).
- Import cleanup after a form rewrite can remove an entire import and
  silently skip that module's initialization. Retain a side-effect-only
  import when its initialization is needed (see Known design issues).
- Converting `Effect.provide(programExpression, layerExpression)` to a
  provider block can evaluate the layer before the program expression.
  Evaluate the program into an explicitly Effect-typed local first, then
  evaluate the provider and run the saved program inside its block
  (see Known design issues).
- Converting a `Context.Service` class can delete evaluation of a dynamic
  key expression such as `keys.pop()`. Keep the original declaration when
  evaluating the key has side effects (see Known design issues).
- The editor's quick fix from a tagged error class can truncate a constrained
  generic parameter or a comment containing `extends`, leaving invalid syntax.
  Preserve the full type parameter list when converting manually; CLI `--fix`
  refuses this malformed edit.
- One `--fix` invocation can stop after 16 rounds with deeply nested,
  overlapping fixes still available. Run it again until it reports no edits.

### Known design issues

The language design has these confirmed inconsistencies; the specification is
being revised, programs that rely on them may change, and each change will be
listed with an upgrade step.

- **A parameter type can move argument work in time.** An `Effect` parameter
  passes the whole call expression by name, so even its receiver and inputs
  can run again on every retry, after later arguments have already run.
  A mixed `Effect<number> | number` parameter or an unfixed generic `T`
  instead runs the argument at the call; fixing `T` from another argument
  can change that choice. Overload selection can choose this strategy and
  a callback's function-or-program representation. The same issue reaches
  program topics in pipes and elements passed to `Effect.all`.
  Vladimir Kalnitsky raised the central call-argument issue. Today, save
  inputs in locals when they must run once, and use an explicit block program
  when work must repeat; check the selected signature after library updates.

  ```vibe
  // fragment
  retry(fetchUser(nextId()), policy) // nextId can run on every attempt
  acceptMixed(fetchUser(nextId())) // Effect<User> | User: runs at the call
  acceptGeneric(fetchUser(nextId())) // unfixed T: runs at the call
  ```

- **Annotations can run a value or hold it as a program.** An inferred
  binding runs a call, while an explicitly Effect-typed `const` holds it;
  object fields, conditional initializers and factories add more holding
  rules. A factory's outer body can run while constructing the held program.
  At a return boundary, whether an Effect subtype is data also depends on
  the written or contextual success type, so widening it can stop work from
  running. Today, use `const p = () => work()` to defer work explicitly,
  save construction inputs separately, and call a returned program as `p()`
  when execution is intended, including in release callbacks.

  ```vibe
  // fragment
  const value = work() // runs here
  const held: number!! = work() // holds a program
  const explicit = () => work() // explicit deferred body
  ```

- **Some helper aliases need explicit checking.** Aliasing helpers such as
  `pipe` can lose their special handling. Retain documented helper names
  and verify that an alias preserves the intended behavior.

  ```vibe
  // fragment
  const helper = { runSync: (n: number) => n * 2 }
  const doubled = helper.runSync(21) // can suppress the entry for main
  ```

- **Plain `finally` and Effect `finally` combine failures differently.**
  The plain JavaScript path can replace the body's failure with cleanup's
  failure; the Effect path retains both causes. Adding an Effect operation
  can therefore change the error an outer catch receives. Today, keep fallible
  cleanup in an explicit Effect program and combine it with the body using
  `Effect.onExit`; avoid relying on plain `finally` to preserve both failures.

  ```vibe
  // fragment
  try { throw new BodyError() }
  finally { throw new CleanupError() }
  ```

- **Module names that differ only in letter case are one module.** A
  module declaration compiles to a file named for it in lower case,
  `main.vibe.state.js`, so `module State` and `module state` in one file are
  EK4408, unlike two bindings. Today, use names that differ by more than case.
- **A generic return type can decide whether a result runs.** Calls whose
  instantiated return type is Effect run their result, while mixed unions
  and structured Effect subtypes can remain data; an optional call has its
  own running rule. A generic identity helper is therefore not necessarily
  an inert pass-through for a program. Today, avoid routing program values
  through such helpers: return a holder such as `{ program }` to keep one
  as data, and call `holder.program()` explicitly when it should run.

  ```vibe
  // fragment
  declare function identity<T>(value: T): T
  identity(savedProgram) // instantiated Effect result can run
  ```

- **A plain return annotation changes foreign-call failure handling.**
  A TypeScript call that needs a trust boundary in an Effect function can
  become an ordinary call inside a plain-annotated helper; trusted listed
  failures can become defects rather than enter E. A plain annotation is
  therefore no proof that foreign code cannot throw. Today, use an explicit
  `try` hatch to map expected exceptions and declare the resulting error
  contract, including inside helpers; do not use a plain wrapper to bypass
  a boundary diagnostic.

  ```vibe
  // fragment
  function plain(n: number): number { return foreignRisky(n) }
  function computational(n) { sleep("1 millis"); return foreignRisky(n) }
  ```

- **Completing an error contract can change what callers see.** Callers
  of a function with a written E see its declared error family, while
  callers of one without a contract see the narrower inferred errors. Check
  emitted declarations after extracting a signature.
- **Timeouts and races can discard cleanup failures.** The promise that
  cleanup failures are preserved applies to local finalization, but pinned
  Effect's `timeout`/`race` can discard a losing fiber's final exit, including
  its cleanup failure. Today, record failures inside the child's finalizer
  before it exits; if every cause is required, manage and observe each
  child's `Exit` explicitly rather than relying on the race's parent cause.

  ```vibe
  // fragment
  timeout(() => {
    try { sleep("1 hour") } finally { throw new CleanupError() }
  }, "10 millis") // parent can report only TimeoutError
  ```

- **Effect member lookup depends on declaration conventions.** Synthesized
  data methods depend on a receiver parameter named `self`, `*OrOptions`
  or a special-case table. Real members and a module's own exports win over
  synthesized methods and same-named service exports, so an Effect update
  can silently redirect a call. Today, keep the exact Effect pin, prefer
  explicit module functions such as `Stream.take(stream, 3)`, and call a
  service through its explicit key when a module export would be ambiguous.

  ```vibe
  // fragment
  stream.take(3) // synthesized from the library declaration
  Stream.take(stream, 3) // explicit module function
  ```

- **Construction and execution phases are not fully specified.**
  Defaults, destructuring, getters and collection iteration do not share
  one complete phase rule with cold calls, factories and held values. A
  reusable Effect also need not recreate a captured iterator, hot Promise
  or resource. Today, evaluate once-only inputs into locals, create fresh
  inputs inside an explicit program when each run needs them, and avoid
  side effects in defaults or getters at these boundaries.

  ```vibe
  // fragment
  const shared = () => consume(iterator) // captures one iterator
  const fresh = () => consume(makeIterator()) // creates one per run
  ```

- **Generated bindings lack one general capture-avoidance rule.**
  The specification has local naming fixes but no universal requirement that
  generated names preserve every source binding. A legal user name can
  therefore be captured by a generated helper. Today, avoid the compiler
  helper names listed under Known bugs and rename a colliding local.

  ```vibe
  // fragment
  const savedAnswer = 99 // avoid a helper name such as $match1
  const answer = match (1) { when 1: savedAnswer; default: 0; }
  ```

- **Moved function bodies lack one complete lexical-context rule.**
  The specification's separate receiver and closure promises do not cover
  every use of `this`, `arguments`, `new.target`, `super` and a named
  function expression's self-binding through suspension and reruns. The
  implementation symptoms and repairs are listed under Known bugs. Today,
  capture source activation values before creating effectful arrows, use
  named producer parameters, and use simple `super` reads and assignments.

  ```vibe
  // fragment
  const receiver = this
  const later = () => { sleep("1 millis"); return receiver.value }
  ```

- **A generator's annotation selects its runtime protocol.** An unannotated
  `function*` is a Stream producer, while an explicit `Generator` or
  `AsyncGenerator` return annotation selects a native JavaScript iterator.
  Adding a type can therefore change how the result is consumed and which
  operations are allowed. Today, keep native generators in a `.ts` module
  and use a VibeLang producer consistently for Stream work.

  ```vibe
  // fragment
  function* produced() { yield 1 } // Stream producer
  function* native(): Generator<number> { yield 1 } // JavaScript iterator
  ```

- **Separate compilation has no complete semantic metadata contract.**
  The specification promises checked handler and callable behavior across
  packages while also saying some control metadata is not emitted
  or read. An Effect-shaped declaration alone cannot certify a foreign
  callback's fiber behavior or a factory's construction phase. Today, keep
  compiler and runtime versions aligned, inspect emitted contracts, and
  keep handler-sensitive code together or behind explicit trusted adapters;
  do not infer continuation safety from a `.d.ts` return shape alone.

  ```vibe
  // fragment
  declare function externalWork(): number!! // shape alone is no certificate
  const p = () => externalWork() // verify the boundary before using a handler
  ```

- **A type-correct rewrite can still change behavior.** Automatic fixes and
  optimizations lack one common requirement covering values, causes, evaluation
  phase, bindings and ownership. Checking that a rewrite adds no errors does
  not prove those observations are preserved; even an exhaustive final match
  test can have an observable getter. Today, review automatic fixes, preserve
  explicit scopes and once-only locals, and compare effects and cleanup in
  tests before accepting a rewrite at these boundaries.

  ```vibe
  // fragment
  Effect.provide(makeProgram(), makeLayer())
  provide makeLayer() { makeProgram() } // construction order can change
  ```

- **The specification makes EK4802 an error by default; the compiler still
  warns.** Returning an Effect value from a function that runs Effects, where
  the success type names no value, reports EK4802 as a warning until the
  compiler's default changes. Treat it as an error today: return the result,
  `return program()`.
- **The specification says a hatch waits only for a function written
  `async`; the compiler still waits for a promise that a synchronous hatch
  function returns.** Today `sync(() => Promise.resolve(5))` succeeds with
  `5`; under the specification it succeeds with the promise itself. Write the
  function `async` when you mean to wait, which both treat the same way.
- **The specification makes EK9100 an error that no setting lowers; the
  compiler warns in the editor only and a project can set it.** Write the type
  it asks for, which both accept.

### Known limitations

- An interruption that arrives while a `using` initializer runs in a mask
  of its own, as in `using r = Effect.uninterruptible(() => open())`, is
  delivered as that mask ends, before `using` receives the value, as Effect
  delivers it. A Disposable made there is not released. Acquire it with
  `using r = Effect.acquireDisposable(() => open())`, which registers its
  disposal inside the mask.
- Platform checks are static, lint-strength checks, not a sandbox. Aliases
  such as `const g = globalThis; g.process.pid`, calls through `as any`,
  and `Reflect.get` can bypass them. See [the scope of platform checks](../platform/platform-globals.md#limits-of-static-checks).
- `Intl.DateTimeFormat().format()` reads the current clock without EK4403
  when no argument is supplied. Read time with `Clock` and pass the value
  explicitly. See [clock-check limitations](../platform/platform-globals.md#limits-of-static-checks).

### Platform

- The file that exports `main` names its platform once with
  `import "vibelang/platform/node"` (or `"vibelang/platform/bun"`,
  `"vibelang/platform/browser"`). When `main` needs services of that
  platform's bundle, such as `FileSystem` and `Path`, the compiled module
  runs it with the bundle's layer, so `main` no longer writes
  `provide NodeServices.layer`. The import loads nothing; the compiler removes
  it. A `provide` inside `main` still wins, tests provide their own layers,
  and EK3205 names only the services the layer does not provide, with the
  layer that provides each of Effect's and the experimental ones. Without the
  import, nothing changes, and EK3205 names the import that would provide
  the platform's services. A file names one platform: a second, different
  platform import is error EK3206.

### Experimental platform APIs

- `Experimental`, in scope in every `.vibe` file, holds what Effect lacks.
  Each service has its own key; it is experimental and goes when Effect ships
  the API. See
  [Experimental platform APIs](../vibelang-features/118-experimental-platform-apis.md).
  - `Experimental.FileSystem` adds `access(path, { executable })`,
    `open(path, { nonBlocking })` and `File.chmod` to Effect's `FileSystem`.
    `lstat` is Effect's own since 4.0.6.
  - `Experimental.Crypto` adds `hmac`, `sign` and `verify` (ECDSA P-256 and
    Ed25519), with secret keys as `Redacted<Uint8Array>`, beside the members
    of Effect 4.0's `Crypto`, which Effect 4.1 replaced with `effect/crypto`.
  - `Experimental.Process` reads the process id, platform, architecture,
    executable, versions, host name, available parallelism, time origin and
    memory use, and signals processes with `kill` and `isRunning`. Its native
    `homeDirectory` query follows `os.homedir()` account fallback; Effect's
    `UserDirectories.home` resolves the configured environment. Browsers have no
    `Process` layer.
  - `Experimental.Locks` holds Web Locks with `hold`, `tryHold` and `query`.
    Node.js's `ExperimentalNodeLocks.layer` locks only within one process; Bun has no
    layer.
- The experimental `FileSystem` and `Crypto` keys are class services, as
  Effect declares them. `Experimental.FileSystem.Service` is a superset of
  Effect's interface, but the service is not Effect's: a layer of Effect's
  `FileSystem` does not provide it.
- `vibelang-runtime/experimental/platform-node`, `-bun` and `-browser` hold
  the layers. `ExperimentalNodeServices.layer` and `ExperimentalBunServices.layer` there are the
  platform bundles plus `FileSystem`, `Crypto` and `Process`, and
  `ExperimentalBrowserServices.layer` provides `Crypto`, Effect's crypto
  services and `Locks`. A layer of a service that extends Effect's provides
  the experimental service and Effect's from one implementation, and a
  `Crypto` layer provides the platform's Effect crypto services too.
- `vibelang-runtime` lists `@effect/platform-node`, `@effect/platform-bun` and
  `@effect/platform-browser` 4.1.1 as optional peer dependencies.
- EK4402 names the experimental service instead of a hatch, with no import:
  `Experimental.FileSystem` for `X_OK` and `O_NONBLOCK`, `Experimental.Process` for `os.hostname()`,
  `process.pid`, `process.kill` and the other calls it replaces, and
  `Experimental.Locks` for `navigator.locks`. It names Effect's own
  `FileSystem.lstat` for `lstat`, `Experimental.Process.homeDirectory` for
  native `os.homedir()`, and `effect/crypto`'s `Mac`, `Signature`, `Aead` and
  `Cipher` for HMAC, signatures and ciphers.

### Prelude

- Every module of `effect`'s subpath packages is in scope without an import,
  as the root's modules are: `HttpRouter`, `HttpClient`,
  `ChildProcess`, `ChildProcessSpawner`, `TestClock`, `Hex`, `SqlClient` and
  the rest. Imports you already have keep working and shadow the global. Where
  two names meet, a JavaScript or shared web global wins (`Headers`,
  `Response`, and now `Event`), then a root module (`Utils`); `Model` and
  `Prompt`, which two subpath packages share, still need an import, and
  TS2304 names both. With the DOM in `lib`, the bare name `Worker` is now
  `effect/workers`' module; use `globalThis.Worker` inside a hatch or TypeScript module for the DOM constructor.
  [Effect's modules](../getting-started/008-importing-effect.md) lists every
  collision.
- A module's name also names its export of the same name, wherever the module
  has no meaning of its own, a deliberate change from TypeScript: the
  type `Option<number>` is `Option.Option<number>`, `FileSystem.readFileString(path)`
  calls the `FileSystem` service with no import, `FileSystem()` is its
  implementation, and a member the module lacks reads the export, as
  `FileSystem.of` does. A service's value member reads from its
  implementation, `Path().sep`; `Path.sep` is EK4503, as it is on the key. The module's own exports win, so `Option.some` and
  `FileSystem.layerNoop` keep their meaning and `Option.Option<A>` still
  compiles. The same holds after `import { Prompt } from "effect/ai"`, and
  for the experimental services: `Experimental.Process.hostname()`
  calls the `Process` service with no import. In a
  type, the DOM's `Cache`, `Console`, `FileSystem`, `Scheduler`,
  `Transferable` and `Worker` lose their bare names; alias one in a `.ts`
  file to use it.
- An error on a name these rules settle says which meaning the name has and
  how to reach the other: `function send(m: Message)` (TS2709) names Effect's
  `effect/cluster/Message`, `new Worker("./worker.js")` (TS2351) names
  `globalThis.Worker` for the DOM's, and `Number.sum(1, 2)` (TS2339) says
  JavaScript's `Number` wins and suggests
  `import { Number as EffectNumber } from "effect"`.
- `vibelang --fix` removes the imports these make redundant and writes
  `M.M` as `M` where the module's name means its export:
  `FileSystem.FileSystem.readFileString(path)` becomes
  `FileSystem.readFileString(path)` and `Option.Option<number>` becomes
  `Option<number>`. Run it once after you update.

### Platform code

- Node.js reaches a `.vibe` file only through Effect's services or by
  escaping to TypeScript. Node's globals (`process`, `Buffer`,
  `require`, `__dirname`, ...) and the web's globals that do I/O or read the
  clock or randomness (`fetch`, timers, `console`, `crypto`, `performance`,
  `localStorage`, ...) are no longer in scope in `.vibe`, holding one as a
  value included, and a `.vibe` file no longer imports a `node:*` or bare
  Node.js module as a value. Each is EK4402, which names the replacement.
  `import type` from them, ECMAScript's built-ins, the web's pure helpers
  (`URL`, `TextEncoder`, `structuredClone`, `AbortController`, ...), and
  `.ts` files are unchanged. [Platform globals](../platform/platform-globals.md)
  lists every answer. How to fix each kind:

  | You wrote | Write instead |
  | --- | --- |
  | `import { join } from "node:path"` and the like | the Effect service with no import: `Path.join(directory, name)`, `FileSystem.readFileString(path)`, `ChildProcessSpawner.string(ChildProcess.make(command, args))` |
  | `process.env.NAME` | `Config.String("NAME")()` |
  | `process.argv`, `process.cwd()` | `Stdio.args()`, `Path.resolve()` |
  | `process.pid`, `os.hostname()`, `fs.lstat` | VibeLang's experimental services, such as `Experimental.Process.pid()` |
  | `console.log`, `setTimeout`, `crypto.randomUUID()` | `Console.log`, `sleep`, `SecureRandom.uuidV4()` |
  | `Buffer.from(text)` | `new TextEncoder().encode(text)`, or `Base64` and `Hex` |
  | a Node.js value an Effect API takes, such as `createServer` | a `module` block that imports it: `module node { export { createServer } from "node:http" }`, then `import { createServer } from node` |
  | a Node.js API nothing covers yet | the same `module` block or a `.ts` file, called through a hatch |

### Repeated is binding names

| Before | After and repair |
| --- | --- |
| Two `is` patterns binding one name in one block, such as `if (a is { id: let id }) …` twice in a function body | Each `if` head was its own scope; the bindings now live in the block that holds the `if` (chapter 004, decided detail 245), so the second pattern redeclares the name: `TS2451`, or `TS2300` beside a parameter. The diagnostic offers to rename the later binding and its uses, and `vibelang --fix` applies the rename (`id` becomes `id2`). |

## 0.0.10

Update `vibelang`, `vibelang-runtime` and the bundler plugin together. This
release restores the terse contract syntax and fixes resource cleanup,
recursion and matching. It also adds diagnostics: see the migration details
under Diagnostics before updating code that compiled on 0.0.9.

### Effect 4.0.6 and failures

Use exactly `effect@4.0.6`. Update `@effect/platform-node`,
`@effect/platform-bun` and `@effect/vitest` to `4.0.6` when used, and set
the `@effect/platform-node-shared` override to `4.0.6`. The starter includes
these pins. Syntax and error-channel types are unchanged.

A failure whose cleanup crashes is now a defect, following Effect 4.0.6:

```vibe
// fragment
error Busy

function save() {
  try {
    throw new Busy()
  } finally {
    die("flush crashed")
  }
}
```

Before, `exit(save())` contained `Fail(Busy) + Die("flush crashed")`.
Now it contains `Die(Busy) + Die("flush crashed")`, in that order, and
`cause.hasFails()` is false. The same rule applies to cleanup from `using`,
producers and abandoned continuations, and to combined concurrent failures.
A `catch` does not recover these defects. Effect's typed recovery operators
(`result`, `option`, `ignore`, `catchTag`, and fallbacks) now preserve them
too; `await.allSettled` propagates the defect instead of returning a failed
`Result`. `Effect.catchDefect` sees the original error first.

A failure beside an interruption, with no defect, is now caught:

```vibe
// fragment
error CleanupFailed

function stopped() {
  try {
    interrupt()
  } finally {
    throw new CleanupFailed()
  }
}

function recover() {
  return stopped() catch () => "recovered"
}
```

Before, `recover()` propagated `Interrupt + Fail(CleanupFailed)`. Now it
returns `"recovered"`, as `Effect.catch` does: the first expected failure
reaches the handler and the accompanying interruption is dropped. Catch
statements and handler expressions follow the same rule. Interruption alone
still propagates, and pending cancellation of the running fiber still unwinds
it. VibeLang's internal abandonment signal still bypasses recovery so cleanup
cannot resume an abandoned continuation.

`retry` likewise retries a failure beside an interruption, but never a cause
containing a defect. `Effect.mapError` maps every expected failure in place and
preserves the other reasons. Code that inspects causes or depended on an
Effect recovery operator dropping a cleanup defect should be updated.

### Upgrade an existing project

Keep VibeLang packages at 0.0.10. Update Effect and its platform and test
packages together, and set the transitive peer override in `package.json`:

```json
{
  "overrides": {
    "@effect/platform-node-shared": "4.0.6"
  }
}
```

With npm:

```sh
npm install --save-exact vibelang-runtime@0.0.10 effect@4.0.6 @effect/platform-node@4.0.6
npm install --save-dev --save-exact vibelang@0.0.10 vibelang-vite@0.0.10 @effect/vitest@4.0.6
npm run build
npm test
```

With Bun:

```sh
bun add --exact vibelang-runtime@0.0.10 effect@4.0.6 @effect/platform-node@4.0.6
bun add -d --exact vibelang@0.0.10 vibelang-vite@0.0.10 @effect/vitest@4.0.6
bun run build
bun run test
```

Update only the platform and test packages your project uses; a Bun platform
project uses `@effect/platform-bun@4.0.6` instead of the Node platform.
Commit the updated lockfile. Review tests that inspect causes, recover a
failure beside interruption, or expect a cleanup defect to be dropped, using
the before/after examples above. See [Existing project](existing-project.md)
for mixed TypeScript and editor setup.

### Syntax

- The terse contract syntax is back as an alias of `Effect<A, E, R>`.
  Both spellings work in the same file; guides, the skill and the starter use
  the terse form again:

  | Terse | Means |
  | --- | --- |
  | `User!NotFound!Db` | `Effect<User, NotFound, Db>` |
  | `User!NotFound!` | `Effect<User, NotFound>`: needs nothing |
  | `User!!Db` | `Effect<User, never, Db>`: cannot fail |
  | `User!!` | `Effect<User>`: cannot fail and needs nothing |
  | `User!NotFound` on a function with a body | `Effect<User, NotFound, infer R>` |

- `Effect<User>` keeps its 0.0.8 and 0.0.9 meaning,
  `Effect<User, never, never>`. Code using the 0.0.6 shorthand compiles
  again; EK1014 is retired. Hovers and fixes show the terse form.
  EK4833 still warns only on `Effect.Effect<…>`; its fix writes the terse
  form, including `Effect.Effect<A>` and `Effect.Effect<A, E>` on a body.
  `--fix` leaves existing `Effect<…>` annotations alone.

### Resource safety

- A C-style loop head such as `for (using h = acquire(); …; …)` releases
  its resources on every exit: normal completion, jumps, return, typed failure,
  defect and interruption. Multiple head values release in reverse order.
  Effect acquisitions in the head now compile, and labeled loops preserve
  their `break` and `continue` targets.
- `for (using x of values)` disposes each element when its iteration ends,
  then closes an iterator, producer or Stream on early exit, including failure
  and interruption. Producers and Streams now run in this form; generator
  `finally` blocks that were skipped now run.
- For a JavaScript Disposable acquired with an explicit release, use the
  documented plain holder pattern: acquire `{ value: disposable }` and
  release `holder.value`. Binding the Disposable itself also invokes
  `Symbol.dispose` and can release it twice. The pending-interruption window
  between a synchronous JavaScript acquisition and registering disposal still
  exists; see [Scope](../resource-management/030-scope.md).

### Correctness

- Plain recursive call cycles start with fast JavaScript calls and continue
  on heap frames at the eager depth limit, avoiding stack overflow for deep
  recursion. Calls through synchronous callbacks and functions with a plain
  return annotation still have JavaScript's stack limit.
- `match` and `is` read their subject once, including property getters,
  optional chains and patterns that perform several tests. An arm's binding
  no longer shadows the subject before it is read. Exhaustive matches over
  discriminant properties and optional-chain subjects retain their narrowing.
- Callable Disposables are disposed in blocks and loops. Await operations
  also accept callable iterables instead of treating them as records.
  Thanks to [Vladimir Kalnitsky](https://github.com/klntsky) for contributing
  the callable resource fix.
- Checking large `data` matches and `is` chains caches tag narrowing and
  matcher resolution, avoiding cubic work. A per-body budget of 3,145,728
  uncached union members bounds pathological cases with TS2563; split an
  oversized match into smaller functions if it reaches that limit.

### Diagnostics

Changes to previously accepted code:

- A typed catch expression, `load() catch (e: NotFound) => fallback`, now
  reports EK2112, a fixed-severity **warning**. It still compiles; the
  annotation never filtered failures. Write an untyped `catch (e)` and
  test `e` with `match` or `is`, rethrowing unhandled failures.
  The editor and `vibelang --fix` can make that rewrite.
- EK4409 now also warns when a primitive-success contract returns a call
  through `any` whose local initializer proves it returns a cold program.
  Give the callee an Effect-returning type so its call runs the program.
  With EK4409 configured as an error, previously accepted code in this case
  stops compiling until fixed. Ordinary dynamic value calls keep their existing behavior.
- The data-pattern work budget above can stop a formerly accepted, oversized
  body with TS2563. Split it into smaller functions.

New explanations for code that already failed, and improved messages:

- `fork do { … }`, `uninterruptible do { … }`,
  `interruptible do { … }` and `restore do { … }` now report EK1003,
  an **error**. Remove `do`: write `fork { … }`, and likewise for the
  other direct blocks.
- EK1015 explains `yield* call()` outside a generator: remove `yield*`,
  since a VibeLang call already runs.
- EK4502 explains `call().pipe(…)` when the success value has no `pipe`
  member: use `call() |> retry(%, policy)` or `retry(call(), policy)`.
  A result with its own `pipe` member still works.
- EK4503 explains implementation member reads such as `Users.region`:
  use `Users().region` inside an Effect function. Direct
  `Users.find(id)` calls and static key members stay valid.
- TS2540 explains implicit readonly members and shows `mutable`.
  EK1001 explains a misused inferred Effect default parameter: make the
  parameter optional and compute its default in the body.
- EK4701 names a missing nested data pattern, including its field path.
  An unresolved `TestClock` name suggests
  `import { TestClock } from "effect/testing"`.
- EK4402 names each platform API's Effect replacement, named import and
  providing layer: `FileSystem` with `NodeServices.layer`,
  `HttpClient` with `FetchHttpClient.layer`, `Path.resolve()` for
  `process.cwd()`, and `FileSystem.makeTempDirectory()` for
  `os.tmpdir()`. Where Effect lacks an API, such as `os.hostname()`,
  it shows a `sync` hatch.
- EK4403 preserves units and test advice:
  `performance.now()` becomes
  `Number(Clock.monotonicTimeNanos()) / 1e6`, and `new Date()` becomes
  `DateTime.nowAsDate()`. Crypto replacements name their import and layer,
  and `TestCrypto.layer(seed)` for tests. The diagnostic configuration
  belongs in the top-level `vibelang.diagnostics` object of
  `tsconfig.json`.

### Tooling

- Completion hides compiler-written match bindings and the synthetic service
  brand. `noUnusedLocals` no longer reports compiler-written bindings.
- Watch summaries count warnings separately from errors.
- The formatter normalizes spaces after declaration keywords and preserves
  either contract spelling. The starter's documented dprint configuration
  formats its generated app.
- Typed catch fixes preserve comments, and catch rewrites omit unreachable
  default rethrow arms when the handlers cover every failure.
- `vibelang/project` resolves relative project paths from the caller's
  working directory, including compiler discovery.
- `--help` lists VibeLang's flags. The starter test command discovers its
  tests; the compiler's Go smoke suite has an explicit 20-minute timeout.
- Compiler package attribution points to the unified TypeScript upstream.

### Editor

- The VS Code and Cursor extension uses the VibeLang mark for `.vibe`
  files; packaging tests verify the icons in the VSIX.

### Docs

- Platform guidance starts with Effect's services, their imports and layers.
  Hatches illustrate APIs Effect does not cover, and complete Effect
  comparison tabs are checked as programs.
- Setup documents exact Effect pins, mixed TypeScript adoption and editing
  costs, local TypeScript and npm boundaries, supported dprint versions,
  cache startup, and current compiler limitations with executable evidence.
- Debugging guidance explains tracing, runner stacks and runtime costs.
  Token comparisons lead with measured corpus savings and identify longer
  VibeLang examples; they are not runtime performance promises.
- The shipped agent skill is self-contained. Public documentation clients
  can read the site without browser integrity checks. Repository paths,
  language names and editor setup guidance are current; retired hosted
  converter code and review scratch probes have been cleaned up.

## 0.0.9

This release has no breaking changes.

- `vibelang --fix` writes only the project's own files. It leaves workspace
  dependencies and referenced projects unchanged, while still reporting their
  diagnostics.
- When a round of fixes would add an error, `--fix` narrows down the refused
  fixes without rechecking the whole project once per file. Stopping it with
  SIGTERM exits cleanly, reports the interruption and writes no changes.
- Emitted declaration files import prelude names used in `typeof` queries
  and in inferred types copied from libraries. TypeScript consumers now
  resolve those names and retain their types.
- The register loader works with tools that read inline source maps, including
  Playwright's stack-trace support. They no longer mistake the loader's
  source map template for its own map.

## 0.0.8

0.0.7 was not published: 0.0.8 replaces it, and these notes include its changes.

### Changes that can break code since 0.0.6

- A contract is written `Effect<A, E, R>`, as in TypeScript. The shorthand
  `Result!Error!Dependencies` is retired: each use is the error EK1014,
  whose quick fix writes the Effect type it stood for. Run
  `vibelang -p tsconfig.json --fix` to rewrite a whole project:

  | 0.0.7 | 0.0.8 |
  | --- | --- |
  | `User!NotFound!Db` | `Effect<User, NotFound, Db>` |
  | `User!NotFound!` | `Effect<User, NotFound>` |
  | `User!!Db` | `Effect<User, never, Db>` |
  | `User!!` | `Effect<User>` |
  | `User!NotFound` on a function with a body | `Effect<User, NotFound, infer R>` |
  | `User!NotFound` anywhere else | `Effect<User, NotFound>` |

- A type argument left out of an Effect type means what it means in
  TypeScript: `Effect<A>` is `Effect<A, never, never>` and `Effect<A, E>`
  is `Effect<A, E, never>`. A return annotation such as `Effect<User>` on a
  function with a body was EK2003; it now checks that the function cannot
  fail and needs nothing. A service or control member may write
  `Effect<User>` or `Effect<User, NotFound>`, which EK2101 rejected.

- The starter treats EK3205 as an error: an entry module's `main` that
  needs services without providers stops the build and emits no JavaScript.
  Provide those services before running the entry program.
- Members returned by `Layer.effect(Service, effect { ... })` must fit the
  service's contract, as in `Layer.succeed`. EK3101 rejects a member that
  looks up services its contract does not allow at call time; failures
  outside the member's contract are EK2001.
- A recursive call whose contract leaves failures or requirements inferred
  uses the written success type in an operand or initializer. Where typing
  the call needs the whole contract, including an argument, a logical
  operand or a generic self-call, EK2102 asks for every channel instead of
  recursing through inference or reporting a circular return type.
- A `for...of` whose body runs an Effect calls its iterator's `return()`
  when the body fails or is interrupted, as it does on `break` or
  `return`. Iterator cleanup that was previously skipped now runs.
- EK4201 also rejects unhandled control operations passed by name across a
  fork, an await operation or a concurrent loop. Install the handler inside
  the new fiber, or run the operation on the current fiber.
- A comma between fields of an `error`, `schema error`, `service` or
  `control` declaration is EK1013. Separate fields with semicolons or new
  lines.

### Compiler

- A `data` declaration declares a tagged union with Effect's own
  `Data.TaggedEnum` type and its `Data.taggedEnum` constructors:
  `data Delivery { Waiting; Sent { tracking: string } }`.
  `Delivery.Sent({ tracking })` builds a value, and
  `when Delivery.Sent { let tracking }:` matches one. A `match` without
  `default` over a data type must handle every variant (EK4701). See
  [Data](../data-types/073-data.md).

- CommonJS output binds the names a file takes from the prelude, including
  `TaggedError`, bare Effect functions, `pipe` and `flow`. These names
  could previously fail with a `ReferenceError` when the module ran.
- Invalid jumps without a target, a Stream loop without a binding and
  incomplete Effect type arguments report diagnostics instead of crashing
  the compiler.
- A handler's tail `resume` inside a `for concurrent` body no longer
  reports EK4606.
- Hovering over a by-name argument no longer leaves the call inferred as
  `unknown`. The language server identifies itself as `vibelang`.

### New diagnostics

- EK1014 reports the retired contract shorthand and offers its
  `Effect<...>` replacement in the editor and through `vibelang --fix`.
- EK4833 reports only `Effect.Effect<A, E, R>`, and its fix writes
  `Effect<A, E, R>`. Hovers and messages show Effect types as `Effect<…>`.
- EK1013 names the field separator error, and its quick fix replaces the
  comma with a semicolon. Misspelled names in a `.vibe` file can suggest
  names from the prelude.
- EK1001 identifies the plain JavaScript context that cannot run a program,
  including class initializers, constructors, accessors, static blocks and
  default parameter values. EK4301's hatch suggestion includes the callback
  parameter where the call needs it.
- EK3201 explains that a program typed `any` has unknown service
  requirements. EK4401 suggests a `try` call that passes inputs into the
  hatch and the `trusted()` wrapper, and EK2003 explains that an exception inside a hatch
  becomes a defect with `sync` or an expected failure with `try`.
- With `--pretty`, a file with both TypeScript and VibeLang errors is
  counted once in the error summary.

### Starter and packages

- The starter builds standalone TypeScript sources, checks their errors and
  keeps source tests out of build output. New apps start at version
  `0.0.0`, and their README describes an installed app.
- The starter pins `@effect/platform-node-shared` to `4.0.5` so its
  transitive peer dependency agrees with Effect. Example projects install
  the published VibeLang packages and use the same platform override.
- `vibelang-vite` preserves fractional compile start timestamps when it
  compares file changes and provides compile and invalidation traces through
  `VIBELANG_VITE_DEBUG=1`.
- The release publisher skips an existing registry version only when its
  tarball checksum matches the local tarball. The internal TypeScript mapper
  is marked private.

### Docs

- The guides and packaged skill use `Effect<...>` contracts and teach
  `data` declarations and exhaustive matches.
- Setup describes npm and Bun separately, makes Bun optional for npm users
  and links TypeScript 7's removed-option migration notes. The Vite guide
  explains source checking and import extensions.
- The guides teach the current `trusted()` wrapper, the starter's provider
  check and Effect 4 APIs. They name `Cause.UnknownError`, explain that
  plain JavaScript recursion can overflow the stack, and link known
  limitations and the pending-interruption resource workaround.
- Examples omit harness directives and unexplained decision references.
  Token comparisons state the measured corpus, and agent setup starts with
  the packaged skill.
- GitHub is available from the site's top navigation on every page.

### Known limitations

- Stock `tsc`, `vue-tsc` and `svelte-check` do not check `.vibe` imports.
  The TypeScript 7.1 content mapper is experimental and unpublished, and
  does not lower `data` declarations; see
  [the current mapper limitation](known-limitations.md).
- Native Windows binaries are not available; Windows needs WSL.
- Effect remains pinned to `4.0.5` exactly. Effect `4.0.6` changes cleanup
  failure handling in a way VibeLang does not yet support; see
  [the pin's explanation](existing-project.md).
- A JavaScript Disposable acquired at the end of a masked `using`
  initializer can leak if interruption is pending before its release is
  registered. Use `Effect.acquireRelease` with protected acquisition; see
  [the safe pattern](../resource-management/030-scope.md#releasing-javascript-disposables).

## 0.0.6

0.0.5 was not published: 0.0.6 replaces it, and these notes include its
changes. 0.0.4 was not published either, so from 0.0.3 read the 0.0.4 notes
too.

### Changes that can break code since 0.0.3

These fixes are included in the changes since the last published version,
0.0.3. The comparisons below describe the unreleased 0.0.4 compiler.

- An optional call of a callback without a contract, `f?.(x)`, runs the
  program the callback returns, as `f(x)` does. On 0.0.4 it returned the
  program unrun. The callback's failures and requirements now reach the
  caller's contract, so a contract that leaves them out is EK2001 or EK2002.
- A file whose functions are Effects only because they throw, produce,
  declare `using`, or call `JSON.parse`, `decodeURI` or `decodeURIComponent`
  loads effect. On 0.0.4 such a function was typed and declared plain while
  its JavaScript returned an Effect. Where effect does not resolve, each such
  function is the new error EK1011.

### Compiler

- A comment before an expression that the compiler writes after a `return`,
  `throw` or `yield` stays a comment. A `match` arm whose value follows a
  comment, or whose pattern begins with a comment on its line, as in
  `when [ // first`, returned `undefined`.
- `uninterruptible { ... }` stays uninterruptible when it declares a `using`
  resource, and releases the resource when the block ends. On 0.0.4 such a
  block compiled without its mask, and an interruption reached its
  statements.
- The compiler no longer overflows the stack on a function that passes a
  call of itself by name, as `guard(healthy(index - 1))` does. It reports
  EK2102 at the function: write its failures and requirements in its
  contract.
- The failures and requirements of a callback without a contract default to
  `never`, so a call that omits an optional callback adds none.
- A call that runs no longer takes type arguments from its contextual type,
  which types its success value, not the Effect: `return late()` under
  `Late!!`, where `late` returns a `Late` error instance, compiles.

### New warnings

None of these warnings changes the emitted JavaScript.

- EK4409: a call of an `any`-typed value is a program's value or what an
  Effect function returns. The call returns its value, so a program the callee
  returns never runs. Give the callee a type. EK4409 is adjustable, like
  EK2004.
- EK4802 also reports an Effect value in a returned conditional's arm, in an
  operand of `??` or `||`, or on the right side of `&&`. Where the success
  type names no value (`void`, `unknown`, `any`, or a type parameter the call
  infers), it reports a returned Effect value or program literal, a program
  returned by name (a `const`, field or parameter), and a returned value whose
  type is a union with an Effect value or a program among its members. Its
  quick fixes call the value to run it, or write its type as the success type
  to return it; a union with a member that is no program gets only the second.
- EK2004 also reports where a plain function's `catch` lets an exception
  through: the first call in the `try` block of an untrusted function, a
  declaration without `@throws`, or a trusted package's export whose name
  ends in `Sync` or contains `OrThrow`. A plain `catch` receives expected
  failures only; `Result.try` or a `module` block catches the exception.
- EK1012: a call that never succeeds, stored by a variable's initializer, an
  object literal's field, an array element or an assignment. The call runs
  there, so `const missing = Effect.fail(new Missing())` fails at the
  `const`. To keep the program, write a function or the declared Effect
  type. EK1012 is adjustable, like EK4409.

### Tools and integrations

- Coverage: V8 coverage tools such as `@vitest/coverage-v8` and c8 count the
  functions and statements the author wrote, not the thunks and wrappers the
  compiler adds. Stack traces and breakpoints are unchanged.
- `vibelang-vite`: a Vitest rerun recompiles a `.vibe` module after its
  imports or the compiler change. The plugin keeps `.vibe` modules out of
  Vitest's on-disk module cache.
- Formatter: a `module` block formats to itself under a dprint host without a
  TypeScript plugin, where each pass added a blank line, and a statement that
  starts with a parenthesis formats with dprint's `;` guard instead of
  failing.
- The setup page's Bun check expects Bun 1.4.0 or later again.

### Known limitations

- A returned Effect value, program literal or program named by reference
  where the success type names no value is the success value, not a program
  to run. EK4802 warns.
- A stored call that never succeeds runs where it stands. EK1012 warns.
- A JavaScript Disposable acquired in a masked section at the end of a
  `using` initializer can leak when an interruption is pending: it is delivered
  as the mask ends, before `using` registers the release. The pending
  `scopes-using-pending-interrupt` case records `["acquired"]` instead of
  `["acquired","disposed"]`. Use `Effect.acquireRelease` with its default
  protected acquisition and an explicit disposal callback, or
  `using h = Effect.acquireRelease(...)` for a lexical lifetime.
  See the [safe pattern](../resource-management/030-scope.md#releasing-javascript-disposables).
- A class method annotated with a plain return type whose body runs an
  Effect keeps its plain type; called through an interface, it returns the
  Effect instead of running it.

## 0.0.4

### Changes that can break code that compiled on 0.0.3

Each one rejects, or changes, a program that compiled on 0.0.3 but ran
differently from what its types said.

- A `throw` that can escape a constructor, a getter or setter, a class
  `static` block, or a module's top level is a compile error: EK2003, or
  EK1001 at the top level. These run as plain JavaScript, so the throw ended
  the program with a defect its type said could not happen. A throw that a
  `catch` in the same code handles still compiles. Put code that must throw a
  JavaScript exception, such as a test's throwing getter, in a `module`
  declaration.
- A `match` arm that tests a class runs only for an instance of that class.
  A match that relied on a class pattern to cover a type that is neither that
  class nor a subclass of it is a compile error; on 0.0.3 it could run the
  wrong arm.
- A subclass in a schema error family that declares a `_tag` field must
  include its own name in that field's type.
- A `const` declared with an Effect type holds its initializer through
  `as`, `satisfies`, `!`, a conditional, and a pipe, as it already did through
  parentheses. The initializer runs each time the const is run, not where the
  const is declared.
- A direct `sync` or `try` of an async function passes the function exactly
  its inputs, and an `AbortSignal` only where its overload passes one. On
  0.0.3 a rest parameter received a stray `undefined` and an optional
  parameter of another type could receive the signal.
- Every package requires Node 26 or later.

### Compiler

- A plain function is called as a plain function from every import shape:
  a default import beside named or namespace imports, CommonJS output, and
  `export default f`.
- `super` and `arguments` work in Effect methods, Effect arrows, and `try`
  blocks. On 0.0.3, `super` in an Effect method emitted a module that failed
  to load.
- A bundle runs only its entry module's `main`, in ES module and CommonJS
  output, and a CommonJS file that exports `main` loads and runs it when Node
  runs the file. The compiler warns
  (EK3205) when an entry module's `main` needs services that nothing
  provides.
- `module` declarations: emitted names never collide with your names, global
  names, or the file's imports; CommonJS output keeps their re-exports; their
  declaration files use the `.vibe` file's imports.
- A schema error family's base schema encodes and decodes its subclasses.
- A non-tail `resume` has a type that covers every value its handler can end
  with.
- `using` awaits `Symbol.asyncDispose` of a value that only async-disposes.
  `sync` and `try` called as values pass an async function its `AbortSignal`.
- The compiler no longer crashes on `service X: typeof X` or on a pipe with a
  missing left operand, and the formatter no longer crashes on a file with a
  `match`.
- Lambdas and pipes keep their meaning in more places: a lambda for an
  optional member takes the member's contract; a factory lambda keeps
  TypeScript's type in a branch of a conditional argument; either arm of a
  returned conditional can make a factory; an annotated lambda can call the
  variable it initializes; a returned pipe that ends in a call returns what
  the call returns; a function literal on a pipe's left side stays a program
  for a curried stage; a pipe in an Effect-typed field keeps its function
  plain for callers.
- A `provide` block keeps `Exclude<R, I>` of a generic requirement, and a
  `for...of` over a Stream inside one no longer crashes the compiler.
- A `restore` block inside an uninterruptible expression is inside it, and a
  comment before a by-name program no longer ends its return early.
- A destructuring property name inside a hatch is not a capture.
- Declaration files: a function expression's written contract is its
  declared type, a `.vibe` file's header comment stays first, and schema
  declarations keep their comments.
- Diagnostics: a contract suggestion for a `never` success writes `never`,
  and a diagnostics comment can give its reason after punctuation.

### Tools and integrations

- The install guides install the current version and say that Windows needs
  WSL. The starter's `AGENTS.md`, `llms.txt`, and the agent skill teach the
  forms the compiler accepts.
- npm packages and the VS Code extension ship complete license and notice
  files.
- Projects: a project compiles sources above its directory; a program without
  a `tsconfig.json` checks each package's `.vibe` files with that package's
  settings; `VIBELANG_PROJECT` compiles the modules in its directory, and a
  workspace dependency's source compiles with its own `tsconfig.json`; a
  check-only project that imports `.ts` files compiles in the loaders; a root
  project compiles a nested package it reaches through `node_modules`.
- `vibelang-unplugin`: esbuild tree-shakes the `.vibe` modules of a package
  without side effects, and each entry's types import only its own bundler's
  types.

### Known limitations

- `using` does not release a value whose acquisition ends in an
  uninterruptible section when an interruption arrives during that section.
- A class method annotated with a plain return type whose body runs an
  Effect keeps its plain type; called through an interface, it returns the
  Effect instead of running it.

## 0.0.3

### Changes that can break code that compiled on 0.0.2

- `error`, `service`, and `control` declarations are classes. Error classes
  accept constructors, methods, and inheritance; each subclass has its own
  name as its tag. An error family's base can declare `_tag: string`;
  an abstract error has that tag type by default.
- `throw` always fails outside a TypeScript hatch or module. Plain functions
  and JavaScript generators cannot let a typed failure escape. Use an Effect
  contract for a function that can fail, or TypeScript for JavaScript throws.

### Language

- `schema error` declares a serializable error class. `schema Name = Type`
  declares a schema and its type; `service Name: Type` declares a service
  whose shape can be any type.
- Inline `module` declarations hold self-contained TypeScript. Import their
  exports by the module's name; diagnostics and editor navigation point into
  the body, and declaration emit writes a separate declaration file.
- Both sides of a catch expression receive its contextual type. An exhaustive
  match omits its final test. More data-first Effect functions support method
  syntax, including functions whose receiver is not named `self`.

### Tools and integrations

- Format `.vibe` with the dprint process plugin and lint it with
  `vibelang/eslint`. A tree-sitter grammar and Neovim support are available.
- TypeScript-style Effect forms warn with editor quick fixes where a
  VibeLang form preserves their meaning. `vibelang --fix` applies the fixes.
- The compiler package ships the VibeLang agent skill.
- Imported foreign-project sources use their own VibeLang settings.
  Declarations use `.js` specifiers for `.vibe` modules, and tools reuse
  successful whole-project compiles through an on-disk cache.
- `bun --preload vibelang/bun` runs and tests source modules.
  The Vite plugin's `register: true` lets child processes import `.vibe`;
  `vibelang-unplugin/deferred` loads the plugin when a bundler awaits it.

## 0.0.2

Nine published packages: `vibelang`, four native compilers
(`vibelang-{darwin,linux}-{arm64,x64}`), `vibelang-runtime`,
`vibelang-vite`, `vibelang-unplugin`, and `create-vibelang`.
`vibelang-unplugin` is new in this release. Native Windows binaries
are not available yet; use WSL and follow the Linux instructions.

### Changes that can break code that compiled on 0.0.1

Each is a compile error that names the problem; none silently changes what
compiled code does.

#### Platform globals through `globalThis` are EK4402

`process.env` was already `EK4402`. `globalThis.process.env`,
`globalThis.fetch`, `globalThis.crypto.subtle`, `globalThis.location`,
`globalThis.navigator`, and the other platform globals now are too when their
host declarations resolve. Without those declarations, TypeScript's usual
missing-member diagnostic remains. This standalone example has no Node types:

```vibe
// expect-error: TS7017
function home() {
  return globalThis.process.env.HOME
}
```

Read configuration with `Config` from Effect:

```vibe
// fragment
function homeDir() {
  return Config.String("HOME")()
}
```

Otherwise, read the global in a TypeScript module the project trusts, such as
`platformEnv.ts`:

```ts
// TypeScript (.ts)
/** @vibelang trusted */
export const processEnv = () => globalThis.process?.env
```

#### A call typed as a union of Effects runs where it stands

A call to a function that returns `Effect<A> | Effect<never, E>` now runs the
program, as `yield* decide(flag)` does in TypeScript. In 0.0.1 it silently held
the program.

```vibe
error Rejected

function decide(flag: boolean): Effect.Effect<number> | Effect.Effect<never, Rejected> {
  return flag ? Effect.succeed(1) : Effect.fail(new Rejected())
}
```

A 0.0.1 workaround that holds the program and then calls it no longer compiles:

```vibe
// expect-error: TS2349
function total(flag: boolean) {
  const held = decide(flag)
  return held() + 1
}
```

Delete the workaround and use the value:

```vibe
// fragment
function total(flag: boolean) {
  const value = decide(flag)
  return value + 1
}
// number!Rejected!
```

A function annotated with a union of Effects whose branches return decided
Exits, such as `cond ? Exit.fail(e) : Exit.void`, runs the chosen Exit.

#### `Request` is the web-standard class

Web-standard globals keep their names, as JavaScript's built-ins do: `Request`,
`Response`, `Headers`, `URL`, `URLSearchParams`, `TextEncoder`, `TextDecoder`,
`AbortController`, `AbortSignal`, `Blob`, `FormData`, `structuredClone`, and
`fetch`. Of Effect's root names only `Request` collides, so `Request.tagged`
without an import is now TS2339 or TS2702. Import Effect's module:

```vibe
import { Request } from "effect"

interface Lookup extends Request.Request<string> {
  _tag: "Lookup"
  id: string
}

const Lookup = Request.tagged<Lookup>("Lookup")
```

#### A `const` with a declared Effect type holds the program

`const p: Effect.Effect<A, E> = make()` keeps the program `make()` returns cold
instead of running it, at any scope. When the call returns a program that
produces a program, as `Effect.cached(...)` does, the annotation must name the
outer program, `Effect.Effect<Effect.Effect<A, E>>`, or the compiler reports
TS2322 or TS2375. To run the call, drop the annotation.

#### A throw expression can't be an operator's left operand (EK1010)

In expression position, `throw cond ? a : b` threw `cond` and discarded the
rest; it is now EK1010. Write `throw (cond ? a : b)`. A statement that starts
with `throw` is unchanged.

#### A curried pipe stage after a call keeps the call

`x |> f(args)(%)` becomes `x.pipe(f(args))` only when `x` calls nothing. When a
call builds the left side, bind it first: `const s = Schema.NullOr(Schema.String)`,
then `s |> f(args)(%)`.

### Fixes

- An Effect subtype returned at an Effect boundary runs. A value the contract's
  written success type accepts is returned as data:
  `keep(command): ChildProcess.Command!never!Scope` returns the command.
- A discarded structured Effect call is diagnosed (EK4301). A program cast and
  piped with `|>` is passed by name.
- Callback cleanup waits for async and Effect finalizers on interrupt. Copied
  declaration types import prelude names.
- A `function*` annotated `Generator<...>` stays a JavaScript generator.
- Function-valued service implementations and contract-annotated arrows keep
  their programs.
- Nested Effect function declarations hoist, so a call above the declaration
  works.
- The checker no longer overflows the stack on a shorthand discriminant property
  under a union context.
- By-name tail programs, conditional by-name arms, and optional program fields
  run as written.
- Diagnostics: inline boundary callbacks, `Effect.fn` span advice, non-adjustable
  EK option policies, and `.d.ts` JSDoc that matches tsc.

### Known issues

- A throwing local arrow with no contract, inside a function with a plain return
  annotation, reports EK2003 on the outer annotation. Annotate the local arrow,
  such as `(value: number): void => { ... }`.
- EK4802 can warn on a local annotated `Effect<Effect<...>>` that returns its
  program unrun. The emitted code is correct.
- Programs that by-name lowering wraps spend extra Effect operations.
- A recursive `Schema.Class` whose `Schema.suspend` callback writes an Effect
  contract, `(): Schema.Codec<Crate, CrateWire>!! => Crate`, reports TS2506 and
  TS2740. Annotate the plain return type instead,
  `(): Schema.Codec<Crate, CrateWire> => Crate`. Both compile to the same
  JavaScript.
