# Release notes

VibeLang is v0, so a new version can change the language in breaking ways.
Before you update, read the notes for every version between yours and the new
one, and update `vibelang`, `vibelang-runtime`, and `vibelang-vite` together.


## 0.0.11 (unreleased)

Update `vibelang`, `vibelang-runtime` and your bundler plugin together to
0.0.11. Use exactly `effect@4.1.0`, the earliest Effect version VibeLang
now supports, with matching `@effect/platform-*` and `@effect/vitest` when
used, and the `@effect/platform-node-shared` override at 4.1.0. Effect's
failure rules from 0.0.10 still apply.

### Upgrade from 0.0.10

This release changes platform access and name resolution in `.vibe`.
D310, D311, D312 and D313 are **provisional, pending the owner's review**.
Run `vibelang -p tsconfig.json --fix`, then check the remaining diagnostics
against [Platform globals](../platform/platform-globals.md).
The fixes keep a rewrite only when it adds no compiler error.

| Before | After and repair |
| --- | --- |
| `effect@4.0.6` and `@effect/*@4.0.6` | Effect 4.1.0 is now the minimum supported version, pinned exactly: install `effect@4.1.0` and `@effect/*@4.1.0`; the runtime refuses any other version. Effect 4.1 removed `effect/Crypto` and `TestCrypto`, so `Crypto` in a `.vibe` file is the DOM's again. Use `effect/crypto`'s services: `SecureRandom.randomBytes(16)`, `SecureRandom.uuidV4()` and `SecureRandom.intBetween(min, max)` for `Crypto.randomBytes`, `Crypto.randomUUIDv4()` and `Crypto.randomIntBetween`; `Digest.digest(Digest.sha256, bytes)` for `Crypto.digest("SHA-256", bytes)`; `Mac` and `Signature` for HMAC and signatures. `NodeServices.layer` and `BunServices.layer` no longer provide a crypto service: provide `NodeCrypto.layer`, `BunCrypto.layer` or `BrowserCrypto.layer`. `Experimental.Crypto` keeps its members, and its platform layers provide Effect's crypto services too. Node.js 22.19.0 is the minimum for `@effect/platform-node`. A test terminal built with `Terminal.make` must now supply `size`, a scoped queue of resizes, such as `size: Queue.unbounded<Terminal.Size, Cause.Done>()`. |
| Commas between `schema` declaration fields | Separate fields with `;` or a new line. `vibelang --fix` replaces commas with semicolons (`EK1013`). |
| `import { Path } from "effect"`; `Path.Path.join("a", "b")` | Every unambiguous Effect module is global; write `Path.join("a", "b")`. Existing imports still work. `--fix` removes redundant imports and shortens the module's same-named export. |
| The type `Option.Option<number>` | Write `Option<number>`; the long form remains valid. A module's own exports still win over its same-named export. |
| A DOM type named `Cache`, `Console`, `FileSystem`, `Scheduler`, `Transferable` or `Worker` | The bare name now means Effect's same-named type. Export an alias such as `export type DomWorker = Worker` from a `.ts` file and import that type. To use the DOM constructor, put `globalThis.Worker` in a hatch or named TypeScript module. |
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
| A method with a plain return annotation whose body runs an Effect, such as `count(): number { sleep("1 millis"); return 42 }` | EK2003, as for a function. It previously compiled, declared `count(): number`, and returned an unrun Effect to callers that reached it through an interface or from TypeScript. Write its contract, `count(): number!!`, or remove the annotation. A method implementing a plain member such as `[Equal.symbol]` keeps EK4301. |
| An `await` binding such as `const await = 1` | Rejected in a VibeLang module; rename the binding. It previously compiled despite the reserved word. JavaScript `await` remains available inside TypeScript escapes. |
| A plain object, default or parameter typed with a service's name, such as `const impl: Users = { … }` or `function f(users: Users)` given `Users()`, or a TypeScript class that `implements Users` | TS2739 or TS2420: a service's name is now its identifier, Effect's `Context.Service` instance type, which carries its key, so another service with the same members or a structural type no longer stands for it. Type the implementation `Users.Shape`: `const impl: Users.Shape = { … }`, `static readonly default: Flags.Shape = { … }`, `function f(users: Users.Shape)`. `Users()` has the type `Users.Shape`, as `yield* Users` has. TypeScript writes `implements Context.Service.Shape<typeof Users>`. |
| A package compiled by 0.0.10 that exports a `service` declaration | Its declaration file declared `interface Users`, a key typed with the runtime's `ServiceKey` and a `namespace Users { interface Shape }`; it now declares what Effect TypeScript does, `declare const Users_base: Context.ServiceClass<Users, "<key>", { … }>` and `class Users extends Users_base`, and a service with only a default `const Flags: Context.Reference<{ … }>`. `.vibe` code doesn't change. Recompile the package; TypeScript that wrote `Users.Shape` writes `Context.Service.Shape<typeof Users>`. A `Context.Service` class migrated to a `service` keeps its key with `static readonly key = "…"`. |
| A `match` without `default` whose arms name classes that are not error classes (classes that don't extend `effect`'s `YieldableError`), `Error`, or a class with its own `[Symbol.hasInstance]` or `[customMatcher]` | EK4701: such an arm no longer proves the match covers its subject, and the diagnostic's note names each arm that did not count. Add a `default` arm, or declare the classes with `error` or `Data.TaggedError`. An error class counts wherever it is declared, a `.ts` file or a declaration file included. |
| A `match` without `default` over a `string` or `number` without a literal type, `unknown`, `any`, `object`, an array, or a type parameter, such as `match (x: string) { when "a": 1; }` | EK4701: such a subject is open, so its arms cannot cover it; the match previously compiled and threw a `TypeError` when no arm matched. Add a `default` arm, a bind-only arm such as `when let other:`, an arm that matches every value such as `when String:`, or narrow the subject's declared type to the literals the match handles. |
| A package compiled by 0.0.10 that exports an `error` declaration | Its declaration file now declares exactly what `class E extends Data.TaggedError("E")<{ … }> {}` declares. `.vibe` code doesn't change. Recompile the package so its `.d.ts` matches. |
| A block after an Effect dual, such as `withSpan("load") { … }`, `timeout("1 second") { … }` or `semaphore.withPermits(1) { … }` | A block is always its call's last argument, so the callee's type no longer moves it. Write the program first, `withSpan(() => { … }, "load")`, or use the curried form, `semaphore.withPermits(1)(() => { … })`. `vibelang --fix` rewrites each site. Where the appended call still type-checks, it is EK1023. |
| `() => fork p()`, or a `fork` in an `if` branch or a bare block | A fiber belongs to its innermost named region: a function body (an arrow's expression body included), one loop iteration, a `try`, `catch` or `finally` block, a block that declares `using`, or a `provide` or mask block. `if` branches, bare blocks, `do` blocks and `match` own nothing. Passing an owned fiber out of its region (returning, storing, assigning outside it, or capturing it) is now the error EK4838. Use `Effect.forkScoped(() => p())` for a child the caller's scope owns, or `detach(() => p())`. |
| The `try` hatch, `try((text) => parse(text), (e) => new Bad({ e }), text)` | EK4616: `try` is an operator that runs an Effect (VIP-5), so `try(…)` is no longer a hatch. Wrap the code with Effect's own `Effect.try` or `Effect.tryPromise` and run it with `try`: `try Effect.try({ try: () => parse(text), catch: (e) => new Bad({ e }) })`. `vibelang --fix` rewrites each hatch, passing its inputs to its function, and refuses one whose inputs run code. A function that is not `async` but returns a promise is no longer awaited: write it `async`, or wrap it with `Effect.tryPromise`. The function `Effect.try` or `Effect.tryPromise` wraps is TypeScript, as a hatch's is: a `throw` there is JavaScript's, for the wrapper to catch, and platform APIs such as `fetch` are allowed there, where they were EK4402 before. `import { try } from "vibelang-runtime"` no longer resolves. |
| A function that is an Effect function because of its body or its return annotation, such as `function load(id: string) { return try getUser(id) }`, a method like it, or a function literal passed where an Effect function is expected, as in `forEach(ids, (id) => getUser(id))` | Mark it `effect` (VIP-1), which goes exactly where TypeScript allows `async` (VIP-39): `effect function load(id: string)`, `effect (id) => try getUser(id)`, or a method `effect find(id)`. A function literal with no parameters that became a program where an Effect was expected, `retry(() => save(x), policy)`, is an effect block (VIP-2): `retry(effect { return try save(x) }, policy)`. `vibelang --fix --fix-vip-only` writes both, with `try` before a value such a function runs, and keeps a function that compiles to plain JavaScript unmarked. The mark changes nothing yet; once it lands, only `effect` makes an Effect function. A declaration without `function`, `effect load(id) { … }` or `async get(url) { … }`, is EK4618; its quick fix writes `effect function load(id)`. |
| `async function load() { … }`, and `await` inside it | No longer EK1003: an `async` function means what it means in TypeScript (VIP-1), and `await` there waits for a promise. Awaiting an Effect there is EK4617: write `await runPromise(program)`. |
| `using h = Effect.acquireRelease(() => openDisposable(), release)` with a plain-holder workaround | The acquisition's release is now the only release, so `using` no longer also calls `[Symbol.dispose]()`. Bind the Disposable directly and drop the holder. |
| A package compiled by 0.0.10 that exports a `schema` declaration | Its declaration file declared the type as `interface User extends Schema.Schema.Type<typeof User> {}`; it now declares what Effect TypeScript does, the constant and then `type User = typeof User.Type`. `.vibe` code doesn't change. Recompile the package so its `.d.ts` matches. A TypeScript consumer can no longer merge declarations into the type, as with Effect's own alias. |
| `using n = count()` where the value has no disposal method and the initializer needs no `Scope` | TS2850. Bind it with `const`, or acquire it with `acquireRelease` so its release is recorded. |
| A call that runs in a getter, a setter, a parameter default, a constructor, a static block or a class field with no type, such as `get next() { return seven() }` or `function later(program = seven())`, which held the program it built | `EK1001`: that code runs as plain JavaScript, so the call cannot run there. Delay it with a function, `() => seven()`, and call that where the program runs, or give a class field an Effect type, `program: number!! = seven()`, which still holds the program. |
| `const spawn = fork`, `const run = sync`, an import that renames `fork`, `join`, `sync`, `try` or `callback`, or `R.fork(x)` through a namespace import of the runtime | EK4410: a call spelled otherwise read its first operand by a binding its reader cannot see, so `spawn(work())` deferred `work()`. Call each under its own name where it runs; to pass forking as a function, write `(job: () => A!E!R) => fork job()`. In a `module` block the runtime's functions stay ordinary values. |
| A pause in a `using` initializer, such as a wait in the function that opens the resource | Cancellation now follows Effect. Every initializer runs with the interruptibility in force where the `using` stands, whether or not it requires `Scope`, so cancellation reaches its waits and `using` registers nothing. A `timeout` around `using db = openDb()` now ends at its deadline instead of waiting for `openDb`. To wait one out, write `using db = Effect.acquireDisposable(() => openDb())`: its acquisition holds cancellation off, and `using` adds no second release. |
| A function without a return annotation that plain code calls or passes, such as `function double(n: number) { return n * 2 }` in `xs.map(double)`, at a module's top level, in a getter, or in a function annotated `: number` | EK4301, EK1001 or EK2003: a function without a return annotation is an Effect function, whatever its body does (a ruling marked controversial). It was plain when its body ran no Effect. Write its return type, `double(n: number): number`, or `: infer _` to keep the type TypeScript infers from the body. The diagnostic's quick fix writes it, `: T` when the type is short and `: infer _` otherwise, on the helper and the unannotated helpers it calls, and `vibelang --fix` writes it on every such helper that is not exported. TypeScript callers now receive the annotated function's plain signature, and an unannotated function's Effect signature. |
| A literal with no declared destination, such as `const half = (n: number) => n / 2` or `const api = { triple(n: number) { return n * 3 } }`, used from plain code or from TypeScript | An Effect function, as a declaration is: write `(n: number): number => n / 2`. A literal where a declared type gives it a form, as `xs.map((x) => x + 1)` does, still takes that form; a method named `toString`, `toJSON`, `valueOf`, `then` or a well-known symbol is plain. |
| A callback parameter written without a contract, `f: (a: A) => B`, that receives a function that runs Effects | It means what TypeScript means, a plain callback, so passing an Effect function is EK4301 and the parameter no longer gains `E` and `R`. Declare the channels the callback may have: `mapAll<A, B, E, R>(items: ReadonlyArray<A>, f: (a: A) => B!E!R)`. |
| A literal at a destination that accepts a value or an Effect, such as `retry`'s `while: (e) => boolean \| Effect<boolean>`, whose body runs an Effect | EK4301: such a literal is plain unless its annotation says otherwise. Write `(e): boolean!! => …`. |
| A literal with an Effect contract where only a plain function fits, such as `Schema.suspend((): Codec<A>!! => A)` | EK4301; it previously compiled as a plain function returning the contract's success value. Write the plain type, `(): Codec<A> => A`. |
| A package compiled from VibeLang whose consumers call its plain functions from Effect code | Its build now writes `vibelang.manifest.json` beside its declarations, listing each declaration file emitted from a `.vibe` file. A consumer trusts each listed module as a package in `trustedPackages`, so a call of its plain function is no longer EK4401. Publish the manifest with the declarations: add it to `files` in `package.json`. Stock TypeScript ignores it. |
| An unannotated function that returns a program it holds or receives, such as `const make = (n: number) => { const p: number!! = () => n; return p }` | EK4802, as an Effect function returning a program. Write `: infer _`: the function is plain, a VibeLang call of it runs the program it returns, and a TypeScript caller receives the program unrun. |
| A function value whose type returns an Effect, passed where only a plain function fits: `xs.map(pick)` with `function pick(p: number!!): infer _ { return p }`, a TypeScript function declared to return an `Effect`, or a call's result such as `try(f, makeMapper(), x)` whose function is an unannotated literal | EK4301: a function value has the form its type gives, so `map` would collect programs it never runs, as it would for an Effect function. To collect the programs as data, write a literal: `xs.map((p): infer _ => p)`. To run them, use `Effect.forEach(xs, pick)`. Give a returned literal a plain return annotation, `(reason: unknown): Bad => new Bad({ reason })`. |
| A function value whose return type may be an Effect, a union such as `number \| Effect<void>`, passed where only a plain function fits, as in `xs.map(both)` with `const both: () => number \| Effect<void> = tick` | EK4301: the receiver would drop the program the function may return. Keep it at a destination that accepts both, or pass the Effect function to an Effect API such as `Effect.forEach`. |
| An Effect function held where a declared type makes it plain: `runAll(fs)` with `fs = [tick, tick]` and `runAll(fs: ReadonlyArray<() => unknown>)`, `const cb: (n: number) => void = logged`, an object such as `{ onSave(doc: string) { … } }` passed as `{ onSave(doc: string): void }`, or `const r: Resettable = new Counter()` whose unannotated `reset()` is an Effect method | EK4301: the caller of the plain type would drop the program unrun. These compiled before; only an Effect function passed by name or in an array written at the call was caught. Annotate the function or method with its plain return type, `(): void`; write `class Counter implements Resettable`, which makes `reset()` plain; or declare the destination to return an Effect, `() => void!!`. |
| A function literal passed where the parameter type is `Function` or a type parameter constrained to a plain function type, as React's `useCallback<T extends Function>` and lodash's `once<T extends (...args: any) => any>` declare | The literal is a plain function, as TypeScript types it, where it was an Effect function: a TypeScript caller of `useCallback`'s result now runs its body, and a body that runs an Effect there, `useCallback((e) => Console.log(e), [])`, is EK4301. Run the Effect elsewhere, or keep it at a destination typed to return an Effect. |
| A TypeScript caller of a `trusted(impl, [Errors])` value, such as `Effect.runSync(rows())`, or a `.vibe` file that passes one to `map` | `trusted` now returns one plain function of `impl`'s type, carrying its classes as `f[$errors]`: a TypeScript call returns what `impl` returns and throws what it throws, so drop the `Effect.runSync`. A VibeLang call still makes a listed exception an expected failure. `lines.map(slugify)` passes a value with an empty list and is EK4301 for one with listed classes; use `Effect.forEach(lines, slugify)` there. |
| `fork job` or `fork(() => work())`, where `job` is an Effect or a function with no required parameters | EK4613: the operand is a program by syntax whose result is its value, so the new fiber would give `job` back unrun; it previously ran it. Write `fork job()` or `fork work()`; `vibelang --fix` writes these. |
| `await.all [a(), b()]`, `await.race`, `await.any` or `await.allSettled`, or `await.all { a: a(), b: b() }` | EK1802 (VIP-18): the await operations are retired. `vibelang --fix` writes `try.all`, `try.race`, `try.any` or `try.allSettled` over explicit Effects, so each element still runs when the operation runs, and an object becomes `try all({ … }, { concurrency: "unbounded" })` with its keys in the order written. `try.allSettled` gives each element's `Exit`; where the old operation gave a `Result`, `--fix` writes `all(…, { concurrency: "unbounded", mode: "result" })`. |
| A `schema` field typed `unknown`, `any`, `never`, `object` or `void`, such as `schema Event { payload: unknown }` | EK2109 (VIP-15): among keyword types only primitives map to a schema. Name the schema instead, `payload: Schema.Unknown`; `--fix` writes it. |
| An abstract class used as a service | EK4854 (VIP-9): write a `service` declaration. `--fix` removes the class spelling and preserves its members and key. Abstract classes now have ordinary TypeScript semantics. |
| `static readonly default = shape` on a service | EK4855 (VIP-9): write `static readonly defaultValue = () => shape`. `--fix` renames the member, wraps its type and value in a thunk, and updates value reads. |
| `A!E` on a function with a body inferred its requirements | EK4853 (VIP-3): every omitted slot is `never`, exactly as in `Effect<A, E, R>`. `--fix` writes the requirements previously inferred from the body. Leave out the annotation to infer the whole contract. |

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
npm install --save-exact vibelang-runtime@0.0.11 effect@4.1.0 @effect/platform-node@4.1.0
npm install --save-dev --save-exact vibelang@0.0.11 vibelang-vite@0.0.11 @effect/vitest@4.1.0
npm run build
npm test
```

With Bun:

```sh
bun add --exact vibelang-runtime@0.0.11 effect@4.1.0 @effect/platform-node@4.1.0
bun add -d --exact vibelang@0.0.11 vibelang-vite@0.0.11 @effect/vitest@4.1.0
bun run build
bun run test
```

Move the existing override in `package.json` to 4.1.0:

```json
{ "overrides": { "@effect/platform-node-shared": "4.1.0" } }
```

Projects using another bundler update `vibelang-unplugin` to 0.0.11
instead of installing the Vite plugin. See the 0.0.10 notes below for the
Effect 4.0.6 defect-precedence and interruption migration.


### Configuration upgrade

| Before | Now |
| --- | --- |
| A required schema field whose referenced codec has optional or uncertain decoded key flags | `EK2109`: run `vibelang --fix` to keep the existing codec as an explicit `Schema.Struct` value. Written optional fields keep their optional behavior. |
| A `Record` value referenced optional decoded keys or a readonly `Record` referenced mutable decoded keys | `EK2109`; `vibelang --fix` preserves the existing codecs, declarations and decoding. Schema-error declarations retain their constructors and matchers. |
| A schema reference with an empty type argument list, such as `schema Name = Address<>` | `EK2109`: run `vibelang --fix` to remove the empty list. The codec, decoded values and declaration types stay the same. |
| `vibelang.diagnostics` | Run `vibelang --fix` to move configurable warning settings to `vibe.severities`. Remove obsolete legacy policy entries before rerunning `--fix`. |

### Diagnostic codes

| Before | Now |
| --- | --- |
| Old diagnostic numbers, including `EK4617` | Appendix B numbering, including `EK0103`. Diagnostic triggers are unchanged. See the [old-to-new map](../vibelang-features/diagnostic-code-map.md). |

### Bugs fixed since 0.0.10

- Fixes for the unpublished 0.0.11 candidate were listed under 0.0.12; they now appear together under 0.0.11, and the release check compares that section with npm's last published version.

- In a `.vibe` file a member of an interface or an object type was readonly to the checker, so `options.minimum = 0` was `TS2540`, while its declaration printed the member writable; such a member is now writable unless written `readonly`, as in TypeScript, and the checker and the declaration agree. The fields of `data`, `schema` and `error` bodies keep their readonly default, and `mutable` is still accepted. The migrate flow's codemod no longer writes `mutable`.

- Editor validation rejected the `async` conversion actions because its smoke check still expected the retired Promise hatch; it now checks the `Effect.tryPromise` bridge and the mapped rejection form.

- With paired `moduleSuffixes` such as `["", ".d.vibe"]`, VibeLang read a stale declaration sidecar instead of its `.vibe` source and reported incorrect types; it now reads the source and keeps ordinary `.ts` and `.tsx` priority.

- ESLint with `vibelang/eslint` reported `no-unused-vars` on a codec that only a `schema` field names, as in `const Names = Schema.Tuple([Schema.String, Schema.String])` and `schema Locale { names: Names }`; the ESLint tree now writes such a field's type as `typeof Names`, the value the schema reads, in `schema` and `schema error` bodies and `schema X = Type`.

- A direct fuzz-suite run could exceed the CLI CPU budget while rebuilding the compiler in a different `-trimpath` mode; its helper now matches the test binary and records setup and seed timings.

- Import-free `.vibe` files could share globals or report false duplicate declarations with `moduleDetection: "legacy"` or `"auto"`; each source file now keeps its own module scope and emitted module markers.

- The release rehearsal stopped at its Vite warning check because it expected a retired nondeterminism diagnostic and used deprecated configuration; it now checks the assigned `EK4833` warning and verifies that Vite emits the bundle with `noEmitOnError`.

- In a project with no `declaration` setting, an export whose inferred type was too long to serialize (`TS7056`) got only a warning, and its declaration sidecar held `any` in place of the type, so a stock `tsc` consumer lost its types without an error; it is an error again, as it is where the project emits declarations.

- Installation guides still said native Windows was unavailable; they now list both Windows packages alongside the macOS and Linux packages, while identifying Linux x64 as the platform used for the npm and Bun starter rehearsal.

- A registry rehearsal could inherit `VIBELANG_BINARY` and runtime test overrides, so it ran the checkout compiler instead of the installed tarball; fresh app checks now clear those overrides before scaffolding.

- The editor action "Convert to a VibeLang function with an error per await" on an `async function` declaration without `export` produced overlapping edits, which editors reject; the inserted error declaration now comes before the edit that removes `async`.

- Under Bun, `vibelang/bun` loaded a `.vibe` module only through a relative import, so an import through a tsconfig `paths` alias, such as `@/x` with `"@/*": ["./src/*"]`, failed with `Cannot find module '@/x'` once `x.ts` became `x.vibe`; the preload now resolves the alias to the `.vibe` module TypeScript resolves it to.

- Compiler fuzz checks sometimes failed on a faster host after long literal `match` checks had been fixed, because a pending test still expected them to hang; they now run as active regressions, with string and numeric arm-order mutations and a separate 3,000-arm stress test.

- An `error` declaration with no fields, such as `error Timeout`, declared `extends Timeout_base<{}>`, where `class Timeout extends Data.TaggedError("Timeout") {}` declares `extends Timeout_base`, so `--fix` changed the declarations of every fieldless `Data.TaggedError` class it rewrote. It now declares `extends Timeout_base`, as the TypeScript does.

- An `error` declaration with no fields, such as `error Timeout`, declared `extends Timeout_base<{}>`, where `class Timeout extends Data.TaggedError("Timeout") {}` declares `extends Timeout_base`, so `--fix` changed the declarations of every fieldless `Data.TaggedError` class it rewrote. It now declares `extends Timeout_base`, as the TypeScript does.

- The specification’s appendices cited eleven rules by their numbers in a private decision log. They now cite the VIP amendments that record them (VIP-3, VIP-4, VIP-5, VIP-7, VIP-12, VIP-34 and VIP-38).

- The migrate flow's declaration identity check failed a module whose declaration lost only redundant type parentheses, such as `() => (<A>(value: A) => A)` after `vibelang-format`; it now ignores redundant parentheses and still fails a change of precedence, such as `(A | B)[]` to `A | B[]`.

- The migrate flow's `upgrade-effect` moved `vibelang` to the new release but kept the `patchedDependencies` entry for its old version, which pnpm refuses as unused (`ERR_PNPM_UNUSED_PATCH`), and left `vibelang-unplugin` on the old release, so Smithers' upgrade could not install; it now drops a patch the new release already contains, moves one that still applies, stops with the patch's name on one that does neither, and moves `vibelang-unplugin` with the other packages.

- The migrate flow's `verify` rejected a `Schema.TaggedError` class that `EK4837` says has no quick fix, such as one with an annotations argument like `{ httpApiStatus: 400 }`, although no schema error declaration can keep it, so such a file could never pass; `verify` now accepts it, and the warning stays.

- In a project without the `@effect/language-service` plugin, any `vibe.severities` entry turned on every Effect lint, so setting only the VibeLang warning `"EK4842": "off"` reported `EK3801` and hundreds of other lint diagnostics in existing `.ts` files; only an entry for an imported `EK38xx` code turns them on now.

- The migrate flow left Oxlint linting the declaration sidecars, `x.d.vibe.ts`, which it reads as TypeScript, so a repository's lint failed on generated text; setup now adds `**/*.d.vibe.ts` to the Oxlint configuration's `ignorePatterns`.

- The release publisher ignored an explicit `--otp` password and prompted again; it now forwards that password to npm, accepts it with `--dry-run` in either order, and rejects unknown options before doing any work.

- The configuration specification incorrectly based every inherited path on the declaring config. It now distinguishes ordinary relative paths from `${configDir}`, which uses the selected project config’s directory, matching TypeScript.

- `vibelang/bun` scanned every module of every dependency and resolved each of their imports a second time, so a large package's tests ran about three times slower and timed out with no `.vibe` module loaded; it now stops at `node_modules`, and a 294-module import graph costs about the same with the preload as without it.

- `vibelang --fix` deleted `import * as Schema from "effect/Schema"` when a `Schema.TaggedError` class was its only use, and rewrote a class whose module has another name, so the declaration file changed; in a project that emits declarations it now keeps the import and leaves such a class.

- `e catch h` did not run `e` when `e` was an Effect value, a yieldable error or an `effect` block, so `effect { … } catch () => "Untitled"` gave back an unrun Effect, with only a false `EK9204` warning; the catch now runs it, as the language reference says.

- The specification gave no diagnostic code for two members of a `service`, `error`, `schema` or `data` body written on one line with no separator, and the compiler printed TypeScript class or interface messages for it; the specification now assigns `EK0908`, `EK1306`, `EK1504` and `EK1605`, each with a quick fix that inserts `;`.

- Appendix D told contributors that a "Stale compiler-gap marker" result meant the compiler implemented a specification example, but the snippet checker compares only the codes in a block's `// expect-error:` header, so a block promising `EK0106` in a comment reported stale while the compiler printed nothing. The procedure now has you list those codes in the header and rerun before deleting the marker.

- The specification told the formatter to wrap long `provide` lists in `Layer.mergeAll(…)`, a semantic rewrite it never performs. It now says a long list stays on one line.

- Ordinary formatter styling could be rejected for changing emitted token spellings; preservation checks now compare parsed meaning and declarations while retaining diagnostic, directive and source-map checks.

- The specification’s Functions chapter cited thirteen rules by their numbers in a private decision log. It now cites the VIP amendments that record them (VIP-1, VIP-3, VIP-4, VIP-5, VIP-27, VIP-28 and VIP-33).

- The specification’s introduction cited three rules by their numbers in a private decision log, which a reader of the repository cannot look up. It now cites the VIP-7 and VIP-38 amendments that record them.

- The specification’s grammar used `Name` and `ReturnType` in its `effect` function productions without defining them, so it did not say whether `fork` or `join` could name an `effect` function expression. It now makes `const f = effect function join() { }` `EK1702`, as an `async` function expression named `await` is a syntax error, and keeps a declaration such as `export effect function fork() { }` in plain code valid.

- `vibelang/bun` scanned every module of every dependency and resolved each of their imports a second time, so a large package's tests ran about three times slower and timed out with no `.vibe` module loaded; it now stops at `node_modules`, and a 294-module import graph costs about the same with the preload as without it.

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

- Docs checks could use an older compiler from `PATH` after a fresh native checkout build. They now prefer that build, and the snippets target builds and tracks it before checking.

- The migrate flow stopped with "vibelang emitted no declarations" on a package whose tsconfig is solution-style, `"files": []` with `references`; it now checks, fixes and declares each referenced project.

- In a project that emits declarations, `--fix` deleted an `import type` or `{ type X }` import of an Effect module that an export names, so the declaration imported it as a value where TypeScript keeps the modifier; `--fix` now keeps such an import.

- The `match` documentation could reject an already covered shared tag by using TypeScript's whole-object narrowing as its test; it now counts each member's recognized tag cases, including plain objects matched by an error tag. The optional `_tag` example now identifies the absent case that remains uncovered.

- The public schema-error decision called every encoded value JSON; it now distinguishes codec encoding from serialization and shows how a string codec makes bigint transport possible.

- The region-body example wrapped one bound provider in an array despite the single-provider rule. Its counterpart now passes that layer directly.

- Constructor docs promised that typed payloads could not throw. They now distinguish the static `never` contract from native getter, `Proxy` and property-copy failures, which remain defects in effect code.

- The spec's generic-contract example bridged its call with the one-argument `Effect.try`, which fails with `UnknownError`, while its TypeScript counterpart failed with the thrown value. Both now use the `try`/`catch` form, and the constrained generic call has its VibeLang source.

- The docs check read a number followed by a colon in a comment or reason of the compiler's pending-diagnostic list as a code, so a comment such as `VIP-7: …` failed it with a phantom `EK0007`; it now reads only the list's keys.

- An invalid child severity could restore a base config's error setting; it now reports the config error and uses the diagnostic's normal fallback while keeping other valid settings.

- The severity reference left invalid-entry recovery unclear; it now explains independent recovery after inheritance and that invalid child entries do not restore overwritten base settings.

- Specification checks could mistake native `-Infinity` examples for CLI flags; they now read explicit compiler commands and exclude program examples.

- Distinct non-finite cause interruptor IDs could compare equal in differential checks; comparison now preserves their native identity, including repeated IDs and signed zero.

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

- A provider-comma line break could lose its documented keyword classification; recoverable heads now retain `provide` and `EK1202` on either side of the separator.

- Running the migrate flow's setup again left the earlier setup's `.vibelang-toolchain` tarballs on disk, where `jj` committed them with the new setup; setup now removes that directory before it returns to the Effect upgrade.

- In the specification's region-body rules, a paragraph about `do` checks sat between the sentence ending "how it transports completions is its choice:" and the list it introduces, so it read as that list. The paragraph now follows the list.

- `vibelang --fix --fix-vip-only` removed the `try` of a plain call that gives a yieldable error, `return try toError(id)`, so the error became the program's success value, and `--fix` did the same to `yield* toError(id)`; both now write `throw toError(id)`, keep `try` where no statement can throw, and write `try x.asEffect()` for an `Effect.Yieldable`.

- The migrate flow's setup edited a vendored repository that no workspace names (foldkit's `repos/effect`): its `package.json` scripts, `dprint.json` and tsconfig files; setup now wires only the root and the workspace's own packages, as the Effect upgrade does.

- An explicit empty service key, `static readonly key = ""`, was replaced with a derived name; `""` now keeps its identity at runtime, in declarations and in duplicate-key checks.

- The concurrent-loop ownership example passed a string to `sync`, which requires a thunk. Both calls now use valid thunks, with a matching Effect counterpart.

- A docs check could confuse separate examples that reused a class name. It now checks the intended schema decoder example explicitly.

- Computed field names appeared interchangeable between `error` and `schema error`. The specification now uses each native counterpart's key checks and retains TypeScript's `TS1170` for rejected payload key forms.
- The specification described plain error payload keys as runtime reads, incorrectly implying a later key binding would fail. Plain payload keys are now explicitly erased type members; schema keys and method names keep their runtime evaluation.

- A `.vibe` file with no Effect form still declared an inferred `Effect.Effect<A, E>` and imported `Effect`, as `Runtime.makeRunMain` did, where TypeScript writes `import("effect/Effect").Effect<A, E>`; the name now appears only in a file that writes it or has an Effect function, `A!E!R`, `try` or a bare Effect global.

- Effect lint instructions named only `.vibe` files; they now explicitly cover selected `.ts` and `.vibe` inputs with the upstream rule eligibility and file exclusions.

- Malformed cause tags could crash differential comparisons; they now report an encoding error, including in nested runtime values.

- The migrate flow judged a test runner without Vitest's JSON report by its exit status, so a baseline with failing tests stopped `upgrade-effect`; `--test-report <pattern>` now reads each test's printed line, and the run compares test by test.

- The specification left diagnostic coverage unclear for concurrent operations other than `try.all`. It now states the same context and operand checks for all four operations, with the existing error codes.

- The specification left the ending check for `do` undefined for empty switches and VibeLang loops. It now uses an explicit empty-switch base case and the native iteration checks, preserving nonfinal values and rejecting final loops.

- Service default initializers had an unspecified Effect boundary; they now follow source class-field rules, with Effect-based factories computed before the declaration.

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

- Service reads such as `try Users` were rejected as non-Effects, and the LSP service fixture still used a retired `abstract class`; service keys now pass the Effect operand check, and the migrated fixture retains its expected `string` hover and member completions.

- Rejected pattern syntax such as primitive template interpolation had no assigned fallback code; the reference now uses `EK0707` while preserving specific pattern diagnostics and independent TypeScript errors.

- The migrate flow ran `vibelang --fix` over a whole package for each batch, which rewrote files earlier batches had committed and undid their hand repairs; each batch now keeps the rewrites of its own files only.

- The migrate flow's rules told the repair agent that a function with no Effect operation stays plain, while the toolchain compiles an unannotated function or method to an Effect; the rules now say to write its return type or `: infer _`, and list the skill's forms the toolchain does not implement yet with what to write until each lands.

- The migrate flow judged a test command without per-test results by one exit status, so a flaky test stopped `upgrade-effect` with "the target's tests do not run" or read as a batch's regression; such a command now runs once more after a nonzero exit, and the second run counts.

- The skill said plain functions mean exactly what they mean in TypeScript, but a plain `catch` receives only tracked failures, so `try { new URL(x) } catch { … }` rethrew with only a warning; the skill now says so, and the migrate flow rejects a batch with `EK9204`.

- A `.vibe` file in a project without `vibelang-runtime` or `effect` installed reported only `Cannot find namespace 'Effect'` or `Cannot find name 'TaggedError'`, and its exports declared `any`; each such error now names the package that supplies the name and says to install it.

- Running the fork startup checks alongside individual compiler cases could delete their output; concurrent checks now use separate case copies.

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

- Editor regressions could pass repository validation unnoticed; the merge gate and post-merge compiler checks now run the language-server smoke suite and name each failing check.

- Nested interruption examples left the target of `restore` implicit. It now explicitly restores the nearest mask's entry state, including an already uninterruptible state, with a pending-interruption example.

- The migrate flow read a compiler crash as a clean run, recording no errors and no fixes; `compile`, `codemod` and the declaration step now stop and show the crash.

- The migrate flow left a `.d.ts` beside each source file outside a project's `rootDir`, and the batch's commit picked them up; the declaration step now removes what the compiler wrote outside its output directory.

- Generating documentation could hang in the kernel suite's intentional stack-overflow probe; the probe now exhausts a fixed logical stack budget while leaving space for error recovery.

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

- Repository validation could fail documentation-runner and site contrast tests on a busy host because healthy work hit a short deadline; a block now gets a minute, the contrast check ten, and only blocks that hang on purpose keep a short deadline.

- Running `scripts/ci.sh` could modify a shared dependency install and fail another checkout's build; it now leaves every `node_modules` symlink intact and uses that install without writing through it.

- The migrate flow failed a batch's declaration identity whenever a renamed module's importer had written `./leaf.ts`, because the importer's declaration now says `./leaf.js`, so every such module had to stay TypeScript; the gate now treats a relative `./leaf.ts` and `./leaf.js` as one module, since TypeScript resolves both to `leaf.d.ts`.

- The migrate flow's Effect upgrade rewrote every tracked `package.json`, including vendored repositories and fixtures pinned to an old Effect on purpose; it now moves only the root and the workspace members the package manager installs.

- The migrate flow's `upgrade-effect` step stopped with `Refusing to move bookmark backwards or sideways` after committing when `--base` named a commit behind an earlier run's bookmark; `--base` now restarts the bookmark there.

- Installing `vibelang` with pnpm 11 or later exited with `ERR_PNPM_IGNORED_BUILDS` for `dprint`, and the migrate flow's setup stopped there; the setup guide now shows the `allowBuilds` entry, and the flow adds it.

- The migrate flow staged every build of one VibeLang version under the same tarball name, so a target's npm, Bun or pnpm install could keep parts of the earlier build and a rebuilt toolchain's `vibelang-format` command was missing; setup now names each staged tarball for its content.

- Arrow-body and heartbeat checks, and fiber cleanup examples, could end their owner before a child started; they now await a child signal before observing cleanup or shutting down.

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

- Spec-derived checks could confuse distinct imported lint codes by truncating longer numbers; they now keep each full diagnostic number.


- Repository validation could fail the site contrast check on a connection reset by its local server; the check now reads the built site directly.

- A `match` or `if`/`else` chain with thousands of arms over a large union took about a minute and a half to check; repeated narrowing now reuses its results, so a 2000-arm `match` checks in about 10 seconds.

- The specification checked throwing calls in plain handlers' bodies but skipped eager parameter initialization. The same check now covers defaults, destructuring and computed binding keys, while implicit exceptions and uncalled functions keep their existing behavior.

- The documented debugging recipe check could time out after five seconds on a busy build host; it now allows thirty seconds to compile and run while checking the same failure and original source location.
- Formatting a `catch` expression with a comment before its handler was refused; those comments and their line breaks now stay in place.
- The specification lost loop-head binding scopes and allowed forbidden returns to hide in binding defaults. Both loop forms now retain JavaScript's operand scopes and apply their outward-jump restrictions to head initialization as well as the body.

- The specification could lose a synchronous throw when a generic result became an Effect or a callback default disappeared from a declaration. Existing generic contracts and conservative default-callback bounds now survive both boundaries.

- A required schema field could silently become optional through a referenced codec; conflicting or uncertain decoded optionality now reports `EK2109`, with a preserving `--fix` expansion to explicit codecs.

- The platform decision gave banned `globalThis` members the wrong diagnostic and omitted the allowed `Function` checks; it now agrees with the language reference and the accepted `Function` exemptions.

- The interruption and named-region runtime checks could miss child cleanup on busy hosts; they now wait for child readiness, with a late-start test mode that exposes startup races.

- Closing a bundler build or watcher during compilation could leave the compiler and its output pipes running. The `vibelang-vite` and `vibelang-unplugin` integrations now await teardown and stop a compiler that exceeds a one-second grace period.

- The specification’s priority statement relied on an unspecified decision layer. It now points readers to accepted VIPs, their public amendments and cited counterparts, with the same publication rule in the VIP index.

- Region completion examples exposed compiler control records or normal block values to layer finalizers. Finalizers now see the original generator payload while source values and jumps remain intact.

- The specification widened every `do` literal and dropped values crossing transparent blocks. It now keeps ordinary expression typing and complete source completion values, including empty completions and values carried by jumps.

- Forbidden Effect modifier positions lacked a specified diagnostic, and error members could lose a second modifier diagnostic. The specification now assigns `EK0108` and preserves applicable `EK0104` and `EK0105` without an extra member-category error.

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

- Differential `Exit` checks could hide changed user fields or reject them as runtime tags; field names now stay data and prototype-related keys are retained.

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

- Schema hover checks in the LSP smoke test incorrectly required an `interface` label; they now verify the decoded `type` alias and field types.

- Config migration could put severity settings inside a JSONC comment containing `{`; it now keeps the settings active and the comment intact.

- The specification left import-free `.vibe` files with conflicting scope rules. It now requires module scope before checking, preserves it in JavaScript and declarations, and states the `moduleDetection` exception and ordinary host behavior.

- The specification incorrectly required `for concurrent` on one line. A newline after `for` is now allowed, matching native `for await` and leaving the loop behavior unchanged.

- The specification could misread `effect is …` and `async is …` as invalid function shorthand. Both now retain their pattern-test reading, alongside the existing `as` and `satisfies` expression exclusions.

- The introduction hid contextual keyword parsing behind its promise about plain TypeScript code. It now states that those rules also apply in plain code and links to their declaration and expression boundaries.

- Project warning severities under `vibe.severities` were ignored; they now apply with config validation and inheritance, and `vibelang --fix` migrates legacy `vibelang.diagnostics` settings.
- Severity overrides for `EK0508`, `EK0703` and `EK0801` lost their leading zero during lookup; all four severity values now apply to these warnings.
- Diagnostic codes used the old numbering and dropped leading zeros; matching checks now use Appendix B codes, and terminal output keeps all four digits. See the [diagnostic code map](../vibelang-features/diagnostic-code-map.md).
- The AST layout regression test failed because it expected a 32-byte node header; it now checks the 40-byte header that 64-bit node flags give.
- Editor parsing rejected `for try` `Stream` loops; the tree-sitter grammar now recognizes the loop and its `continue` and `break` statements.

- An identifier or call followed by a separate block on the next line was rejected with `EK1022`. Standalone blocks now compile normally, including after identifiers named `uninterruptible`, `interruptible` and `restore`.



- EK4802's quick fix "Call it to run it" was offered in a function whose written contract rejects what the call runs, such as `return Exit.fail("data")` in an `unknown!!` function, and applying it added EK2001. It is now offered only where the contract accepts the call's failure, requirements and success.

- `vibelang --fix` could write a fix that added a type error when the file also had an unrelated syntax error, because its check of the fixed program then saw only syntax errors. It now checks every error, so such a fix is listed as not fixed.

- Bun, `vibelang/register`, Vite and unplugin could report `Cannot find module` for extensionless or directory imports after their TypeScript targets became `.vibe` files. They now resolve those imports with TypeScript's file priority and `index.vibe` fallback, preserving existing source files.











- The diagnostic reference omitted compatibility checks and the three existing requirement/service migration warnings. It now lists all eight interim `EK92xx` checks with their meanings and retirement owners, plus the migration warnings and their defaults.

- A producer could silently discard a returned value. It now reports `EK2128`: a Stream has no return value. `vibelang --fix` keeps the value's evaluation and ends the stream with a bare `return`.

- The specification admitted generic parameters and return annotations on a bare effect-arrow parameter. Arrow heads now follow TypeScript: those decorations require parentheses, while `effect x => x` remains valid.

- The specification excluded valid effect-function overload signatures, decorated class methods and ordinary error-method overloads. Their grammar now follows the corresponding TypeScript declaration positions and checks.

- The specification inherited pipe-draft errors that rejected valid topic use or left chains and precedence undefined. Its effective grammar and operations now preserve sequential chains, nested topic scopes and ordinary TypeScript operators.

- The specification could lose a synchronous throw behind an effectful overload or an escaped rethrowing callback. It now checks every exposed overload bound and preserves the callback contract on returned and nested callables.

- The specification omitted the surviving TypeScript-form advisory codes and their safe repairs. The reference now lists them as configurable warnings and excludes advice for retired language features.

- The specification introduction described every Effect TypeScript comparison as an unchecked fragment. It now distinguishes partial examples from complete comparisons that can be checked directly.



- The specification did not prevent generated temporaries from changing anonymous function and class names. It now preserves source naming context, including names observed by class static initializers.

- The proposals comparison still listed handlers as shipped, and upstream drafts linked retired local research sources; handlers now remain explicitly open under VIP-35, archived chapters state that the first release has no handlers, and historical evidence links to its source revision.

- The LSP smoke test failed when a contract quick fix omitted unused requirements. It now checks the canonical `A!E` title and edit.

- The editor smoke test rejected its random-service fixture; `nextIntUnsafe` and `nextDoubleUnsafe` now return `number`, as Effect `4.1.0` requires.

- The LSP smoke test treated an ordinary `async` function as invalid. It now checks that the function is accepted and its hover shows a `Promise`.

- Benchmark projects could miss packages when the experiments and docs installs shared an npm scope. Staging now merges each scope's packages while keeping the first package found and the runtime's `effect` copy.

- The LSP benchmark could leave its language server running when a protocol request failed. It now terminates the server before reporting the error.

- Enabling `strictEffectProvide` silently skipped functions named `main`; it now reports those sites too, matching Effect TypeScript, so entry points can suppress the warning explicitly (VIP-26, VIP-38).
- A failed `scripts/remote.sh` sync could leave a temporary tracked-files list behind. The list is now removed on success and failure.

- The docs snippet test could fail when its checkout path contained `fail`; it now checks the structured report instead of matching path text.

- The native compiler regression suite could exhaust its budget on a busy build host while cases were still completing. It now allows 45 minutes of testing and 70 minutes for the target, including queued builds.

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


- The release notes mixed development bookkeeping with user changes and repeated some fixes; the current list now contains each user-facing fix once and keeps the final stream-loop rule.



- `await.all`, `await.race`, `await.any` and `await.allSettled` still compiled beside VIP-18's `try` operations, with their own element rules and runtime helpers; they are now `EK1802`, and `vibelang --fix` rewrites them to `try.all` and its siblings with the same behavior.

- `sh scripts/bench/compiler.sh` could miss the compiler after a normal build; it now prefers the native build output while preserving `VIBELANG` overrides and legacy builds.

- `vibelang --fix` could refuse an `Effect.gen` rewrite because a yielded SQL query became unexecuted data. It now calls structured Effect results returned by `.vibe` helpers, preserving their execution.

- Hover-cache tests could skip a working compiler after a normal build; they now discover native and legacy build outputs and honor `VIBELANG_BINARY`.

- With `noUnusedLocals`, `vibelang --fix` could refuse a valid rewrite because it made an import from `effect` unused. It now removes those imports as part of the safety check.


- The specification's `try.allSettled` counterpart, `Effect.all([a, b].map(Effect.exit))`, was a TypeScript error when the operands had different types, and lost the tuple when it compiled. An array literal now maps to `Effect.all([Effect.exit(a), Effect.exit(b)])`, typed as a tuple of `Exit`s, as `Promise.allSettled` keeps one.

- The specification lowered a destructuring default that contained `try`, `await` or a returning `do` into an arrow, so `const { x = do { return 9 } } = {}` returned from the arrow instead of the function. Such a default now runs in the enclosing function, keeping evaluation order, TDZ, `var` scoping and iterator closing.

- Rehearsing a release with the Windows compiler packages failed with an HTTP `403`; the throwaway registry now accepts both `@vibelang/cli-win32-x64` and `@vibelang/cli-win32-arm64`.

- The optional Windows smoke test failed with an unhelpful module error in paths containing `#`; it now explains Vitest's limitation and how to run the compiler checks and the `--vitest` checks separately.

- Documentation hover requests keep their results and error codes after an internal cleanup; stdio protocol tests now cover split responses and server settings requests.

- Documentation checks keep rejecting private temporary paths in both scanning modes; the shared rule now has an explicit name instead of depending on its table position.

- Cheat-sheet token measurement kept unused bookkeeping for excluded long-form alternatives; it now tracks only the blocks used in published totals, with identical counts.

- The repository hygiene scan rebuilt its fixed scratch-path rules for every file; those rules are now shared across the scan, preserving the same diagnostics.

- The fuzz suite did not check that `async` and generator `catch` handlers are rejected with `EK0509`; it does now.
- The fuzz suite did not check jumps in a `for try` head; new checks cover `return`, `break` and `continue` in head defaults and computed keys, and `return` in the operand.
- The fuzz suite could miss changes to call receivers and producer bindings; new probes observe callee snapshots, getter and setter evaluation, `readonly` operands and captured producer receivers.
- The fuzz suite could miss regressions in running Effects; new checks cover handler syntax, suspended fallbacks, `effect` boundaries, concurrent operations, producer buffering and interruption block completions.
- Effect tagged-error patterns rejected branded copies and namespace aliases; they now use the resolved module's guard, including in extractor patterns.
- The VIP migration left by-name arguments such as `Effect.retry(load() + 1, …)`, function values at program positions and `fork` callbacks implicit, so marking their functions could run the work at the wrong time. `vibelang --fix --fix-vip-only` now writes `effect { … }` blocks for by-name arguments, captures function values with `Effect.suspend` or `Effect.sync`, and writes `fork effect { … }`.

- The VIP migration left function literals in collections passed to `Effect.all` and racing combinators, so marking functions could leave their work unrun. `vibelang --fix --fix-vip-only` now writes explicit Effects at those program positions and keeps callback arguments as functions.

- The docs content check left its temporary snippet reports on disk after every run; it now removes them after valid, malformed and missing reports, keeping the same diagnostics.

- Property-test replay mixed loading saved cases with executing them; loading is now separate, preserving replay order, property selection and known-failure checks.

- A tool that reads a `.vibe` file through the TypeScript mapper, such as Oxlint through the Oxc fork's VibeLang hook, reported `TS1338: 'infer' declarations are only permitted in the 'extends' clause of a conditional type` at each `: infer _` return annotation, because the mapper kept it in the TypeScript it returns. The mapper now drops the annotation, and TypeScript infers the return type from the body, as `infer _` means.

- The deployed-release check mixed fetching pages with checking their release claims; page validation is now separate, preserving the same version and platform diagnostics.

- A failed register benchmark left its temporary workspace on disk; it now removes that workspace on setup or compiler failure while preserving an explicit `--out` directory for inspection.

- Knip export collection duplicated rest-binding handling between object and array patterns; both now use one traversal, preserving nested defaults, omitted elements and exported names.

- Published Markdown now has explicit checks for links around quoted, nested and unclosed code fences, keeping code intact while rewriting prose links.

- Built-site validation now has explicit checks for repeated broken links and embedded images, preserving its diagnostics while simplifying page reading.

- Example validation carried an unused known-broken list; `scripts/check-examples.sh` now uses the same failure result for every example.

- Ordinary classes with computed static readonly fields, such as `static readonly [kind] = "name"`, could crash `vibelang` or `--fix`. They now check normally, and their computed members stay unchanged.

- Documentation hover generation could leave temporary projects behind when the language server failed to start; it now removes them on startup failure as well as after a refresh.

- A payload field named `constructor` in `error` or `schema error` failed to parse as though it were a constructor method. Typed fields with that name now compile and retain their payload values.

- Packaging a `dprint` plugin could leave a temporary archive behind when replacing the archive failed; it now removes that temporary file on every return path.

- The `alchemy-stack` example failed on `effect@4.1.0`: importing `@alchemy.run/cloudflare` failed with `Cannot find module .../effect/dist/Crypto.js`, because `alchemy@2.0.0-beta.84` imports the removed `effect/Crypto`. The example now patches `alchemy` with Alchemy's own Effect 4.1 port on install, and the Alchemy page shows how to apply the patch.

- Global throw annotations could not be inspected as data; a generated snapshot now lists their overloads, shipped own-throw contracts and exact declaration inputs, and checks when they become stale.

- Host messaging references such as `postMessage` and `globalThis.postMessage` could bypass the platform check; they now report `EK4402`, while local bindings keep working.

- Projects configured only with `vibe.config.json` could lose editor settings, and imported packages could miss `vibe.config.json` or `jsconfig.json`. Editors and package settings now use the nearest config in the documented precedence order and refresh when a canonical config is created.

- Throwing a `Cause` object was rejected; it now fails with that exact object in Effect code and throws it normally in plain JavaScript code.

- The specification and producer guide made a labeled `break` or `continue` naming the `for try` itself `EK2003`, unlike JavaScript and `for concurrent`. It now means the loop's own unlabeled jump; only labels on enclosing statements are `EK2003`.

- The specification promised that `match` class arms on ordinary classes would emulate the TC39 draft's construction-identity test, which compiled JavaScript cannot do for classes from `.ts` or `.js` files. A class without its own `Symbol.customMatcher` now matches by `instanceof`.

- Typed ESLint programs required `tsconfig.json` even when a project used `vibe.config.json` or `jsconfig.json`; `typedProgram()` now discovers the nearest project in the same order as the compiler and still honors an explicit `project`.

- `vibelang --fix` left some arrows with Effect return annotations unmarked, so they lost their Effect behavior when only the `effect` keyword decided their form. It now marks these arrows `effect`, including arrows whose bodies qualify for direct-call optimization.

- Concurrent arrays could not use the documented concurrency spellings; they now run with `try.all`, `try.race`, `try.any` and `try.allSettled`; settled outcomes include defects and interruption as `Exit` values.


- Formatting a concurrent loop whose limit used `try` could fail with an overlapping-edits error; the formatter now preserves the complete loop head.
- After an Effect upgrade, CI reused an older `node_modules` tree and failed to build the runtime; CI now refreshes installs that disagree with a package's exact Effect pin.
- Building from source could fail the runtime test of a 100,000-element delegated producer on a busy host after five seconds, while it was still delivering elements; it now allows 30 seconds.


- The module and resource VIP references still named `effect@4.0.6`; they now describe the accepted `effect@4.1.0` pin, with its 149 root exports and scope functions checked.




- On the docs site, a specification link whose text held code with brackets, such as ``the `[Effect]` parameter``, kept its `.md` path, so the site build failed on a dead link; it now links to the section on the site.

- Effect functions and program literals had no explicit spelling for migration; `vibelang --fix --fix-vip-only` now writes `effect` functions and `effect { }` blocks while preserving their behavior.


- Repository validation could reuse a passing Go test result after its specification changed; tests that read repository files now run again when their declared inputs change.

- `Date` patterns accepted objects with only `Date.prototype`; they now require a real date, including valid date subclasses and invalid dates.

- A `schema` or `schema error` declaration could throw `ReferenceError: Schema is not defined` when an explicit `Schema` import was used only by the declaration. Generated schema references now retain a runtime import.

- The TypeScript mapper still read the built-in failure list that VIP-4 replaced, so it knew only `JSON.parse` and `decodeURI` and its contract test failed; it now takes every single-class annotation from VIP-4's table, such as `Intl.getCanonicalLocales` throwing `RangeError` and `atob` throwing `DOMException`.

- The `examples/pipeline` README and output fixture expected a producer that never reads ahead, so the example check failed; both now show the VIP-21 order, where `Stream.take` closes the producer before the loop logs the second alert.

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
- After the migrate flow (`.smithers/flows/migrate`), a project that checks the migrated sources with stock `tsc`, `tsrs`, `bun check` scripts that invoke TypeScript, or TypeDoc failed with `TS2307` on every import of a migrated module. Setup now turns on `declarationSidecars` in each migrated package and `allowArbitraryExtensions` in every tsconfig, and the codemod names a migrated module `./x.vibe` from `.ts` files, so those checkers read its sidecar.
- Stock `tsc`, `tsrs`, `bun check` scripts that invoke TypeScript, and TypeDoc failed with `TS2307: Cannot find module './x.vibe'` in a project that imports a `.vibe` module, or skipped it. With the `vibelang` setting `declarationSidecars`, the compiler now writes `x.d.vibe.ts` beside each `.vibe` module, which those tools read under `allowArbitraryExtensions` ([Let TypeScript tools read .vibe modules](vibelang-cli.md#let-typescript-tools-read-vibe-modules)).
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


- Neovim's editor smoke test rejected an intentionally malformed LSP fixture; it now checks that fixture's expected parse error and keeps checking valid fixtures for clean syntax.

- Tree-sitter highlighting could misread `catch`, `??`, statement starts, `!T`, empty type parameters and bare `await`; these forms now parse as the compiler parses them.

- The starter now starts after a Yarn Classic install without needing Redis.

- The starter's tests could not find Vite after a Yarn Classic install. The starter now installs Vite explicitly.

- Importing both `vibelang-runtime` and `vibelang-runtime/kernel` in Bun no longer fails at startup, in either import order.

- A `var` declaration inside a `do` expression previously compiled with the wrong scope; it now reports `EK1019` and offers `let` instead. Jumps that leave a `do` expression now report `EK1019`.

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

#### Compiler and diagnostics

- The compiler crashed on a service declaration with a static member whose name is computed, such as `static [Symbol.iterator] = 1`, while looking for the service's `key`. It now treats only a member named `key` as the key.

- A call of a union of a plain function and an Effect function, such as `(flag ? double : Math.abs)(3)` with `double` unannotated, compiled and gave the Effect function's program back unrun when it was chosen. It is now EK4301; annotate `double` or call each function where it is chosen.
- A `schema` declaration's `.d.ts` declared an interface, `interface User extends Schema.Schema.Type<typeof User> {}`, before the constant, so a library that rewrote `const User = Schema.Struct(…)` and `type User = typeof User.Type` as a `schema` changed its public declarations. It now declares the constant and then `type User = typeof User.Type`, byte for byte what the Effect TypeScript declares.
- A function's form followed its body: adding a log call to an unannotated exported helper changed its declaration from plain to Effect and broke callers compiled earlier, a callback type written in place accepted Effect callbacks while the same type through an alias did not, and an unannotated protocol method such as `static [customMatcher]()` or `[Symbol.dispose]()` that ran an Effect returned it unrun. A function's form is now written: a plain return annotation or `: infer _` makes it plain, a function without one is an Effect function, a literal takes its destination's form, and a callback type means what TypeScript means; see [Upgrade from 0.0.10](#upgrade-from-0010).
- A match whose last arm only binds the value, `when let other: …`, reported EK4701 over a union of literals or tags as if that arm handled no case. Such an arm now handles every case, as `default` does.
- A structural type could stand for a service. A requirement for one service could be relabeled as another and fail at run time with `Service not found`. Services are now nominal by their key; see [Upgrade from 0.0.10](#upgrade-from-0010).
- A `service` declaration's `.d.ts` declared VibeLang's own interface, runtime key type and `Shape` namespace, and its key was always derived, so a library that rewrote a `Context.Service` class as a `service` changed its public declarations and its key (foldkit's `Dispatch`, alchemy's `Correlation`). It now declares Effect's own `Context.Service` class, byte for byte what the TypeScript declared, and `static readonly key = "…"` in the body keeps the original key, which the `Context.Service` quick fix and `vibelang --fix` now write.
- An `error` declaration's `.d.ts` declared VibeLang's own `#private` member and a `namespace E { type $error = ErrorBrand<…> }` marker beside the class, so a library that rewrote a `Data.TaggedError` class as an `error` changed its public declarations. It now declares exactly what the `Data.TaggedError` class declares, and a match counts an arm over any error class extending `YieldableError` toward exhaustiveness, wherever the class is declared.
- A `match` without `default` over an open subject, such as a `string` without a literal type, `unknown`, or a class that is not an `error` declaration, compiled and threw a `TypeError` when no arm matched. It is now EK4701; see [Upgrade from 0.0.10](#upgrade-from-0010).
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

- The refactor "Convert to a VibeLang function" turned the removed shorthand `async later(n: number) { ... }` (EK4618) into `later(n: number) { ... }`, which does not parse. It now writes `function later(n: number) { ... }`.

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

- `vibelang --fix` crashed on a file with a malformed import such as `import * ct.sleeon from "effect/Option"` once one of its fixes applied: removing the effect imports the fixes left unused read the import's specifier as a string. It now skips an import whose specifier is not a string.

- The compiler crashed on `@vibelang leakable`, the documentation-comment marker that exempts a service from EK4809, and on any service member whose requirement's declaration has a documentation comment, such as `Effect.Effect<string, never, Maybe!!>`: reading the comment skipped it as trivia. The marker now exempts the service as documented.

- `vibelang --fix` parsed every library and package again for each round of fixes, so a type nesting 20 `Effect.Effect<…>` took half a minute on a busy machine. A run now parses a file again only when a fix edits it, which took that type from 23 s to 6 s.
- Post-merge fuzz checks repeatedly compiled every generated acceptance case. Short compile, parity and fix runs now retain corpus and pending witnesses plus deterministic samples; campaigns and nightly runs retain their complete inputs, and every short target logs CPU use and fails on a large budget regression.

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
- The diagnostic guide omitted the adjustable editor warning EK9100. It now identifies its default severity and editor-only behavior.
- The platform guide lacked a complete HTTP request that read the response body. It now checks a JSON request with FetchHttpClient.layer.
- A copied module-block Node import could fail because the starter disables Node declarations. The guide now installs @types/node and enables those types explicitly.
- The process exit guidance did not explain numeric main returns. It now states that normal return exits 0, failure exits 1 and interruption exits 130.
- The contributor compiler-case command could run without runtime dependencies. It now installs them before the case suite.
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
- `provide` accepts values that are neither layers nor contexts, such as
  `provide 123 { ... }`, and crashes at runtime. Pass a layer, a nonempty
  tuple of layers or a context.

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

- **Some names are recognized by spelling.** A local named `Number`,
  `String` or `Option` can receive built-in pattern behavior instead of its
  own meaning. A top-level call named `runSync`, `runPromise`, `runMain`,
  `runFork` or `runCallback`, even a property on your own object, can suppress
  automatic entry execution. Aliasing helpers such as `pipe` can also lose
  their special handling. Today, avoid built-in matcher and runner spellings
  for unrelated bindings, retain documented helper names, and check that
  `main` still runs after a rename.

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
  timeout("10 millis") {
    try { sleep("1 hour") } finally { throw new CleanupError() }
  } // parent can report only TimeoutError
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
    memory use, and signals processes with `kill` and `isRunning`. The home
    directory is Effect's `UserDirectories.home()`. Browsers have no
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
  `@effect/platform-browser` 4.1.0 as optional peer dependencies.
- EK4402 names the experimental service instead of a hatch, with no import:
  `Experimental.FileSystem` for `X_OK` and `O_NONBLOCK`, `Experimental.Process` for `os.hostname()`,
  `process.pid`, `process.kill` and the other calls it replaces, and
  `Experimental.Locks` for `navigator.locks`. It names Effect's own
  `FileSystem.lstat` for `lstat`, `UserDirectories.home()` for
  `os.homedir()`, and `effect/crypto`'s `Mac`, `Signature`, `Aead` and
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
error CleanupFailed

function stopped() {
  try {
    interrupt()
  } finally {
    throw new CleanupFailed()
  }
}

function recover() {
  return stopped() catch "recovered"
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
- Members returned by `Layer.effect(Service) { ... }` must fit the
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

`process.env` was already EK4402. `globalThis.process.env`,
`globalThis.fetch`, `globalThis.crypto.subtle`, `globalThis.location`,
`globalThis.navigator`, and the other platform globals now are too.

```vibe
// expect-error: EK4402
function home() {
  return globalThis.process.env.HOME
}
```

Read configuration with `Config` from Effect:

```vibe
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
