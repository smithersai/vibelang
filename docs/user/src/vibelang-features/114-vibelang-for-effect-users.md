# VibeLang for Effect users

VibeLang keeps Effect 4's runtime, type system, layers, and standard library — and replaces generator boilerplate, `yield*`, `pipe`, and verbose error/service classes with statements. Every VibeLang form compiles to the Effect TypeScript you would write by hand.

See the [cheat sheet](115-cheat-sheet.md) for every construct side by side, and the [specification](../../../design/src/000-intro.md) for formal language rules.

![VibeLang compiles .vibe and .ts files in one program into ordinary Effect JavaScript and .d.vibe.ts declarations](/diagrams/vibe-ts-interop.svg)

```vibe
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

## Mental model in five rules

1. **`effect function` returns a cold Effect.** Calling `greet("Ada")` builds an Effect without running it. `try greet("Ada")` runs it on the current fiber. Pass `greet("Ada")` directly to `retry`, `timeout`, `fork`, or `try.all`.
2. **Plain and `async` functions stay TypeScript.** `await` works only on Promises inside `async` functions (`EK0102` in effect code, `EK0103` when awaiting an Effect — use `await runPromise(program)` instead). Combining `effect` and `async` is `EK0105`.
3. **Synchronous `.vibe` code never throws.** In `effect` code, `throw` is `Effect.fail`. In plain `.vibe` code, `throw` is `EK0401`. Wrap throwing `.ts` calls in `Effect.try` (`EK0403`) and Promises in `tryPromise` (`EK0404`).
4. **Effect's modules and exports are global.** `Console`, `Clock`, `Option`, `Stream`, `Schedule`, `Layer`, `Schema`, `Scope`, `retry`, `timeout`, `sleep`, `all`, `forEach`, and `runPromise` need no import. Clashing names keep `Effect.` (`Effect.try`, `Effect.catch`, `Effect.provide`, `Effect.match`, `Effect.Array`, `Effect.String`). Disable implicit globals via `vibe.effectGlobals: false` / `vibe.effectModules: false`.
5. **`A!E!R` means `Effect.Effect<A, E, R>`.** Empty or omitted slots are `never`, never inferred. Omit the return annotation to infer all three channels. Avoid the retired bare `Effect<A, E, R>` alias (`EK4856`).

## Call VibeLang from TypeScript

Compile `.vibe` and `.ts` together with `vibelang`. In `.ts`, import the relative `.vibe` module with its extension:

```vibe
// t5.vibe
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

TypeScript callers see `clampAll` as returning `Effect.Effect<number[], never, never>` via the generated `.d.vibe.ts` sidecar. Run it at your application boundary with `Effect.runSync` or `await Effect.runPromise(...)` after providing required services. Keep `rewriteRelativeImportExtensions: true` in `tsconfig.json`:

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

> **Optional calls (`EK0502`):** With `strictNullChecks`, narrow an optional Effect before running it:
> ```vibe
> effect function maybeLoad(load?: () => string!!) {
>   const program = load?.()
>   return program === undefined ? undefined : try program
> }
> ```

### Services and errors from TypeScript

A VibeLang `service` compiles to `Context.Service` and a VibeLang `error` compiles to `Data.TaggedError`. TypeScript callers implement the service shape via `Context.Service.Shape<typeof Users>`, provide it with `Layer.succeed`, and catch errors with `Effect.catchTag`:

```vibe
// users.vibe
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

Emitted `.d.vibe.ts` and `.d.ts` declarations match the Effect TypeScript you would write by hand, preserving `readonly` modifiers, `static readonly key`, and `@throws` JSDoc across package and project-reference boundaries.

## Translate the idioms

| In Effect TypeScript | In VibeLang |
| --- | --- |
| `Effect.gen(function* () { ... })` | `effect { ... }`, or an `effect` function with statements |
| `class NotFound extends Data.TaggedError("NotFound")<{ readonly id: string }> {}` | `error NotFound { id: string }` |
| `const User = Schema.Struct({ id: Schema.String })` and `type User = typeof User.Type` | `schema User { readonly id: string }` |
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
| `Effect.orElseSucceed(program, () => value)` | `program catch () => value` |
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
| `Effect.forkIn(program, scope)` | `try forkIn(program, scope)` |
| `Effect.forkDetach(program)` | `fork.detached program` |
| `Stream.runForEachWhile` | `for try (const value of stream) { ... }` |

`try result(program)` captures typed failures only; Defects and interruption propagate. `try exit(program)` captures the full cause in `Exit.Failure`, including defects and interruption.

Hand-written Effect TypeScript still compiles in `.vibe` files, with advisory warnings `EK4830`–`EK4837` where a VibeLang form exists ([TypeScript-style Effect code](../getting-started/012-devtools.md#typescript-style-effect-code)).

## Calls return Effects; programs stay cold

```vibe
// run: { const jsonValue = [try sequential(), try concurrent()]; try Console.log(try Effect.try(() => JSON.stringify(jsonValue))) }
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

An `effect` function binds parameters and defaults at call time and reruns its body on each execution. When you pass an unrun Effect to a generic helper like `expect(awaited(p))`, advisory `EK4802` reminds you to run `try awaited(p)` unless you intentionally want to assert on the Effect object itself.

## Preserve a factory's call-time work

When a TypeScript factory snapshots synchronous input before returning an Effect, keep it as a plain function returning `effect { ... }`:

```vibe
export const capture = (input: { value: number }): number!! => {
  const snapshot = input.value
  return effect { return snapshot }
}
```

Use `return effect { throw e }` where TypeScript returned `Effect.fail(e)` (plain `throw` in the outer function is `EK0401`). To re-run the factory on each retry attempt rather than retrying the same returned Effect, wrap with `suspend(() => make(config))`.

