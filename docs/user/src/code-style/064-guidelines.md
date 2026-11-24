# Guidelines

A VibeLang program runs through a single platform runtime at its entry point, scopes shared resources in `main`, and passes explicit lambdas to callbacks. Following these three rules keeps signal handling and cleanup predictable and prevents silent argument forwarding.

## Running application entry points

```vibe
// main.vibe
import * as NodeRuntime from "@effect/platform-node/NodeRuntime"

export effect function main() {
  try ensuring(effect {
    try Console.log("worker started")
    try sleep("2 seconds")
    try Console.log("checking work")
  }, Console.log("worker stopped"))
}

NodeRuntime.runMain(main())
```

```output
worker started
checking work
worker stopped
```

Calling `main()` builds an Effect without executing it; `NodeRuntime.runMain(main())` starts execution and handles OS signals, interruption, and graceful shutdown. Wrap cleanup in `ensuring`, manage application resources in `scoped(effect { ... })`, and provide the application layer once around the top-level Effect so services share a single lifetime.

This example exits after one check; place repeated work in a loop to keep a process alive until Ctrl-C interrupts it. Use `runPromise` only when an external host owns the process lifecycle and expects a Promise. Keep application logic inside effect functions—reserve module top-level code for building values, registering framework callbacks, or invoking the runner—and write tests with `it.effect("name", () => effect { ... })`.

## Selecting a platform runtime

```vibe
// main.vibe
import * as BunRuntime from "@effect/platform-bun/BunRuntime"

effect function main() {
  try Console.log("running on Bun")
}

BunRuntime.runMain(main())
```

```output
running on Bun
```

Match the runtime package to the target host and pin it to VibeLang's Effect version. The starter template already depends on `@effect/platform-node`; for Bun, install `@effect/platform-bun` with `bun add --exact @effect/platform-bun@4.1.1` or `npm install --save-exact @effect/platform-bun@4.1.1`. Program logic still targets Effect services rather than host-specific APIs.

| Host | Entry runner | Package |
| --- | --- | --- |
| Node.js | `NodeRuntime.runMain` | `@effect/platform-node/NodeRuntime` |
| Bun | `BunRuntime.runMain` | `@effect/platform-bun/BunRuntime` |
| Browser | `BrowserRuntime.runMain` | `@effect/platform-browser/BrowserRuntime` |

## Making argument forwarding explicit

```vibe
// run: try Console.log(try Effect.try(() => JSON.stringify(parseDecimalTokens(["10", "10", "10"])))); try printValues([10, 20])
function parseDecimalTokens(tokens: ReadonlyArray<string>) {
  return tokens.map((text) => Number.parseInt(text, 10))
}
// parseDecimalTokens(["10", "10", "10"]) returns [10, 10, 10].

effect function printValues(values: ReadonlyArray<number>) {
  try forEach(values, (value) => Console.log(value), { discard: true })
}
// Output: [10,10,10]
// Output: 10
// Output: 20
```

Wrap functions in explicit lambdas when passing callbacks. Passing `Number.parseInt` directly to `Array.prototype.map` forwards the element index as its radix; an explicit arrow locks in the intended arguments, stabilizes overload selection, and keeps generic inference clear.

For effectful iteration, use `forEach` or an ordinary loop. Plain JavaScript collection callbacks such as `Array.prototype.map` can construct Effects but cannot execute them with `try`.

## Coming from Effect

An `effect function` defines the application Effect, `try` sequences steps, and `ensuring` and `scoped` handle finalization. Keep `runMain` at the process boundary and pass it the Effect returned by `main()`.
