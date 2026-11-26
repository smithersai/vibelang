import { expect, test } from "bun:test"
import * as Effect from "effect/Effect"
import * as Stream from "effect/Stream"
import * as Observer from "vibelang-runtime/experimental/IntersectionObserver"
import { ExperimentalBrowserIntersectionObserver } from "vibelang-runtime/experimental/platform-browser"

const target = {} as Element
const options: IntersectionObserverInit = { threshold: [0, 1] }

test("observes lazily, forwards options, preserves delivery order and disconnects each subscription", async () => {
  const first = [{ time: 1 }, { time: 2 }] as IntersectionObserverEntry[]
  const second = [{ time: 3 }] as IntersectionObserverEntry[]
  let created = 0
  let disconnected = 0
  const service = Observer.make({
    makeObserver(callback, init) {
      created++
      expect(init).toBe(options)
      return {
        observe(node) {
          expect(node).toBe(target)
          callback(first)
          callback(second)
        },
        disconnect() { disconnected++ }
      }
    }
  })
  const stream = service.observe(target, options)
  expect(created).toBe(0)
  for (const count of [1, 2]) {
    const entries = await Effect.runPromise(Stream.runCollect(Stream.take(stream, 3)))
    expect(entries).toEqual([...first, ...second])
    expect(disconnected).toBe(count)
    expect(created).toBe(count)
  }
})

test("disconnects when the native observe call throws", async () => {
  let disconnected = 0
  const service = Observer.make({ makeObserver: () => ({
    observe() { throw new Error("observe failed") },
    disconnect() { disconnected++ }
  }) })
  await expect(Effect.runPromise(Stream.runDrain(service.observe(target, options)))).rejects.toThrow("observe failed")
  expect(disconnected).toBe(1)
})

test("browser stream disconnects an idle observer when the consumer is interrupted", async () => {
  const service = Effect.runSync(Effect.provide(Observer.IntersectionObserver, ExperimentalBrowserIntersectionObserver.layer))
  const previous = Object.getOwnPropertyDescriptor(globalThis, "IntersectionObserver")
  const started = Promise.withResolvers<void>()
  let disconnected = 0
  class NativeObserver {
    observe() { started.resolve() }
    disconnect() { disconnected++ }
  }
  Object.defineProperty(globalThis, "IntersectionObserver", { configurable: true, value: NativeObserver })
  const controller = new AbortController()
  try {
    const result = Effect.runPromiseExit(Stream.runDrain(service.observe(target, options)), { signal: controller.signal })
    await started.promise
    expect(disconnected).toBe(0)
    controller.abort()
    expect((await result)._tag).toBe("Failure")
    expect(disconnected).toBe(1)
  } finally {
    controller.abort()
    if (previous) Object.defineProperty(globalThis, "IntersectionObserver", previous)
    else Reflect.deleteProperty(globalThis, "IntersectionObserver")
  }
})
