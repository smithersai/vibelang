---
name: vibelang
description: Write, edit or review VibeLang (.vibe files), Effect programs in TypeScript syntax. Use for any .vibe file, diff or question about VibeLang.
---

# VibeLang

Read `.vibe` functions as Effect programs: calls run and contracts are inferred. A function without a return annotation is an Effect function, whatever its body does; a plain return annotation, or `: infer _`, makes a plain JavaScript function. `vibelang` (a TypeScript 7 compiler) checks `.vibe` and `.ts` files together and emits JavaScript and declarations. `EK2001` is a VibeLang diagnostic. Pages named below are routes on https://vibelang.sh.

## The model

- A call runs where it stands and gives its success value: `const user = Users.find(id)` is a `User`. There is no `Effect.gen`, `yield*` or `Effect.map` chain.
- A call runs where it stands; a function literal is a program. `retry(() => fetchUser(id), policy)` retries the call, and `Effect.all([() => a(), () => b()])` gets two programs. The older form that passes a call by name, `retry(fetchUser(id), policy)`, still compiles but is being retired: don't write it. A program of several statements is `() => { ... }` or a block param.
- Contracts are inferred. `A!E!R` writes `Effect<A, E, R>`: `User!NotFound!Users`. An empty slot is `never`: `User!!` cannot fail and needs nothing. `A!E` on a function with a body infers R. `Effect<A, E, R>` is accepted too, with TypeScript's defaults (`Effect<A>` is `A!!`), and `Effect<A, infer E, R>` infers E.
- `throw` fails with an expected error, everywhere outside a hatch or a `module` body. `catch` receives expected failures as `Effect.catch` does, in plain functions too: defects, JavaScript exceptions included, and interruption pass through; a failure beside a defect becomes a defect, and one beside an interruption is caught. `finally` always runs.
- A function's form is written. Without a return annotation it is an Effect function, which plain code (a module's top level, a field, a constructor, an accessor, a plain function, a synchronous callback) may not call or pass: EK1001, EK2003, EK4301. `double(n: number): number`, or `: infer _` to keep the type TypeScript infers, makes a plain function, which may not run an Effect (EK2003). A function literal takes its destination's form: `xs.map((x) => x + 1)` is plain, `forEach(xs, (x) => save(x))` an Effect function, and one with no declared destination an Effect function. A protocol method (`toString`, `toJSON`, `[Symbol.dispose]`) is plain. A callback type `(a: A) => B` is plain; one that may run Effects is `(a: A) => B!E!R`, with `E` and `R` declared as type parameters. Plain call cycles start with fast JavaScript recursion, then continue on heap frames at the eager depth limit; recursion through synchronous callbacks keeps JavaScript's stack limit.
- Every module of `effect`, its root's and its subpaths' (`Console`, `Option`, `Schema`, `Layer`, `Stream`, `Clock`, `HttpClient`, `ChildProcess`, `TestClock`, ...), is in scope without an import, except where a JavaScript or shared web global of the same name wins (`Array`, `String`, `Request`, `Headers`): import that module under another name; `Model` and `Prompt`, which two subpaths share, need one too. A module's name also names its export of that name, the module's own exports winning: the type `Option<A>` is `Option.Option<A>`, `FileSystem.readFileString(path)` calls the `FileSystem` service, `FileSystem()` is its implementation. Bare Effect functions: `sleep log logDebug logInfo logWarning logError retry repeat timeout race all forEach die withSpan exit interrupt yieldNow`. Import platform packages and sibling modules, with the extension: `import { User } from "./user.vibe"`.
- Values of Effect's data types take their module's functions as methods: `stream.filter(p).take(3)`, `maybe.map(f).getOrElse(() => 0)`, `fiber.join()`, `ready.await()`, and data-first functions whose receiver isn't named `self`, such as `cause.findErrorOption()`. A method exists only in a call (EK4501).
- Data stays data until called: a call that returns a `Config`, `Exit`, service key or error instance returns it; `Port()` reads the config `Port`.

## Forms

Declarations export like TypeScript declarations: `export data Shape { Circle { radius: number } }`, `export error Missing`, `export service Users { name: string }`, `export schema User { id: string }`.

