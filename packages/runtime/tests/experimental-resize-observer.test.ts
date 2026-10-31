import { expect, test } from "bun:test"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Scope from "effect/Scope"
import * as fc from "fast-check"
import { ResizeObserver } from "vibelang-runtime/experimental"
import { ExperimentalBrowserResizeObserver } from "vibelang-runtime/experimental/platform-browser"

const element = {} as Element

// An observer whose owner fires it, as the host does before a paint.
const fakeHost = () => {
  const live = new Set<{ fire: (entries: ReadonlyArray<ResizeObserverEntry>) => void; observed: Array<Element> }>()
  const host: ResizeObserver.Host = {
    makeObserver: (callback) => {
      const record = { fire: callback, observed: [] as Array<Element> }
      live.add(record)
      return {
        observe: (target) => void record.observed.push(target),
        disconnect: () => void live.delete(record)
      }
    }
  }
  return { host, live }
}

test("ResizeObserver: observe watches the element, runs the callback synchronously, and disconnects with the scope", async () => {
  const { host, live } = fakeHost()
  const seen: Array<number> = []
  await Effect.runPromise(Effect.scoped(Effect.gen(function*() {
    yield* ResizeObserver.make(host).observe(element, (entries) => seen.push(entries.length))
    const [record] = [...live]
    expect(record!.observed).toEqual([element])
    record!.fire([{} as ResizeObserverEntry])
    expect(seen).toEqual([1])
  })))
  expect(live.size).toBe(0)
})

test("ResizeObserver: an interrupted scope disconnects, for any number of observers", async () => {
  await fc.assert(fc.asyncProperty(fc.integer({ min: 0, max: 8 }), async (count) => {
    const { host, live } = fakeHost()
    const scope = await Effect.runPromise(Scope.make())
    const service = ResizeObserver.make(host)
    for (let i = 0; i < count; i++) {
      await Effect.runPromise(Scope.provide(service.observe(element, () => {}), scope))
    }
    expect(live.size).toBe(count)
    await Effect.runPromise(Scope.close(scope, Exit.void))
    expect(live.size).toBe(0)
  }), { numRuns: 30 })
})

test("ResizeObserver: the browser layer reads the host when a member runs", async () => {
  const host = globalThis as { ResizeObserver?: unknown }
  const original = host.ResizeObserver
  delete host.ResizeObserver
  const observe = Effect.scoped(Effect.flatMap(Effect.service(ResizeObserver.ResizeObserver), (service) => service.observe(element, () => {})))
  try {
    await Effect.runPromise(Effect.provide(Effect.service(ResizeObserver.ResizeObserver), ExperimentalBrowserResizeObserver.layer))
    const missing = await Effect.runPromiseExit(Effect.provide(observe, ExperimentalBrowserResizeObserver.layer))
    expect(Exit.isFailure(missing)).toBe(true)
    expect(String(missing)).toContain("window.ResizeObserver")
    const calls: Array<string> = []
    host.ResizeObserver = class {
      observe() {
        calls.push("observe")
      }
      disconnect() {
        calls.push("disconnect")
      }
    }
    await Effect.runPromise(Effect.provide(observe, ExperimentalBrowserResizeObserver.layer))
    expect(calls).toEqual(["observe", "disconnect"])
  } finally {
    if (original === undefined) delete host.ResizeObserver
    else host.ResizeObserver = original
  }
})

test("ResizeObserver: layerTest observes nothing, and takes the members a test needs", async () => {
  const seen: Array<Element> = []
  const observe = Effect.scoped(Effect.flatMap(Effect.service(ResizeObserver.ResizeObserver), (service) => service.observe(element, () => {})))
  await Effect.runPromise(Effect.provide(observe, ResizeObserver.layerTest()))
  const recording = ResizeObserver.layerTest({ observe: (target) => Effect.sync(() => void seen.push(target)) })
  await Effect.runPromise(Effect.provide(observe, recording))
  expect(seen).toEqual([element])
})
