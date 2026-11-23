# TestClock

Testing a 30-second timeout or a 15-minute refresh loop against real wall-clock time makes tests slow and flaky. `TestClock` replaces live time with a deterministic virtual clock that starts at `0` and **only moves when your test explicitly advances it**—so a 15-minute schedule finishes in milliseconds and never races against CPU load. `TestClock` comes from `effect/testing` and is in scope in `.vibe` without an import.

![Deterministic virtual time with TestClock](/diagrams/testclock-time-travel.svg)

## Step 1: Configure the test runner

The [starter](../getting-started/004-installation.md) comes preconfigured with Vitest 5.1.0, `@effect/vitest` 4.1.1, and the `vibelang-vite` plugin. Running `bun run test` compiles and executes `src/**/*.test.vibe` directly—no separate `dist/` build required. Point the plugin at `tsconfig.test.json` (which includes test files excluded from production builds) inside TypeScript config:

```ts
// TypeScript (.ts)
// vitest.config.ts
import { defineConfig } from "vitest/config"
import vibelang from "vibelang-vite"

export default defineConfig({
  plugins: [vibelang({ project: "tsconfig.test.json" })],
  test: { include: ["src/**/*.test.vibe"] }
})
```

Register `it.effect` at module top level or inside `describe`, passing a callback that returns an Effect (`() => effect { ... }`).

## Step 2: Wrap assertions with `Effect.try`

Use Effect's test primitives—`it.effect`, `it.live`, `layer`, and `TestClock`—rather than hand-rolled test harnesses.

**Watch out for throwing assertions:** Vitest's `assert`, `expect`, and `vi` (including the copies re-exported by `@effect/vitest`) are plain functions that throw on failure without `@throws` annotations, so VibeLang treats them as potentially throwing `unknown` ([Bridging synchronous code](../getting-started/005-creating-effects.md#4-bridging-synchronous-code-that-may-throw-effecttry)). Calling `expect(sum).toBe(7)` directly inside an `effect` block triggers compiler error `EK0403`, and `sync` only accepts non-throwing functions. Wrap assertions in `try Effect.try(() => ...)`:

```vibe
import { assert, expect, it } from "@effect/vitest"

effect function total(prices: ReadonlyArray<number>) {
  return prices.reduce((sum, price) => sum + price, 0)
}

// Output:
it.effect("totals a cart", () => effect {
  const sum = try total([3, 4])
  try Effect.try(() => expect(sum).toBe(7))
  try Effect.try(() => assert.isAbove(sum, 0))
})
```

When an assertion throws, `Effect.try` converts it into an `UnknownError` that fails the test, and source maps point the failure directly to the `.vibe` line. The next examples tuck `assert.isTrue` behind a tiny `check` helper for readability.

## Step 3: Fork first, then advance virtual time

Here is the single most important rule of `TestClock`: **virtual time never moves on its own.** If your test fiber calls `try sleep("30 seconds")` directly, the test fiber suspends forever waiting for a clock adjustment it is now blocked from making!

Instead, follow the three-step rhythm:
1. **`fork`** the timed computation onto a child fiber.
2. **`try TestClock.adjust(...)`** (or `TestClock.setTime(...)`) on the test fiber to jump virtual time forward.
3. **`join`** the child fiber (or await its `Queue` / `Deferred`) and assert the result.

```vibe
import { assert, it } from "@effect/vitest"

effect function check(condition: boolean, message: string) {
  try Effect.try(() => assert.isTrue(condition, message))
}

// Output:
it.effect("a deadline returns the fallback", () => effect {
  const pending = fork timeoutOrElse(effect {
    try sleep("10 minutes")
    return Option.some("finished")
  }, {
    duration: "30 seconds",
    orElse: () => succeed(Option.none<string>())
  })

  try TestClock.adjust("30 seconds")
  const result = join pending
  try check(Option.isNone(result), "expected the timeout fallback")
})
```