| Effect TypeScript | VibeLang |
| --- | --- |
| `class E extends Data.TaggedError("E")<{ readonly id: string }> {}` | `error E { id: string }`, `error Timeout` |
| an error class with a constructor, methods or a subclass | `error E { id: string; constructor(raw: string) { super({ id: raw.trim() }) } }`, `error Sub extends Base { path: string }` |
| `Schema.TaggedError` class | `schema error E { id: string }` |
| `Context.Service<Users, {...}>()("app/Users")` | `service Users { static readonly key = "app/Users"; find(id: string): User!NotFound; region: string }` (leave out `key` to derive it); it declares the same class, and as a type `Users` is the service's identifier, so type an implementation or a default as `Users.Shape`; `Users()` is the shape |
| a service of another shape | `service Prefix: string`, `service Search: SearchApi { static members }`; the type `Search` is the key, so type an implementation `SearchApi`; a shape cannot refer to its service key (EK2103) |
| `Schema.Struct({...})` and its type | `schema User { id: string; nick?: string; role: "admin" \| "member"; home: Address }` |
| `Schema.Literals([...])` and its type | `schema Code = "a" \| "b"` |
| `Data.TaggedEnum<{...}>` and `Data.taggedEnum<T>()` | `data Delivery { Waiting; Sent { tracking: string } }`; `Delivery.Waiting()` builds the fieldless variant; `Delivery.Sent({ tracking })` builds one with fields; generic: `data LoadState<A, E> { ... }` |
| `readonly` members | the default for interface and object-type members; `mutable count: number` for one you assign |
| `Layer.effect(Users, Effect.gen(...))` | `Layer.effect(Users) { setup; return { find(id) { ... } } }`; no setup: `Layer.succeed(Users, { ... })` |
| `yield* Users` then a member | `Users.find(id)`; `Users()` is the implementation |
| `Effect.provide(p, AppLive)` | `provide AppLive { ... }`; one service `provide Random = seeded { ... }`; both `provide A, Key = v { }` |
| `Effect.fail(e)` | `throw new E({ id })`; in an expression `x ?? throw new E({ id })` |
| `Effect.catchTag(s)` | `try { ... } catch (e) { return match (e) { when E: ...; default: throw e; } }` |
| `Effect.catch(p, f)`, `Effect.orElseSucceed(p, () => v)` | `p catch (e) => f(e)`, `p catch v` |
| `Effect.catchCause`, `Effect.failCause(c)` | `match (exit(p)) { when Exit.Success(let v): v; when Exit.Failure(let cause): ...; }`, `Effect.failCause(cause)`; `throw cause` is EK2140 |
| `Effect.ensuring`, `Effect.onExit` | `try { } finally { }`, `try { } finally (exit) { }` |
| `Effect.scoped` + `acquireRelease` | `using r = Effect.acquireRelease(() => open(), (r) => close(r))`, released once at block exit, even on interruption |
| `Effect.fn("name")(function* ...)` | `function f() { return withSpan(() => { ... }, "name") }` |
| `Effect.withSpan(p, "n")`, `it.effect("n", () => ...)` | `withSpan(() => p(), "n")`; a block param is always the call's last argument: `it.effect("n") { ... }`; a `{` that starts the next line is EK1022 |
| `p.pipe(Effect.retry(s), Effect.timeout(t))` | `timeout(() => retry(() => p(), s), t)`; passing a `\|>` topic to `retry` is being retired |
| `Match.value(x)...Match.exhaustive` | `match (x) { when "a": 1; when E and { let id }: id; default: 0; }` |
| `Option.match`, `Exit.isFailure` | `when Option.Some(let v):`, `when Option.None:`, `if (o is Exit.Failure(let cause))` |
| `Delivery.$match({ Sent: ({ tracking }) => ... })`, `Delivery.$is("Sent")` | `when Delivery.Sent { let tracking }:`, `when Delivery.Waiting:`, `if (d is Delivery.Sent)` |
| block-owned `Effect.forkScoped` + `Fiber.join` | `const f = fork work()`, `join f`, `join [a, b]`; the region that owns them interrupts them on exit |
| `Effect.scoped` + `forkScoped(...)`, `forkDetach`, `forkIn` | `fork { ... }`, owned by the enclosing region; `detach(p)`; `forkIn(scope, p)`. `Effect.forkScoped(p)` alone still ties the fiber to the caller's scope (`Scope` in R) |
| `Effect.all(xs, { concurrency: "unbounded" })` | `await.all [a(), b()]`, `await.all { x: a(), y: b() }` |
| `Effect.all(xs, { ..., mode: "result" })` | `await.allSettled [a(), b()]`: typed failures become `Result`s |
| `Effect.raceFirst`, `Effect.raceAll` | `await.race [a(), b()]` (first to finish), `await.any [...]` (first success) |
| `Effect.forEach(xs, f, { concurrency: 8, discard: true })` | `for concurrent(8) (const x of xs) f(x)` |
| `Effect.uninterruptibleMask`, `interruptible` | `uninterruptible { ... restore { ... } }`, `interruptible { ... }` |
| a Stream from a generator | a producer: `function*` with `yield`; `for (const x of p())` pulls it |
| `Effect.sync`, `Effect.promise` | `sync(() => f())`, `sync(f())`, `sync(async () => load())` |
| `yield* Effect.try(…)`, `yield* Effect.tryPromise(…)` | `try Effect.try({ try: () => JSON.parse(text), catch: (e) => new Bad({ e }) })`, `try Effect.tryPromise({ try: (signal) => sdk.get(id, { signal }), catch: (e) => new Bad({ e }) })`; the wrapped function is plain TypeScript |
| `Effect.callback` | `callback((resume) => { socket.once("open", resume); return () => socket.off("open", resume) })` |
| `NodeRuntime.runMain(main.pipe(Effect.provide(NodeServices.layer)))` | `import "vibelang/platform/node"`, then `export function main() { ... }` (a function declaration; `export const main = () => …` never runs, `EK4843`): runs when Node starts the module, not on import, with the platform layer it needs |
| none (VibeLang's own) | `control Approval { approve(r: string): boolean!! }`, then `try { ... } handle Approval.approve(r) { resume(true) }` |
| none (a TypeScript escape) | `module text { export function clean(s: string): string { ... } }`, `import { clean } from text` |


`module name { ... }` is an inline TypeScript module: outside hatches and the functions `Effect.try` wraps, its body is the only place in a `.vibe` file where JavaScript’s `throw` works; import its exports with `import { x } from name`.

## Rules

1. `await x` is an error (EK4601 to EK4603; a fiber is `join x`, EK4609; a Deferred `d.await()`, EK4610). An `async` function means what it means in TypeScript: its body is TypeScript, `await` there waits for a promise, and awaiting an Effect is EK4617. `try p` runs the Effect `p`; `try f()` means the call `f()`, which runs where it stands. `try` before anything else is EK4615, and the retired hatch `try(…)` is EK4616, whose quick fix writes `Effect.try`.
2. Node's globals (`process`, `Buffer`, `require`, `__dirname`) and the web's I/O globals (`fetch`, timers, `console`, `crypto`, `performance`, `localStorage`) are not in scope, and a `.vibe` file imports no `node:*` module as a value; a type-only import is fine (EK4402, clock EK4403). Use Effect's services, never a wrapper of your own: the prelude's `Console`, `Clock`, `sleep`, `Config`, `Random`, and with no import `FileSystem`, `Path`, `Crypto`, `Stdio` and `ChildProcessSpawner`, which the entry provides to `main` when its file starts with `import "vibelang/platform/node"` (or `/bun`; a browser page starts `main` itself: `platform/105-introduction`); `HttpClient` with `FetchHttpClient.layer`. EK4402 names each API's replacement. For what Effect lacks, use `Experimental.Process.hostname()` and the rest of `Experimental.Process`, `.FileSystem` and `.Crypto`, which the node and bun entries provide too, and `Experimental.Locks`, which no node or bun entry provides: `provide ExperimentalNodeLocks.layer { ... }` locks within one Node.js process only, and `ExperimentalBrowserLocks.layer` across a browser origin's tabs; or import what Effect lacks in a `module` block or a `.ts` file and run it in a hatch.
3. In code a fiber runs, a plain function from a `.ts` file or a package runs only through a hatch (EK4401) unless trusted (module initialization and its plain callbacks are exempt): Effect's own packages, `"vibelang": { "trustedPackages": ["@scope/*"] }` at the top level of `tsconfig.json`, or `trusted(impl, [Errors])` (import it with `import { trusted } from "vibelang-runtime"`), in a `.ts` or `.vibe` file, for its expected failures.
4. A hatch's first argument (`sync`, `callback`) is self-contained TypeScript, and so is the function that `Effect.try` or `Effect.tryPromise` wraps, which may also read the file's values. It may use its own parameters, globals, prelude names, imports, types and the file's `error` declarations; any other value of the `.vibe` file arrives as an input after it, filling its first parameters (EK4405). `runPromise` and `runFork` lead back in from a hatch or a `.ts` file. No catch expression in a hatch (EK2114).
5. Outside a hatch or a `module` body, `throw` is always a typed failure. Constructors, accessors and static blocks run as plain JavaScript, as a module's top level does: a throw that can escape one is EK2003, and EK1001 at the top level. A function with a plain return annotation never fails and needs no service: a throw that can escape it, in a statement, a throw expression, a `match` arm or a `do` block, is EK2003, as is running an Effect; the quick fix writes the contract (`number!BadInput!`), or move the throw into a hatch. A method's plain annotation is checked the same way, because it is the method's `.d.ts` type; a method implementing a plain JavaScript protocol member such as `[Equal.symbol]` is checked against that member (EK4301). It may throw what its own `catch` handles. A plain callback that can fail is EK4301. Its calls of TypeScript code are JavaScript calls: their exceptions pass through its `catch` (EK2004 warns) and become defects at an effectful caller; a trusted call's listed failure is typed only inside the function's own `try`.
6. A module's top level declares: running a program there is EK1001, except through a runner such as `NodeRuntime.runMain(...)`. To hold a program without running it, bind a function: `const p = () => make()`. The older typed-`const` hold still compiles but is being retired.
7. `match` is exhaustive: a `match` without `default` over a finite union (a data type's variants, errors, literals, `Option`, `Exit`, `Result`) must cover it, or EK4701 says `This match does not handle every case of Delivery: Delivery.Rejected is left.` Any other subject is open, a `string` or `number` without a literal type, `unknown`, `any`, a type parameter or a class that isn't closed, so its match needs a `default` or a final `when let x:` arm (EK4701). A class arm covers only a closed class, an error class (an `error` declaration, `Data.TaggedError` or another class extending `effect`'s `YieldableError`) without its own `[Symbol.hasInstance]`: an arm over `Error` or another class covers nothing, so that match needs a `default` (EK4701). A covered match's last arm adds no untested branch, so write no `default` there. `catch (e: E)` and `catch (cause: Cause)` are retired (EK2112, EK2113): catch, then `match` or `is`. `is` binds only in an `if` or `while` condition (EK4703). No regex or relational patterns (EK4704): guard with `when let n and if (n < 10):`.
8. An `error` declares the class `Data.TaggedError` would, and its type is structural, as in Effect TypeScript: `abstract`, `extends` another error, `implements`, a constructor that calls `super`, methods, accessors and static or private members mean what they mean in TypeScript. A field is a property with a type and no initializer; the constructor takes it. An error's tag is its bare class name, a subclass's its own: `catchTag("NotFound")` matches it, and `when NotFound` and `is NotFound` match by class. A family's base writes `_tag: string` so its subclasses' tags fit (EK2117; an `abstract error` needs none), and catching the base's own tag leaves the base in E. A subclass with fields and no constructor takes its base's fields and its own as one object; when the base's constructor takes other arguments, write one (EK2118).
9. Don't write `readonly` on interface or object-type members; arrays still need `ReadonlyArray`. Class members keep TypeScript's rule, and an `error`'s fields are always readonly.
10. `throw` in an expression takes a unary operand: write `throw (c ? a : b)` (EK1010). `x catch y` binds looser than `??` and `||`, tighter than `? :`, and chains left to right. Both sides take the expression's contextual type, so `{ _tag: "Found", ... } catch (e) => ({ _tag: "Error", e })` checks against a declared union.
11. Retired spellings warn: `with X { }` (EK1009), `service class` (EK2120), `layer X: S { }` (EK2121). `select` is the error EK4607: use `await.race`.
12. Effect code in TypeScript's style warns where VibeLang has a form: an Effect error class (EK4830; a `Schema.TaggedError` class EK4837, without a fix), a `Context.Service` class (EK4831), a `Schema.Struct` constant (EK4832), `Effect.Effect<A, E, R>` (EK4833), a running `Effect.succeed` or `Effect.fail` (EK4834), `Effect.catchTag`, `catchTags` or `catch` (EK4835), `Effect.withSpan`, `provide` or `provideService` (EK4836), a `Match.value` chain (EK4839), a `pipe` of Option functions (EK4840), a schema constant just before its type alias (EK4841), and an import of Effect's `Array` or another module under a JavaScript global's name (EK4842). `Effect.gen` with `function*` is the error EK1002; its fix writes a function's whole `Effect.gen` body in direct style. Write the VibeLang form; `vibelang -p tsconfig.json --fix` applies every safe fix.
13. Tests in `.vibe` use `it.effect` (test clock: `sleep` stalls until `TestClock.adjust`) or `it.live` (real clock) from `@effect/vitest`. Promise-style tests stay in `.ts`. A runner in code a fiber runs is EK1005. Vitest hides logs under an agent: assert instead.
14. An unannotated `function*` is a producer (a Stream). Annotate `Generator<...>` for a JavaScript generator; it never fails either: a throw that can escape it is EK2003, and its `catch` lets an exception passed in with `generator.throw()` through. A coroutine that speaks a protocol by throwing belongs in a `module` block or a `.ts` file.
15. `do { ...; value }` is a block with a value, for a `match` arm or an `await.all` element; `return` inside it is TS1108. A block param instead needs `return`.
16. A synchronous callback, such as `Array.map`'s, can't run an Effect, fail, or be an Effect function (EK4301), and a function value whose type returns an Effect, such as `pick(p: number!!): infer _`, is one: use `forEach` or a loop, or annotate the helper it calls or passes, `(n: number): number`; the quick fix and `vibelang --fix` write that annotation.
17. A resource acquired without `using` belongs to the caller (`Scope` in R); don't `using` a resource a function or service hands out, or it closes first.
A fiber belongs to the innermost region the source names: a function body (an arrow's expression body too), one loop iteration, a `try`, `catch` or `finally` block, a `using` block, or a `provide` or mask block; an `if` branch or bare block owns nothing. The region interrupts it on exit, so its value goes only to a `const`/`let` of the region, `join`, a `Fiber` function such as `Fiber.interrupt(f)`, or a `fork` operand, await element or `for concurrent` body there. Returning, storing, passing or capturing it is the error EK4838, `() => fork p()` included: use `Effect.forkScoped(() => p())`, `forkIn(scope, () => p())` or `detach(() => p())`.

18. A handler covers only its own fiber: a forked branch installs its own (EK4201).
19. A factory declared with an Effect return type, `(input: In): A!E!R => { ...; return () => ... }`, runs plain code at the call, then returns a program on every path (EK2116); its outer body runs no Effect and never throws (EK2115): fail in the program, `return () => { throw e }`.

## Idioms

- Errors: an `error` per failure, `throw` to fail, `x catch fallback` for a default, `match` to choose: `error-management/014-expected-errors`, `error-management/016-fallback`, `error-management/017-matching`.
- Services: `service` declarations; `Layer.effect(S) { }`; `provide` once around `main`: `requirements-management/025-services`, `requirements-management/027-layers`.
- Retries and timeouts: bare `retry` and `timeout` or a pipe; per-attempt timeout inside the retry: `error-management/018-retrying`, `error-management/019-timing-out`.
- Concurrency: the `await` operations, `fork`/`join`, `for concurrent`: `concurrency/007-basic-concurrency`, `concurrency/047-fibers`.
- Resources: `using` in the block that owns them: `resource-management/029-introduction`. A Disposable or AsyncDisposable is disposed once at block exit; one acquired with `Effect.acquireRelease` is released only by its release.
- Data: `schema` declarations, fields of any schema (`Schema.FiniteFromString`); `Schema.Struct` for struct checks and `optionalKey`: `schema/087-basic-usage`. Tagged unions: `data`, `data-types/073-data`.
- Matching: `vibelang-features/116-match-and-is`. Handlers: `vibelang-features/111-control-operations-and-handlers`. Producers: `vibelang-features/112-producers`.
- Platform services: `platform/105-introduction`; each Node.js or web global's replacement: `platform/platform-globals`.
- TypeScript at the edges: hatches, trust, factories: `vibelang-features/114-vibelang-for-effect-users`.
- Every form beside its Effect code: `vibelang-features/115-cheat-sheet`. The rules: `spec/`.

```vibe
import "vibelang/platform/node"

export function main() {
  const name = Config.withDefault(Config.String("NAME"), "stranger")()
  using directory = FileSystem.makeTempDirectoryScoped()
  const file = Path.join(directory, "hello.txt")
  FileSystem.writeFileString(file, `Hello, ${name}!`)
  Console.log(FileSystem.readFileString(file))
}
```

`Config.String` is Effect 4's spelling. `withDefault` handles missing input, preserving validation failures. The config stays data until called; `using` removes the temporary directory and its files at block exit.
