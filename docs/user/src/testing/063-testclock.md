# TestClock

`TestClock` replaces live time with time your test controls, so you can check sleeps, timeouts, recurring work, and clock reads without waiting for wall-clock time. It comes from `effect/testing` and needs no import.

## Configure the test runner

The [starter](../getting-started/004-installation.md) includes Vitest 5.0.5, `@effect/vitest` 4.1.0, and the local `vibelang-vite` plugin. `bun run test` compiles and runs `src/**/*.test.vibe` directly, with no prior `dist/` build. Keep configuration in TypeScript:

```ts
// TypeScript (.ts)
// vitest.config.ts
import { defineConfig } from "vitest/config"
import vibelang from "vibelang-vite"

export default defineConfig({
  plugins: [vibelang()],
  test: { include: ["src/**/*.test.vibe"] }
})
```

Register `it.effect` at the top level or inside `describe`; its callback returns an Effect, as in `() => effect { … }`. `assert` and `expect` from `@effect/vitest` are Effect package exports: an assertion may throw, so wrap it in `Effect.try`, as in `try Effect.try(() => assert.strictEqual(actual, expected))` or `try Effect.try(() => expect(actual).toBe(expected))`; `sync` takes only a function that can't throw. A failed assertion fails the Effect, which fails the test, and the plugin's maps point its stack at the original `.vibe` line. Import them from `@effect/vitest`. The examples below use a local `check` helper that works the same way.

Support for the new forms arrives with the compiler's VIP implementation.

## Controlling virtual time

```vibe
// pending: VIP-1, VIP-2, VIP-5, VIP-6, VIP-14, VIP-17, VIP-33
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

`it.effect` provides the test services, virtual time included. `adjust` advances by a duration and runs sleepers whose deadlines fall within it; `setTime` sets an absolute timestamp in milliseconds. Fork the timed work first so the test's own fiber stays free to adjust the clock. The test fiber owns `pending` and interrupts it if the test exits early.

```vibe
// pending: VIP-1, VIP-5, VIP-12, VIP-14, VIP-33
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

Outside the test harness, provide `TestClock.layer()` yourself. Real time passing does not advance the virtual clock. Sleeping on the test's own fiber before adjusting time leaves the test waiting for an adjustment it cannot make.

## Advancing recurring computations

```vibe
// pending: VIP-1, VIP-2, VIP-5, VIP-6, VIP-14, VIP-17, VIP-33
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

Use the `check` helper from the first example. Advancing to each boundary lets the loop schedule its next sleep before the next adjustment. The queue makes each recurrence observable without real-time delays, and the explicit scope interrupts the background loop when the test's Effect ends.

## Checking clock-dependent behavior

```vibe
// pending: VIP-1, VIP-2, VIP-5, VIP-14, VIP-33
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

Application code reads time with `Clock`: `try Clock.currentTimeMillis` reads the supplied clock, so it stays deterministic under the test layer. `Date.now()` and zero-argument `new Date()` read the real clock, so `TestClock` doesn't move them. Testing just before and at a boundary catches comparison mistakes that a later timestamp alone misses.

## Timed waits and deferred results

```vibe
// pending: VIP-1, VIP-2, VIP-5, VIP-6, VIP-14, VIP-17, VIP-33
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

The worker sleeps before completing, so the test checks delayed completion. After advancing time, wait for the Deferred with `try Deferred.await(ready)` or join the worker to synchronize with the observable outcome. A fork alone says work started, not that its result is ready.
