import { expect, test } from "bun:test"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as Stream from "effect/Stream"
import * as fc from "fast-check"
import { MediaQuery } from "vibelang-runtime/experimental"
import { ExperimentalBrowserMediaQuery, ExperimentalBrowserServices } from "vibelang-runtime/experimental/platform-browser"

// A MediaQueryList whose owner changes its state, as the host does when the viewport or a preference changes.
const fakeList = (initial: boolean) => {
  const listeners = new Set<(event: { readonly matches: boolean }) => void>()
  return {
    listeners,
    matches: initial,
    addEventListener: (_type: "change", listener: (event: { readonly matches: boolean }) => void) => {
      listeners.add(listener)
    },
    removeEventListener: (_type: "change", listener: (event: { readonly matches: boolean }) => void) => {
      listeners.delete(listener)
    },
    change(matches: boolean) {
      this.matches = matches
      for (const listener of listeners) listener({ matches })
    }
  }
}

const hostOf = (list: ReturnType<typeof fakeList>, seen: Array<string> = []) => ({
  matchMedia: (query: string) => {
    seen.push(query)
    return list
  }
})

test("MediaQuery: matches reads the query when it runs, not when it is built", async () => {
  const list = fakeList(false)
  const seen: Array<string> = []
  const read = MediaQuery.make(hostOf(list, seen)).matches("(min-width: 1px)")
  expect(seen).toEqual([])
  expect(await Effect.runPromise(read)).toBe(false)
  list.matches = true
  expect(await Effect.runPromise(read)).toBe(true)
  expect(seen).toEqual(["(min-width: 1px)", "(min-width: 1px)"])
})

test("MediaQuery: changes reads the query when the Stream starts, then each change, and a restart reads again", async () => {
  const list = fakeList(true)
  const seen: Array<string> = []
  const changes = MediaQuery.make(hostOf(list, seen)).changes("(prefers-color-scheme: dark)")
  expect(seen).toEqual([])
  const first = await Effect.runPromise(Effect.gen(function*() {
    const fiber = yield* Effect.forkChild(Stream.runCollect(Stream.take(changes, 3)))
    yield* Effect.yieldNow
    while (list.listeners.size === 0) yield* Effect.yieldNow
    list.change(false)
    list.change(true)
    return yield* Fiber.join(fiber)
  }))
  expect(first).toEqual([true, false, true])
  expect(list.listeners.size).toBe(0)
  list.matches = false
  expect(await Effect.runPromise(Stream.runCollect(Stream.take(changes, 1)))).toEqual([false])
  expect(seen).toHaveLength(2)
})

test("MediaQuery: interrupting the Stream removes its listener", async () => {
  const list = fakeList(true)
  await Effect.runPromise(Effect.gen(function*() {
    const fiber = yield* Effect.forkChild(Stream.runDrain(MediaQuery.make(hostOf(list)).changes("print")))
    while (list.listeners.size === 0) yield* Effect.yieldNow
    yield* Fiber.interrupt(fiber)
  }))
  expect(list.listeners.size).toBe(0)
})

test("MediaQuery: changes emits the initial value and every change in order, and leaves no listener", async () => {
  await fc.assert(fc.asyncProperty(fc.boolean(), fc.array(fc.boolean(), { maxLength: 20 }), async (initial, states) => {
    const list = fakeList(initial)
    const emitted = await Effect.runPromise(Effect.gen(function*() {
      const fiber = yield* Effect.forkChild(
        Stream.runCollect(Stream.take(MediaQuery.make(hostOf(list)).changes("q"), states.length + 1))
      )
      while (states.length > 0 && list.listeners.size === 0) yield* Effect.yieldNow
      for (const state of states) list.change(state)
      return yield* Fiber.join(fiber)
    }))
    expect(emitted).toEqual([initial, ...states])
    expect(list.listeners.size).toBe(0)
  }), { numRuns: 100 })
})

test("MediaQuery: the browser layer reads the host when a member runs, so a host without matchMedia fails only then", async () => {
  const host = globalThis as { matchMedia?: unknown }
  const service = Effect.service(MediaQuery.MediaQuery)
  const query = Effect.flatMap(service, (mediaQuery) => mediaQuery.matches("print"))
  expect(host.matchMedia).toBeUndefined()
  await Effect.runPromise(Effect.provide(Effect.asVoid(service), ExperimentalBrowserMediaQuery.layer))
  const missing = await Effect.runPromiseExit(Effect.provide(query, ExperimentalBrowserMediaQuery.layer))
  expect(missing._tag).toBe("Failure")
  expect(String(missing)).toContain("window.matchMedia")
  host.matchMedia = () => fakeList(true)
  try {
    expect(await Effect.runPromise(Effect.provide(query, ExperimentalBrowserMediaQuery.layer))).toBe(true)
  } finally {
    delete host.matchMedia
  }
})

test("MediaQuery: the browser bundle builds on a host without matchMedia, as a worker is", async () => {
  Object.defineProperty(globalThis.navigator, "locks", { configurable: true, value: {} })
  try {
    const service = Effect.service(MediaQuery.MediaQuery)
    await Effect.runPromise(Effect.provide(Effect.asVoid(service), ExperimentalBrowserServices.layer))
  } finally {
    delete (globalThis.navigator as { locks?: unknown }).locks
  }
})

test("MediaQuery: layerTest answers false, keeps changes open, and derives changes from a given matches", async () => {
  const defaults = Effect.flatMap(Effect.service(MediaQuery.MediaQuery), (service) =>
    Effect.all([service.matches("print"), Stream.runCollect(Stream.take(service.changes("print"), 1))]))
  expect(await Effect.runPromise(Effect.provide(defaults, MediaQuery.layerTest()))).toEqual([false, [false]])
  const given = MediaQuery.layerTest({ matches: (query) => Effect.succeed(query === "print") })
  expect(await Effect.runPromise(Effect.provide(defaults, given))).toEqual([true, [true]])
  const open = Effect.flatMap(Effect.service(MediaQuery.MediaQuery), (service) =>
    Effect.timeoutOption(Stream.runDrain(service.changes("print")), "10 millis"))
  expect((await Effect.runPromise(Effect.provide(open, MediaQuery.layerTest())))._tag).toBe("None")
})