## Declare at the module top level

Module top level is ordinary JavaScript: top-level `await` awaits Promises, and `try` belongs inside an `effect` function or block. Start `main` explicitly with a runner:

```vibe
// start.vibe
export effect function main() {
  try Console.log("started")
}
await runPromise(main())
// Output: started
```

`var`, `eval`, `Function`, and `with` are disallowed in `.vibe` files (`EK0107`); keep code requiring them in a `.ts` module.

## Keep platform work in Effect

Host globals (`console.log`, `fetch`, `setTimeout`, `process`, `crypto.randomUUID()`) and `node:*` value imports are compile errors in `.vibe` (`EK4402`). Use Effect's services instead, and supply the platform layer once at `main`:

```vibe
// run: const clock = try Clock.Clock; provide Clock.Clock = { ...clock, currentTimeMillis: succeed(123), currentTimeMillisUnsafe: () => 123 } { try Console.log(try reportTime()) }
effect function reportTime() {
  const now = try Clock.currentTimeMillis
  try Console.log(now)
  return now
}
// Output: 123
// Output: 123
```

```vibe
// notes.vibe
import * as NodeServices from "@effect/platform-node/NodeServices"
import * as NodeRuntime from "@effect/platform-node/NodeRuntime"

export effect function main() {
  try scoped(effect {
    const fs = try FileSystem.FileSystem
    const path = try Path.Path
    const directory = try fs.makeTempDirectoryScoped()
    const file = path.join(directory, "note.txt")
    try fs.writeFileString(file, "saved")
    try Console.log(try fs.readFileString(file))
  })
}
NodeRuntime.runMain(Effect.provide(main(), NodeServices.layer))
// Output: saved
```

`NodeServices.layer` supplies `FileSystem`, `Path`, `Stdio`, `Terminal`, and `ChildProcessSpawner` (Bun uses `BunServices.layer`; `effect/crypto` uses `NodeCrypto.layer`; `HttpClient` uses `FetchHttpClient.layer`). See [Platform globals](../platform/platform-globals.md) and [Experimental platform APIs](118-experimental-platform-apis.md).

Foreign `.ts` functions declare throws with `@throws {ErrorType}` (unannotated defaults to `@throws {unknown}`); wrap throwing calls in `Effect.try` (`EK0403`) and Promises in `tryPromise` (`EK0404`). A callable returning an `Effect`, `Stream` or `Layer` is effectful: call it directly, regardless of `@throws`. Exported non-effectful VibeLang declarations automatically carry `@throws {never}`. The retired `trusted(predicate, [])` wrapper reports `EK0407`.

## Catch expected failures only

```vibe
// run: { const jsonValue = [try displayName("ada"), try displayName("missing")]; try Console.log(try Effect.try(() => JSON.stringify(jsonValue))) }
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

`catch` recovers expected failures only. Defects and interruption bypass `catch` while still running `ensuring`, `onExit`, and `scoped` finalizers.

## Trace and debug calls

Run emitted JavaScript with `node --enable-source-maps dist/main.js` and `"sourceMap": true`. VibeLang adds no hidden spans; attach spans where needed with `try withSpan(effect { ... }, "checkout")`. See [Debug stack traces](../getting-started/012-devtools.md#debug-stack-traces).

## Runtime cost

VibeLang forms compile to their Effect equivalents. They preserve the same `Exit` and finalizer order.

The [runtime cost benchmark](https://github.com/smithersai/vibelang/tree/main/docs/user/benchmarks/runtime-cost) produced this table with the 0.0.13 compiler built from commit `d8981f70`, Node 26.5.0 and Effect 4.1.1 on Linux x64. It ran on one shared server with an AMD EPYC 7443P 24-Core Processor and 48 logical CPUs while other jobs ran: the 1-minute load average was 39 at the start and 41 at the end. These are single-machine observations, not a performance guarantee.

Each loop ran in its own Node process: 2 untimed warm-up runs, then 10 timed runs, each one `Effect.runSync` call timed with `performance.now()`. The step increments a number and fails when the next value is a multiple of 250,000; recovery resets it to zero. The 200,000-call loops end before that failure. Run `node run.mjs` in the benchmark directory to measure your own machine.

| Loop | Min | Median | Max | Median per call |
| --- | ---: | ---: | ---: | ---: |
| 200,000 Effect-contracted VibeLang calls without `catch` | 228 ms | 246 ms | 376 ms | 1,229 ns |
| 200,000 `Effect.fn` generator calls | 524 ms | 527 ms | 532 ms | 2,634 ns |
| 1,000,000 `step(n) catch () => 0` expressions | 1,302 ms | 1,397 ms | 1,482 ms | 1,397 ns |
| 1,000,000 `Effect.succeed`/`Effect.fail` steps with `Effect.orElseSucceed` | 186 ms | 188 ms | 192 ms | 188 ns |
| 1,000,000 `plainStep(n)` plain-function calls from effect code | 0.8 ms | 0.9 ms | 0.9 ms | 0.9 ns |

`Effect.fn` generator calls took about 2 times as long as Effect-contracted VibeLang calls; each `Effect.fn` call also captures a call-site stack frame. The `catch` loop took about 7 times as long as the hand-written `Effect.orElseSucceed` loop. Its step is a generator-based effect function, the same step as in the first row, and the compiled `catch` evaluates the operand and the handler inside `Effect.sync`; the `orElseSucceed` step returns `Effect.succeed` or `Effect.fail` directly. A plain function, `plainStep(n: number): number`, adds no Effect wrapper, and effect code calls it directly. Measure your own workload, including tracing, before choosing a boundary for a hot loop.

See [Handlers (open proposal, not in the alpha)](111-control-operations-and-handlers.md) for the status of algebraic handlers.