`it.effect` installs Effect's test services automatically—`TestClock` included. `TestClock.adjust(duration)` advances the clock incrementally and wakes every sleeper whose deadline falls within that window; `TestClock.setTime(millis)` jumps to an absolute timestamp. The test fiber supervises `pending` and interrupts it automatically if the test exits early.

| Context | How `TestClock` is installed |
| --- | --- |
| Inside `it.effect(...)` | Provided automatically by `@effect/vitest` |
| Inside `it.live(...)` | Uses live wall-clock `Clock` instead of `TestClock` |
| Outside Vitest / standalone scripts | Wrap with `provide TestClock.layer() { ... }` |

```vibe
// run: try Console.log(try standaloneClockExample())
effect function standaloneClockExample() {
  provide TestClock.layer() {
    try TestClock.setTime(5_000)
    try TestClock.adjust("2 seconds")
    return try Clock.currentTimeMillis // 7000
  }
}
```

```output
7000
```

## Testing recurring loops step by step

Recurring jobs schedule their *next* sleep only after the previous iteration wakes up. Advance the clock to each boundary—and test one minute *before* the boundary too—so you prove the work fires neither too early nor twice:

```vibe
import { it } from "@effect/vitest"

// Output:
it.effect("emits once per interval", () => scoped(effect {
  const queue = try Queue.unbounded<string>()
  const worker = fork.scoped effect {
    while (true) {
      try sleep("15 minutes")
      try Queue.offer(queue, "refresh")
    }
  }

  try TestClock.adjust("14 minutes")
  try check(Option.isNone(try Queue.poll(queue)), "refresh arrived early")

  try TestClock.adjust("1 minute")
  try check((try Queue.take(queue)) === "refresh", "missing first refresh")
  try check(Option.isNone(try Queue.poll(queue)), "duplicate refresh")

  try TestClock.adjust("15 minutes")
  try check((try Queue.take(queue)) === "refresh", "missing second refresh")
  try check(Option.isNone(try Queue.poll(queue)), "duplicate second refresh")
}))
```

(Reuses `check` from the example above.) Notice two clean testing habits here:
- A `Queue` turns background iterations into deterministic, inspectable events without relying on real delays.
- `scoped` + `fork.scoped` guarantees the infinite `while (true)` worker is interrupted cleanly the moment the test finishes.

## Checking exact clock boundaries

Application code must read time through `try Clock.currentTimeMillis`, never `Date.now()` or `new Date()`—those read the OS wall clock and ignore `TestClock`.

```vibe
import { it } from "@effect/vitest"

effect function isExpired(createdAt: number, lifetimeMillis: number) {
  return (try Clock.currentTimeMillis) - createdAt >= lifetimeMillis
}

// Output:
it.effect("expires at the boundary", () => effect {
  const createdAt = try Clock.currentTimeMillis
  try TestClock.adjust("9 seconds")
  try check(!(try isExpired(createdAt, 10_000)), "expired too soon")
  try TestClock.adjust("1 second")
  try check(try isExpired(createdAt, 10_000), "should expire at ten seconds")
})
```

Stepping to `9 seconds` and then `1 second` catches off-by-one bugs (`>` vs `>=`) that a single coarse jump past the deadline would miss.

## Synchronizing delayed outcomes with `Deferred`

Advancing `TestClock` wakes sleepers, and forking only proves a worker *started*—always synchronize on the observable outcome (`Deferred.await` or `join`) before asserting:

```vibe
import { it } from "@effect/vitest"

// Output:
it.effect("completes a deferred after a delay", () => scoped(effect {
  const ready = try Deferred.make<number>()
  const worker = fork.scoped effect {
    try sleep("6 seconds")
    try Deferred.succeed(ready, 42)
  }

  try TestClock.adjust("6 seconds")
  const value = try Deferred.await(ready)
  join worker
  try check(value === 42, "unexpected deferred value")
}))
```

After `TestClock.adjust("6 seconds")`, `try Deferred.await(ready)` blocks until the worker finishes publishing `42`, and `join worker` confirms the background fiber exited cleanly before the test asserts the result.
