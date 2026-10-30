# VibeLang for Effect users

Keep Effect's runtime, libraries, layers, and error channels; in `.vibe` files, write sequential work as effect functions and statements. The [cheat sheet](115-cheat-sheet.md) shows every change beside its Effect code, and the [specification](../../../design/src/000-intro.md) gives the rules behind each.

```vibe
// pending: VIP-1, VIP-5, VIP-6, VIP-14
// run: try Console.log(try main())
effect function greet(name: string) {
  try sleep("10 millis")
  const message = `Hello, ${name}`
  try Console.log(message)
  return message
}

effect function main() {
  return try retry(greet("Ada"), Schedule.recurs(2))
}
// Output: Hello, Ada
// Output: Hello, Ada
```

Calling `greet("Ada")` returns an Effect. `try greet("Ada")` runs it and returns its string. Pass that Effect directly to `retry`, `timeout`, or another Effect function. Use `effect { ... }` to build an Effect from several statements. Plain and `async` functions keep their TypeScript meaning. `await` waits for Promises in `async` functions.

## Call VibeLang from TypeScript

Compile both files with `vibelang`, rather than ordinary `tsc`. In a `.ts` source, import the relative `.vibe` path **with its extension**:

```vibe
// t5.vibe
// pending: VIP-1, VIP-5, VIP-6
export effect function clampAll(values: ReadonlyArray<number>) {
  return try forEach(values, (value) => succeed(Math.min(10, Math.max(0, value))))
}
```

```ts
// use.ts
import { Effect } from "effect"
import { clampAll } from "./t5.vibe"

console.log(JSON.stringify(Effect.runSync(clampAll([-2, 4, 15]))))
// Output: [0,4,10]
```

To TypeScript, `clampAll(...)` returns an `Effect.Effect<number[], never, never>`. Run that program at the application boundary: `Effect.runSync` works when execution stays synchronous; `await Effect.runPromise(clampAll(...))` also supports asynchronous work. Import runners from `effect` as above, or `runSync` / `runPromise` from `vibelang-runtime`. Supply any required services with `Effect.provide` before running. A plain function, such as `function addOne(n: number): number`, returns its value directly and takes no runner. Inside an effect function, run `clampAll(...)` with `try`; call a plain function directly; see [Running Effects](../getting-started/009-running-effects.md).

For `src/t5.vibe` and `src/use.ts`, keep these settings in `tsconfig.json`:

```json
{
  "compilerOptions": {
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "rootDir": "src",
    "outDir": "dist",
    "rewriteRelativeImportExtensions": true
  },
  "include": ["src/**/*.vibe", "src/**/*.ts"]
}
```

Keep the starter's other compiler options. `include` must cover a standalone `.ts` entry point: a `.ts` file imported by an included file is already part of the project, but an unreferenced `src/use.ts` is otherwise neither built nor typechecked. The current starter includes both `.vibe` and `.ts` files under `src/`. `rewriteRelativeImportExtensions` rewrites `"./t5.vibe"` to `"./t5.js"` in emitted JavaScript. Build, then run the emitted caller:

```sh
bun run build
node dist/use.js
```

Node runs the JavaScript output; importing the `.vibe` source directly with Node does not compile it.

### Services and errors from TypeScript

A service is Effect's own `Context.Service` class, so TypeScript sees the same two types. `Users` is the service's identifier, which carries its key, so a structural object can't stand for it. `Users.Shape`, which TypeScript spells `Context.Service.Shape<typeof Users>`, is the members. Implement a service in TypeScript with `implements Context.Service.Shape<typeof Users>`, provide it with `Layer.succeed(Users, impl)`, and read it with `yield* Users`. An `error` class is the class `Data.TaggedError` declares, and `Effect.catchTag` catches it by its tag.

```vibe
// users.vibe
// pending: VIP-3, VIP-9, VIP-13
export error NotFound { id: string }
export service Users { find(id: string): string!NotFound; readonly region: string }
```

