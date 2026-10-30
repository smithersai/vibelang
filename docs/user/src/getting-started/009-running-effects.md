# Running Effects

Runners start a program at an application boundary. Inside an effect function, `try` runs an Effect on the current fiber, so reserve runners for entry points and framework adapters. `try` before a value that is not an Effect, such as a number or a promise, is `EK0502`: drop the `try`, or wrap a promise with `Effect.tryPromise`.

Call a runner at module top level, in an `async` function, or in a plain callback registered there with a TypeScript function, such as a `describe` body or framework route handler. A runner inside code a fiber runs is EK1005; run the Effect with `try` or use `fork` instead. Tests in `.vibe` use `it.effect` from `@effect/vitest`; Promise-style tests stay in `.ts`.

An effect function at the top level builds an Effect without running it:

```vibe
// pending: VIP-1, VIP-5, VIP-14
export const migrate = effect () => {
  try Console.log("migrating")
}
```

Importing this module prints nothing. Calling `migrate()` builds an Effect; run it with `try migrate()` inside an effect function, or pass `migrate()` directly to a runner at module top level.

An object-literal field can hold an effect function:

```vibe
// pending: VIP-1, VIP-3
interface Journal { read(): number!! }
const makeNoop = (): Journal => ({ read: effect () => 0 })
```

Constructing the object runs nothing; `journal.read()` returns an Effect, and `try journal.read()` runs it. Write a `Layer.sync` service literal's members the same way, `{ read: effect () => { return try work() } }`. A plain field stores the value its initializer returns, including an unrun Effect when the initializer calls an effect function.

Running the same Effect again starts a fresh execution of its body. Objects passed by the caller keep their identity; changing their contents remains visible to later executions. A factory that explicitly returns an Effect keeps the outer state it captured when called.

## Build and run a local project

After [installing and scaffolding](004-installation.md), use the starter scripts:

```sh
bun run build
bun run start
bun run dev
bun run test
```

`build` runs `vibelang` with the project's `tsconfig.json`. `start` builds, then runs `node --enable-source-maps dist/main.js`. `dev` builds once, then runs `vibelang --watch` beside `node --watch --enable-source-maps dist/main.js`. `test` runs Vitest on `src/**/*.test.vibe` through `vibelang-vite`, which compiles the project with `vibelang` and serves the JavaScript, so tests need no prior build. Node and Vitest receive JavaScript; neither interprets `.vibe` sources.

The starter's `main.vibe` exports an effect function named `main` and calls `NodeRuntime.runMain(main())` at module top level, the application boundary reached by `node dist/main.js`. Its greeting and recovery messages quickly confirm that the service layer and typed failure both run.

## Execute synchronous computations

```vibe
// pending: VIP-1, VIP-5, VIP-14, VIP-26
// run: try Console.log(total)
effect function subtotal() {
  return 7 * 8
}

const total = Effect.runSync(subtotal())
// total: number, 56
// Output: 56
```

`Effect.runSync` starts the program immediately and returns its result; an unhandled failure or defect escapes as a JavaScript exception at this boundary. If execution reaches asynchronous work, the runner throws `AsyncFiberError`, so use it only when the whole computation is known to stay synchronous.

## Run promise-based computations

```vibe
// pending: VIP-1, VIP-5, VIP-6, VIP-14, VIP-26
// run: try Console.log(try promise(() => pending))
effect function preparedMessage() {
  try sleep("15 millis")
  return "prepared"
}

const pending = Effect.runPromise(preparedMessage())
// pending: Promise<string>
// Output: prepared
```

`Effect.runPromise` starts execution and returns a promise for the success value, which rejects when the program fails. A foreign TypeScript caller can await that promise; a VibeLang caller runs `try preparedMessage()` inside its own effect function.

## Collect complete execution results

```vibe
// pending: VIP-1, VIP-4, VIP-5, VIP-13, VIP-14, VIP-26
// run: try Console.log(immediate._tag)
error BadInput

effect function validate(input: string) {
  if (input === "") throw new BadInput()
  return input.length
}

const immediate = Effect.runSyncExit(validate(""))
const eventual = Effect.runPromiseExit(preparedMessage())
// immediate: Exit<number, BadInput>
// eventual: Promise<Exit<string, never>>
// Output: Failure
```

An `Exit` is a success with a value or a failure with a `Cause`, which keeps expected failures, defects, and interruption instead of reducing them to an ordinary error value. `runSyncExit` reports asynchronous execution as a defect in its failure result; `runPromiseExit` supports work that pauses.

## Start and interrupt a fiber

```vibe
// pending: VIP-1, VIP-2, VIP-5, VIP-6, VIP-14, VIP-26
// run: try Console.log(Exit.isFailure(try Fiber.await(running)))
effect function heartbeat() {
  try repeat(log("alive"), Schedule.spaced("200 millis"))
}

const running = Effect.runFork(Effect.provide(heartbeat(), Logger.layer([])))

Effect.runPromise(effect {
  try sleep("650 millis")
  try Fiber.interrupt(running)
})
// Output: true
```

The empty logger layer keeps this heartbeat quiet. `Effect.runFork` returns a running `Fiber` to join, observe, or interrupt; `Fiber.interrupt` waits for its cleanup. Here a second runner acts as an external owner; in application logic, use `fork heartbeat()` and let the current fiber bound its lifetime.

## Select an application boundary

```vibe
// main.vibe
// pending: VIP-1, VIP-5, VIP-14, VIP-26
import * as NodeRuntime from "@effect/platform-node/NodeRuntime"

export effect function main() {
  try Console.log("application started")
}
NodeRuntime.runMain(main())
// node main.js loads the module and calls NodeRuntime.runMain
// Output: application started
```

A module calls its runner explicitly. `main()` returns an Effect whether `main` is a function declaration or an effect arrow. `NodeRuntime.runMain(main())` follows Node's shutdown conventions. Import `NodeRuntime` from `@effect/platform-node/NodeRuntime`; the runner can receive a provided Effect, `NodeRuntime.runMain(Effect.provide(main(), NodeServices.layer))`, with `NodeServices` imported from `@effect/platform-node/NodeServices`. A browser entry calls `BrowserRuntime.runMain(Effect.provide(main(), layer))` at its top level, as [Starting main in a browser](../platform/105-introduction.md#starting-main-in-a-browser) shows. Top-level `await runPromise(main())` is another explicit boundary. Supply the application layer once around `main`: a runner needs all application requirements satisfied. For several framework entry points sharing services, use [ManagedRuntime](../036-runtime.md).

| Runner | Result |
| --- | --- |
| `Effect.runSync` | `A` |
| `Effect.runSyncExit` | `Exit<A, E>` |
| `Effect.runPromise` | `Promise<A>` |
| `Effect.runPromiseExit` | `Promise<Exit<A, E>>` |
| `Effect.runFork` | `Fiber<A, E>` |

The three contract channels do not say whether work runs synchronously. Prefer an asynchronous runner unless the host requires a synchronous answer and the operation can give one.

## Coming from Effect

In `.vibe` and TypeScript files, pass the runner an Effect directly, as in `runPromise(main())`. Calling an exported effect function returns that Effect without running it.

[Upstream Effect page](https://effect.website/docs/v4/getting-started/running-effects)
