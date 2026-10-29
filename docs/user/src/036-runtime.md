# Introduction to Runtime

Effect's runtime executes computations, carries service implementations, schedules fibers, and runs cleanup. VibeLang runs on it; effect functions express the work.

## Execution infrastructure

```vibe
// pending: VIP-1, VIP-5, VIP-6, VIP-14, VIP-26
// run: const result = try promise(() => outcome); try Console.log(result._tag); if (Exit.isSuccess(result)) try Console.log(result.value)
effect function operation() {
  try sleep("10 millis")
  return "complete"
}

const outcome = Effect.runPromiseExit(operation())
// Output: Success
// Output: complete
```

A runner starts a root fiber with its context, fiber-local settings, and initial program. The runtime steps through the work, waits for asynchronous results, coordinates interruption, and runs finalizers. `outcome` is a promise of an `Exit` holding the success or the complete failure cause.

Calling an effect function returns an unrun Effect. `try` inside `operation` runs it on the same fiber; concurrency needs an explicit operator.

## Run with an explicit service context

```vibe
// pending: VIP-1, VIP-3, VIP-5, VIP-9, VIP-14, VIP-26
// run: try Console.log(result)
service Labels {
  format(value: string): string!!
}

const context = Context.make(Labels, {
  format: effect (value) => `[${value}]`
})

effect function label() {
  const labels = try Labels
  return try labels.format("queued")
}

const result = Effect.runSyncWith(context)(label())
// Output: [queued]
```

`Context.make` pairs a service key with its implementation. The `run*With` variants take that context and run a program whose requirements it satisfies; `runPromiseWith` and `runForkWith` serve asynchronous and fiber-based entry points. Plain runners require no remaining application services.

Call runners only where no fiber runs the code: a module's top level, or a plain callback registered there with a TypeScript host. A runner call inside a running program is EK1005; run the Effect with `try` or use `fork`.

Most applications build their context from layers. Use an explicit context when the host already has one, or a managed runtime when several entry points must share layer resources.

## Change runtime behavior within a region

```vibe
// pending: VIP-1, VIP-5, VIP-6, VIP-12, VIP-14
// run: try Effect.provide(startup(), Logger.layer([Logger.make(({ message }) => console.log(...(message as unknown[])))]))
const Quiet = Logger.layer([])

effect function startup() {
  try log("visible before")
  provide Quiet {
    try log("suppressed in this region")
  }
  try log("visible after")
}
// Output: visible before
// Output: visible after
```

`Effect.provide` installs the layer only around its program and restores the previous logger configuration afterward, even on failure. Nested regions can override it again; child fibers inherit the configuration in effect when they start.

For another format, supply a logger such as `Logger.consoleJson` through `Logger.layer([Logger.consoleJson])`; it uses Effect's console integration, not a browser or Node global.

## Replace a runtime service for a block

```vibe
// pending: VIP-1, VIP-3, VIP-5, VIP-12, VIP-14
// run: try Console.log(try roll())
const seeded = { nextIntUnsafe: (): number => 4, nextDoubleUnsafe: (): number => 0.5 }

effect function roll(): number!! {
  provide Random.Random = seeded {
    return try Random.nextInt
  }
}
// Output: 4
```

`provide Key = value` provides one service to a block. `Random`, `Clock`, and `Scheduler` are references: each has a default, so none appears in a contract's dependencies, and a provide block replaces the default for its statements and the fibers they start. Use each module's service key: `provide Random.Random = seeded` provides the random source, `provide Clock.Clock = testClock` replaces the clock `sleep` reads, and `provide Scheduler.Scheduler = fifo` runs the block's fibers on another scheduler. Layers and services share one list: `provide Logger.layer([]), Random.Random = seeded { ... }`.

## Build and dispose managed runtimes

```vibe
// notifications.vibe
// pending: VIP-1, VIP-3, VIP-5, VIP-9, VIP-12, VIP-14
// run: provide Notifications.layer { try notify("direct event") }
export service Notifications {
  send(message: string): void!!

  static readonly layer = Layer.succeed(Notifications, {
    send: (message) => Console.log(message)
  })
}

export effect function notify(message: string) {
  const notifications = try Notifications
  try notifications.send(message)
}
// Output: direct event
```

```ts
// TypeScript (.ts)
// host.ts
// run: return example()
import { ManagedRuntime } from "effect"
import { Notifications, notify } from "./notifications.js"

const runtime = ManagedRuntime.make(Notifications.layer)

export async function example() {
  try {
    await runtime.runPromise(notify("first event"))
    await runtime.runPromise(notify("second event"))
  } finally {
    await runtime.dispose()
  }
}
// Output: first event
// Output: second event
```

`ManagedRuntime.make` builds its layer lazily on first use and shares the context across executions; the layer's resources live until disposal, not until each call completes. Dispose the runtime when its owner shuts down, and create a fresh one for a new owner.

Each `Effect.provide` builds its layers once per invocation, so repeating `provide` at several entry points rebuilds them; a managed runtime avoids that for shared pools or clients. For Effect-based cleanup, `runtime.disposeEffect` is an Effect value that runs with `try runtime.disposeEffect` in `.vibe`.

## Connect runtime execution to frameworks

```ts
// TypeScript (.ts)
// notification-host.ts
// run: const host = makeNotificationHost(); return host.onMessage("framework event").finally(() => host.close())
import { ManagedRuntime } from "effect"
import { Notifications, notify } from "./notifications.js"

export function makeNotificationHost() {
  const runtime = ManagedRuntime.make(Notifications.layer)
  return {
    onMessage: (message: string) => runtime.runPromise(notify(message)),
    close: () => runtime.dispose()
  }
}
// Output: framework event
```

The framework owns this adapter: call `onMessage` at an entry point and `close` when the application, test fixture, or component owner ends. Its promise reports failures to the host. Keep the runtime stable across repeated requests or renders so layer resources stay shared.

Framework callbacks can stay in TypeScript and import the emitted VibeLang functions, as above. A plain framework callback registered from a `.vibe` module's top level can also call `runtime.runPromise(notify(message))`: it runs outside a fiber, and the runner supplies the boundary to the application program.

## Coming from Effect

`service` declarations replace hand-written `Context.Service` declarations in `.vibe`. The runtime, context, layers, and managed runtime stay Effect's APIs; TypeScript boundary code still passes cold Effects to their runners.

[Upstream Effect page](https://effect.website/docs/v4/runtime)