```ts
// live.ts
import { Context, Effect, Layer } from "effect"
import { NotFound, Users } from "./users.vibe"

class UsersImpl implements Context.Service.Shape<typeof Users> {
  readonly region = "eu"
  find(id: string): Effect.Effect<string, NotFound> {
    return id === "1" ? Effect.succeed("Ada") : Effect.fail(new NotFound({ id }))
  }
}

const program = Effect.gen(function* () {
  const users = yield* Users
  return yield* users.find("2").pipe(Effect.catchTag("NotFound", (e) => Effect.succeed(`no user ${e.id}`)))
})

console.log(Effect.runSync(program.pipe(Effect.provide(Layer.succeed(Users, new UsersImpl())))))
// Output: no user 2
```

The emitted declarations are the ones the Effect TypeScript writes, so a library migrated to VibeLang keeps its `.d.ts`: a service declares `class Users extends Context.Service<Users, { … }>()(key)`, a schema `const User = Schema.Struct(…)` and `type User = typeof User.Type`, and an `error` the `Data.TaggedError` class. A migrated service keeps its key with `static readonly key = "app/Users"` in its body. Declarations are written beside the source as `x.d.vibe.ts`, and package builds also write ordinary `.d.ts` files.

## Translate the idioms

| In Effect TypeScript | In VibeLang |
| --- | --- |
| `Effect.gen(function* () { ... })` | `effect { ... }`, or an `effect` function with statements |
| `class NotFound extends Data.TaggedError("NotFound")<{ readonly id: string }> {}` | `error NotFound { id: string }` |
| `const User = Schema.Struct({ id: Schema.String })` and `type User = typeof User.Type` | `schema User { id: string }` |
| `const Role = Schema.Literals(["admin", "member"])` and `type Role = typeof Role.Type` | `schema Role = "admin" \| "member"` |
| `interface Cart { readonly id: string; items: Array<Item> }` | The same interface: `readonly` has its TypeScript meaning |
| `const x = yield* work()` | `const x = try work()` |
| `pipe(x, Effect.map(f), Effect.flatMap(g))` | `const value = try x; const result = try g(f(value))` |
| `Option.getOrElse(Option.map(maybe, f), () => 0)` | `Option.getOrElse(Option.map(maybe, f), () => 0)` |
| `pipe(stream, Stream.filter(p), Stream.take(3))` | `pipe(stream, Stream.filter(p), Stream.take(3))` |
| `work().pipe(Effect.retry(policy), Effect.timeout("1 second"))` | `try timeout(retry(work(), policy), "1 second")` |
| `Context.Service` | `service Users { find(id: string): User!NotFound }`; look up `const users = try Users`, then run `try users.find(id)` |
| `const users = yield* Users`; `users.region` | `const users = try Users`; `users.region` reads a value member. See [service value members](../requirements-management/025-services.md). |
| `Layer.effect(Users, Effect.gen(function* () { ... }))` | `Layer.effect(Users, effect { setup; return { effect find(id) { ... } } })` |
| `Effect.provide(program, AppLive)` | `provide AppLive { try program }` |
| `Effect.provideService(program, Random.Random, seeded)` | `provide Random.Random = seeded { try program }` |
| `Effect.catchTag(program, "Missing", recover)` | `program catch effect (e) => match (e) { when Missing: try recover(e); default: throw e; }` |
| `Effect.catch(program, (e) => recover(e))` | `program catch effect (e) => try recover(e)` |
| `Effect.orElseSucceed(program, () => value)` | `program catch value` |
| `Effect.result(program)` (Effect 3: `Effect.either(program)`) | `try result(program)` captures one program's typed failure as a `Result`; match `Result.Success(let value)` or `Result.Failure(let error)`. |
| `Effect.exit(program)` | `try exit(program)` captures its full outcome; match `Exit.Success(let value)` or `Exit.Failure(let cause)`. |
| `Effect.ensuring(program, cleanup)` | `try ensuring(program, cleanup)` |
| `Effect.scoped` with `Effect.acquireRelease` | `try scoped(effect { const r = try acquireRelease(open(), close); ... })` releases the resource exactly once ([Releasing JavaScript Disposables](../resource-management/030-scope.md#releasing-javascript-disposables)) |
| `Effect.forkScoped(program)` | `fork.scoped program` for a child owned by the current Scope |
| `Fiber.join(fiber)` | `join fiber`; for several, use `try all([Fiber.join(a), Fiber.join(b)])` |
| `Effect.all([a, b], { concurrency: "unbounded" })` | `try.all [a, b]`, like `Promise.all`; `try all({ x: a, y: b }, { concurrency: "unbounded" })` keeps the keys |
| `Effect.all(effects.map(Effect.exit), { concurrency: "unbounded" })` | `try.allSettled effects`, with an `Exit` for each success, failure, defect, or interruption |
| `Effect.raceAllFirst([a, b])` | `try.race [a, b]`, like `Promise.race`: the first to finish wins |
| `Effect.raceAll([a, b])` | `try.any [a, b]`, like `Promise.any`: the first success wins |
| `Effect.forEach(items, f, { concurrency: 8, discard: true })` | `for concurrent(8) (const item of items) { try f(item) }` |
| `Effect.sync(() => render())` | `try sync(() => render())` |
| `Effect.try({ try: () => parse(text), catch: (e) => new BadInput({ e }) })` | `try Effect.try({ try: () => parse(text), catch: (e) => new BadInput({ e }) })` |
| `Effect.tryPromise({ try: (signal) => fetchJson(url, signal), catch: (e) => new BadFetch({ e }) })` | `try tryPromise({ try: (signal) => fetchJson(url, signal), catch: (e) => new BadFetch({ e }) })` |
| `Effect.promise(() => load())` | `try promise(() => load())` |
| `Effect.callback((resume) => …resume(Effect.succeed(x))…)` | `try callback((resume) => …resume(succeed(x))…)` |
| `Effect.runPromise(program)` in TypeScript | `runPromise(program)` in a plain or `async` function, or at the module top level |
| `Stream.fromIterable` or a generator-based source | `Stream.fromIterable` or a producer: `effect function*` with `yield value` |
| `Effect.forkChild(program)` | `fork program` |
| `Effect.forkIn(program, scope)` | `fork.in(scope) program` |
| `Effect.forkDetach(program)` | `fork.detached program` |
| `Stream.runForEachWhile` | `for try (const value of stream) { ... }` |

`try.allSettled` captures every element's full outcome as an `Exit`, including defects and interruption, and the whole never fails.

`try result(program)` captures typed failures only. Defects and interruption propagate. `try exit(program)` instead captures the full cause in `Exit.Failure`, including defects and interruption.

Use Effect's operators for retries, timeouts, concurrency, and Stream transformations. Statements replace operators that only sequence ordinary work.

## Port code with --fix

Effect declarations and combinator calls ported from TypeScript compile in a `.vibe` file, with warnings EK4830-EK4837 where VibeLang has its own form. `Effect.gen` bodies do not compile there (EK1002). Run `npx vibelang -p tsconfig.json --fix --noEmit` to rewrite supported forms whose VibeLang form keeps what the program does, then read the diagnostics left: each says what its form would change. See [TypeScript-style Effect code](../getting-started/012-devtools.md#typescript-style-effect-code). Support for the new forms arrives with the compiler's VIP implementation.

## Calls return Effects; programs stay cold

```vibe
// pending: VIP-1, VIP-5, VIP-14, VIP-18
// run: try Console.log(JSON.stringify([try sequential(), try concurrent()]))
effect function sequential() {
  const first = try greet("Ada")
  const second = try greet("Grace")
  return [first, second]
}

effect function concurrent() {
  return try.all [greet("Ada"), greet("Grace")]
}
// Output: Hello, Ada
// Output: Hello, Grace
// Output: Hello, Ada
// Output: Hello, Grace
// Output: [["Hello, Ada","Hello, Grace"],["Hello, Ada","Hello, Grace"]]
```

An effect function call constructs an Effect. `try` runs it at that point. `try.all` runs the supplied Effects concurrently. An `effect { ... }` block constructs an Effect and reruns its statements each time that Effect runs. A producer call constructs a Stream. See [Producers](112-producers.md).

## Preserve a factory's call-time work

When TypeScript captures configuration before returning an Effect, keep that phase in a plain function with a declared Effect return and return an Effect value:

```vibe
// pending: VIP-2
export const capture = (input: { value: number }): Effect.Effect<number, never, never> => {
  const snapshot = input.value
  return effect { return snapshot }
}
```

A TypeScript caller can build `capture(input)`, mutate `input`, then run the program, and still get the snapshot. The outer body runs synchronously at the call and can compute or copy plain data; every path returns a program. **Where TypeScript returned Effect.fail(e), write return effect { throw e }**; a plain `throw` in the outer function is a JavaScript exception. Put Effects and service lookups inside the returned program.

A forwarding member keeps its delegate's call phase with `const program: Effect.Effect<number, never, never> = base.read(path); return program`. A const with a declared Effect type holds its initializer in any scope: `const built: Made = make(config)` calls the factory now and runs none of the result. Capture values at the same phase as the TypeScript implementation; keep reads intended for execution inside the returned program.

A synchronous visitor that must return a program keeps its callback type unchanged: return `effect { ... }` from the callback, then run the returned program from effectful code. A discarded `items.map(item => save(item))` still needs `Effect.forEach` or a loop.

`retry(make(config), policy)` calls the factory once and retries its returned Effect. Use `retry(suspend(() => make(config)), policy)` to call the factory on each attempt; `const p: Made = make(config); try retry(p, policy)` calls it once and retries that program.

## Declare at the module top level

```vibe
// start.vibe
// pending: VIP-1, VIP-5, VIP-6, VIP-14, VIP-26
export effect function main() {
  try Console.log("started")
}
await runPromise(main())
// Output: started
```

The module top level is ordinary JavaScript. Construct Effects there and run them with an explicit runner. Top-level `await` accepts a Promise. `try` execution belongs inside an effect function or block.

Every export of Effect's `Effect` module is global unless its name clashes with a keyword or JavaScript global. Clashing names keep the `Effect.` prefix, such as `Effect.try` and `Effect.provide`. Root modules such as `Console`, `Clock`, `Option`, `Schedule`, and `Stream` are in scope. JavaScript globals such as `Array` keep their meaning, and `Effect.Array` names Effect's module. Platform subpath namespaces such as `HttpClient` are also in scope. Precedence applies separately to TypeScript's type and value meanings: `Console` in a type position remains the DOM interface, while `Console.log` uses Effect's namespace. Generated imports use fresh names.

## Keep platform work in Effect

```vibe
// pending: VIP-1, VIP-5, VIP-12, VIP-14
// run: const clock = try Clock.Clock; provide Clock.Clock = { ...clock, currentTimeMillis: succeed(123), currentTimeMillisUnsafe: () => 123 } { try Console.log(try reportTime()) }
effect function reportTime() {
  const now = try Clock.currentTimeMillis
  try Console.log(now)
  return now
}
// Output: 123
// Output: 123
```

`console.log`, `fetch`, timers, `process`, and `node:*` imports are errors in `.vibe` (EK4402), and so are the web's clock and randomness reads, such as `crypto.randomUUID()` (EK4403). Effect has a service for each, and the error names it and the layer that provides it. ECMAScript's `Date.now()` and `Math.random()` are allowed; read `try Clock.currentTimeMillis` and `try Random.next` where a test must control them. Use the prelude's `Console`, `Clock`, `sleep`, and `Config`. Look up a platform service with `try`, with no import, then call its members and run their Effects with `try`. Choose the platform layer at the application boundary:

```vibe
// notes.vibe
// pending: VIP-1, VIP-2, VIP-5, VIP-6, VIP-14, VIP-26, VIP-33
import * as NodeServices from "@effect/platform-node/NodeServices"
import * as NodeRuntime from "@effect/platform-node/NodeRuntime"

export effect function main() {
  try scoped(effect {
    const fs = try FileSystem
    const path = try Path
    const directory = try fs.makeTempDirectoryScoped()
    const file = path.join(directory, "note.txt")
    try fs.writeFileString(file, "saved")
    try Console.log(try fs.readFileString(file))
  })
}
NodeRuntime.runMain(Effect.provide(main(), NodeServices.layer))
// Output: saved
```

`NodeServices.layer` holds `FileSystem`, `Path`, `Crypto`, `Stdio`, `Terminal`, and `ChildProcessSpawner`; Bun uses `BunServices.layer`. `HttpClient`, from `effect/http`, needs `FetchHttpClient.layer` provided inside `main`. [The platform introduction](../platform/105-introduction.md) lists the service for each common Node.js and web call. Don't wrap a platform API that Effect covers in a `.ts` adapter. Node's globals and the web's I/O globals are not in scope in `.vibe`, and a `.vibe` file does not import a Node.js module as a value (D310); [Platform globals](../platform/platform-globals.md) answers each one. A `.ts` file imports what Effect lacks, such as the `createServer` that [Building an HTTP API](113-building-an-http-api.md) passes to a server layer.

A platform API that Effect lacks, such as `os.hostname()`, is often one of VibeLang's [experimental platform APIs](118-experimental-platform-apis.md): `try (try Experimental.Process.Process).hostname`. Code that needs Node.js globals or `node:*` value imports belongs in a `.ts` file. Prefixing a banned global with `globalThis` does not bypass the restriction: `globalThis.fetch` and `globalThis["setTimeout"]` are also `EK4402`.

A plain function known not to throw can be called directly inside an effect function. Wrap a potentially throwing call with `Effect.try`, then run it with `try`. Always wrap a Promise with `tryPromise` or `promise`. Callbacks capture local variables normally. Exported declarations record thrown types with `@throws {E}`. A foreign callable without a signature contract may throw `unknown`, whether imported from source or an emitted `.d.ts` and whether its type is written or inferred. Shipped contracts precede defaults; `@rethrows f` adds the actual callback's thrown type to own throws. Effectful callables never add synchronous throws.

## Trace and debug calls

Run emitted JavaScript with `node --enable-source-maps dist/main.js` and enable `"sourceMap": true` in `compilerOptions`. Source maps preserve `.vibe` locations. Function tracing defaults to `"none"`, so defects can show only one stack frame. Set `"vibe": { "tracing": "exported" }` at the top level of `tsconfig.json` and rebuild to trace exported functions. Use `"all"` to trace local functions too.

Use `try withSpan(effect { ... }, "checkout")` for a named operation, as you would use `Effect.withSpan` in TypeScript. Function spans supply the logical caller context that source maps alone cannot add, and add runtime work. If the default Node runner prints only an error message, use the [TypeScript debugging entry](../getting-started/012-devtools.md#debug-stack-traces) to print the rejected error's `stack`.

## Runtime cost

VibeLang forms compile to their Effect equivalents. They preserve the same `Exit` and finalizer order.

These are single-machine observations from the 0.0.9 alpha review on Linux x64, Node 26 and Effect 4.0.6. They are not a performance guarantee. The benchmark timed sequential loops with `Clock.currentTimeMillis`, with 200,000 calls for the success-only comparison and 1,000,000 for recovery and plain functions. The step increments a number and fails every 250,000th value; recovery resets it to zero. The success-only loop ends before that failure.

| Loop | Observed time |
| --- | ---: |
| 200,000 Effect-contracted VibeLang calls without `catch` | 550 to 610 ms, about 2.9 µs per call |
| 200,000 `Effect.fn` generator calls | 860 to 1,200 ms |
| 1,000,000 `step(n) catch 0` expressions | 3.0 to 3.8 s |
| 1,000,000 `Effect.succeed`/`Effect.fail` steps with `Effect.orElseSucceed` | About 0.33 s |
| 1,000,000 plain-function calls | About 3 ms |

Effect-contracted calls were in the same order of cost as `Effect.fn` generators. The `catch` loop cost more than the hand-written `Effect.orElseSucceed` loop. A plain function, `double(n: number): number`, adds no Effect wrapper, and a plain function is called directly from Effect code. Measure your own workload, including tracing, before choosing a boundary for a hot loop.

## Catch expected failures only

```vibe
// pending: VIP-1, VIP-2, VIP-4, VIP-5, VIP-7, VIP-13, VIP-14
// run: try Console.log(JSON.stringify([try displayName("ada"), try displayName("missing")]))
error Missing { id: string }

effect function lookup(id: string) {
  if (id !== "ada") throw new Missing({ id })
  return { id, name: "Ada" }
}

effect function displayName(id: string) {
  return effect {
    return (try lookup(id)).name
  } catch (error) => match (error) {
    when Missing: `Unknown user: ${error.id}`;
  }
}
// Output: ["Ada","Unknown user: missing"]
```

Inside an Effect function, `throw` adds an expected failure to the function's error channel, and `catch` receives it. Defects and interruption bypass `catch`; `ensuring` and `onExit` still run cleanup. `try orDie(work())` promotes an expected failure to a defect; to inspect defects, use Effect's cause APIs at a boundary.

`A!E!R` means exactly `Effect<A, E, R>`. Every omitted slot is `never`, including on a function with a body. Leave out the whole annotation to infer success, errors, and requirements.

See [Control operations and handlers](111-control-operations-and-handlers.md) for the proposal's status.
