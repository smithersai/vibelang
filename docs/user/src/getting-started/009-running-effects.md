# Running Effects

An Effect does nothing until you run it, and there are only **two places** where execution happens.

1. **Inside an `effect` function** — use `try program` to run an Effect on the current fiber.
2. **At the application boundary** (module top level, HTTP handler, CLI entry) — call a **runner** once to kick off the fiber runtime.

![Blueprint vs execution: try runs inside an effect function; a runner starts execution once at the edge](/diagrams/cold-vs-running.svg)

Calling a runner directly inside an `effect` function is a compile error (`EK1005`): you are already on a fiber, so use `try` or `fork` instead. Similarly, `try` works only on Effects inside effect code (`EK0501` outside, `EK0502` on non-Effects).

## Choosing the right runner

| Runner | Returns | When to use |
| --- | --- | --- |
| `NodeRuntime.runMain(main())` | `void` (handles signals & exit codes) | **CLI tools and Node servers** (default choice) |
| `Effect.runPromise(program)` | `Promise<A>` | Integrating with `async`/Promise frameworks or top-level `await` |
| `Effect.runPromiseExit(program)` | `Promise<Exit<A, E>>` | Need full `Cause` (errors, defects, interruption) without throwing |
| `Effect.runSync(program)` | `A` | Guaranteed synchronous code only (throws `AsyncFiberError` if async) |
| `Effect.runSyncExit(program)` | `Exit<A, E>` | Synchronous boundary that inspects the full `Exit` |
| `Effect.runFork(program)` | `Fiber<A, E>` | Start background work at the edge and control/interrupt it later |

> **Golden rule:** Every runner requires `R = never`. Provide your application's layers once at the edge (`provide AppLive { ... }` or `Effect.provide(main(), AppLive)`) before calling a runner.

## Application entry point (`NodeRuntime.runMain`)

A VibeLang module has no magic auto-run entry point — calling `main()` builds an Effect, and `NodeRuntime.runMain(main())` starts it and wires `SIGINT`/`SIGTERM` shutdown cleanly:

```vibe
// main.vibe
import * as NodeRuntime from "@effect/platform-node/NodeRuntime"

export effect function main() {
  try Console.log("application started")
}

NodeRuntime.runMain(main())
// Output: application started
```

With platform services: `NodeRuntime.runMain(Effect.provide(main(), NodeServices.layer))`. In a browser, call `BrowserRuntime.runMain(Effect.provide(main(), layer))` ([Starting main in a browser](../platform/105-introduction.md#starting-main-in-a-browser)). When multiple framework route handlers need to share one long-lived service graph, use [ManagedRuntime](../036-runtime.md).

### Starter scripts

After scaffolding with `create vibelang` ([Installation](004-installation.md)):

```sh
bun run build   # Compile .vibe -> dist/ JS + .vibe/declarations/
bun run start   # Build and run node --enable-source-maps dist/main.js
bun run dev     # Watch-compile and auto-restart Node on change
bun run test    # Run Vitest on src/**/*.test.vibe via vibelang-vite
```

## Synchronous execution (`Effect.runSync`)

Use `runSync` only when you know the entire program completes synchronously:

```vibe
// run: try Console.log(total)
effect function subtotal() {
  return 7 * 8
}

const total = Effect.runSync(subtotal())
// total: number (56)
// Output: 56
```

If any step suspends (like `sleep` or I/O), `runSync` throws `AsyncFiberError`.

## Promise execution (`Effect.runPromise`)

For async work or Promise-based callers, `runPromise` executes the Effect and resolves to `A` (or rejects on failure):

```vibe
// run: try Console.log(try promise(() => pending))
effect function preparedMessage() {
  try sleep("15 millis")
  return "prepared"
}

const pending = Effect.runPromise(preparedMessage())
// pending: Promise<string>
// Output: prepared
```

## Inspecting full outcomes (`runSyncExit` / `runPromiseExit`)

To keep typed failures, defects, and interruption intact as data instead of throwing at the boundary, use the `Exit` variants:

```vibe
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

## Background edge fibers (`Effect.runFork`)

`runFork` starts a fiber immediately and returns a handle you can observe or interrupt:

```vibe
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

Inside application logic (already in an `effect` function), use `fork heartbeat()` instead of `Effect.runFork` so the child fiber's lifetime is tied to its parent.

## Cold values and re-running

Storing an Effect in a `const` or an object field executes nothing:

```vibe
export const migrate = effect () => {
  try Console.log("migrating")
}

interface Journal { read(): number!! }
const makeNoop = (): Journal => ({ read: effect () => 0 })
```

Importing this module prints nothing. Running the same Effect value twice executes its body fresh each time. In tests, use `it.effect` from `@effect/vitest` rather than manual runners.

> **Operator precedence tip (`EK0510`):** Parenthesize `try` before exponentiation: `(try program) ** 2`.

## Coming from Effect

Pass the returned Effect straight to any runner: `runPromise(main())` or `NodeRuntime.runMain(main())`. Inside `.vibe` files, `runSync`, `runPromise`, `runSyncExit`, `runPromiseExit`, and `runFork` are also in scope without the `Effect.` prefix.

[Upstream Effect page](https://effect.website/docs/v4/getting-started/running-effects)
