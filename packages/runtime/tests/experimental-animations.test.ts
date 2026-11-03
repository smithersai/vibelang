import { expect, test } from "bun:test"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Fiber from "effect/Fiber"
import * as Stream from "effect/Stream"
import * as fc from "fast-check"
import { Animations } from "vibelang-runtime/experimental"
import { ExperimentalBrowserAnimations } from "vibelang-runtime/experimental/platform-browser"

// A host whose frames and animations the test settles by hand.
const fakeHost = (animationsOf: (selector: string) => ReadonlyArray<{ readonly finished: Promise<unknown> }> | null) => {
  const frames = new Map<number, (time: number) => void>()
  const log: Array<string> = []
  let next = 1
  let clock = 100
  const host: Animations.Host = {
    requestAnimationFrame: (callback) => {
      const id = next++
      frames.set(id, callback)
      log.push("frame")
      return id
    },
    cancelAnimationFrame: (id) => {
      frames.delete(id)
      log.push("cancel")
    },
    now: () => clock,
    querySelector: (selector) => {
      log.push(`query ${selector}`)
      const animations = animationsOf(selector)
      return animations === null ? null : { getAnimations: () => animations }
    }
  }
  const fireFrames = (time = 0) => {
    const pending = [...frames.values()]
    frames.clear()
    clock = time
    for (const frame of pending) frame(time)
  }
  return { fireFrames, frames, host, log }
}

const deferred = () => {
  let resolve!: () => void
  let reject!: (cause: unknown) => void
  const finished = new Promise<void>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { finished, resolve, reject }
}

// Runs fibers until `done` holds.
const until = (done: () => boolean) => Effect.gen(function*() {
  while (!done()) yield* Effect.promise(() => new Promise((resolve) => setTimeout(resolve, 0)))
})

test("Animations: nextFrame gives the frame's timestamp, and interrupting it cancels the frame", async () => {
  const { fireFrames, frames, host, log } = fakeHost(() => null)
  const service = Animations.make(host)
  await Effect.runPromise(Effect.gen(function*() {
    const fiber = yield* Effect.forkChild(service.nextFrame)
    yield* until(() => frames.size === 1)
    expect(fiber.pollUnsafe()).toBeUndefined()
    fireFrames(250)
    expect(yield* Fiber.join(fiber)).toBe(250)
    const interrupted = yield* Effect.forkChild(service.nextFrame)
    yield* until(() => frames.size === 1)
    yield* Fiber.interrupt(interrupted)
  }))
  expect(frames.size).toBe(0)
  expect(log).toEqual(["frame", "frame", "cancel"])
})

test("Animations: settled looks the element up after a frame, not before", async () => {
  const { fireFrames, frames, host, log } = fakeHost(() => [])
  await Effect.runPromise(Effect.gen(function*() {
    const fiber = yield* Effect.forkChild(Animations.make(host).settled("#menu"))
    yield* until(() => frames.size === 1)
    expect(log).toEqual(["frame"])
    fireFrames()
    yield* Fiber.join(fiber)
  }))
  expect(log).toEqual(["frame", "query #menu"])
})

test("Animations: settled completes at once for a missing element or one with no animations", async () => {
  for (const animations of [null, []]) {
    const { fireFrames, frames, host } = fakeHost(() => animations)
    await Effect.runPromise(Effect.gen(function*() {
      const fiber = yield* Effect.forkChild(Animations.make(host).settled("#menu"))
      yield* until(() => frames.size === 1)
      fireFrames()
      yield* Fiber.join(fiber)
    }))
  }
})

test("Animations: settled waits for every animation, whether it finishes or is cancelled", async () => {
  await fc.assert(fc.asyncProperty(fc.array(fc.boolean(), { minLength: 1, maxLength: 8 }), async (outcomes) => {
    const pending = outcomes.map(deferred)
    const { fireFrames, frames, host } = fakeHost(() => pending)
    await Effect.runPromise(Effect.gen(function*() {
      const fiber = yield* Effect.forkChild(Animations.make(host).settled("#menu"))
      yield* until(() => frames.size === 1)
      fireFrames()
      for (const [index, finishes] of outcomes.entries()) {
        yield* Effect.yieldNow
        expect(fiber.pollUnsafe()).toBeUndefined()
        if (finishes) pending[index]!.resolve()
        else pending[index]!.reject(new DOMException("cancelled", "AbortError"))
      }
      yield* Fiber.join(fiber)
    }))
  }), { numRuns: 50 })
})

test("Animations: interrupting settled stops the wait", async () => {
  const never = deferred()
  const { fireFrames, frames, host } = fakeHost(() => [never])
  await Effect.runPromise(Effect.gen(function*() {
    const fiber = yield* Effect.forkChild(Animations.make(host).settled("#menu"))
    yield* until(() => frames.size === 1)
    fireFrames()
    yield* Effect.promise(() => new Promise((resolve) => setTimeout(resolve, 0)))
    yield* Fiber.interrupt(fiber)
  }))
})

test("Animations: a selector the host rejects is a defect, not a hang", async () => {
  const host: Animations.Host = {
    requestAnimationFrame: (callback) => {
      queueMicrotask(() => callback(0))
      return 1
    },
    cancelAnimationFrame: () => {},
    now: () => 0,
    querySelector: () => {
      throw new DOMException("not a selector", "SyntaxError")
    }
  }
  const exit = await Effect.runPromiseExit(Animations.make(host).settled("["))
  expect(Exit.isFailure(exit)).toBe(true)
  expect(String(exit)).toContain("not a selector")
})

// VIP-33/detail261: "Perform the pending-commit check and callback registration
// together in its synchronous native registration function".
// Keyed migration corpus: foldkit-render-atomic-frame.json.
test("Animations: foldkit atomic registration is cold, same-turn, and cancels only its own registration (property)", async () => {
  const corpus = await Bun.file(new URL("./corpus/foldkit-render-atomic-frame.json", import.meta.url)).json()
  const check = async (pending: boolean, synchronous: boolean, interrupted: boolean) => {
    const { fireFrames, frames, host, log } = fakeHost(() => null)
    const service = Animations.make(host)
    let listener: (() => void) | undefined
    const program = service.nextFrameUnless((resume) => {
      log.push("check")
      queueMicrotask(() => log.push("microtask"))
      if (!pending) return undefined
      log.push("commit")
      listener = resume
      if (synchronous) resume()
      return () => { listener = undefined; log.push("unsubscribe") }
    })
    expect("onNextFrame" in service).toBe(false)
    expect(log).toEqual([])
    // Run the same cold value twice; neither registration is cached.
    for (let run = 0; run < 2; run++) {
      log.length = 0
      await Effect.runPromise(Effect.gen(function*() {
        const fiber = yield* Effect.forkChild(program)
        yield* until(() => log.includes("check"))
        expect(log.slice(0, 2)).toEqual(["check", pending ? "commit" : "frame"])
        if (interrupted && !(pending && synchronous)) {
          yield* Fiber.interrupt(fiber)
          expect(log.filter((entry) => entry === (pending ? "unsubscribe" : "cancel"))).toHaveLength(1)
          expect(frames.size).toBe(0)
          if (pending) expect(listener).toBeUndefined()
        } else {
          if (pending) listener!()
          else fireFrames(16)
          yield* Fiber.join(fiber)
          expect(log).not.toContain("unsubscribe")
          expect(log).not.toContain("cancel")
        }
      }))
    }
  }
  for (const row of corpus.schedules) await check(row.pending, row.synchronous, row.interrupted)
  await fc.assert(fc.asyncProperty(fc.boolean(), fc.boolean(), fc.boolean(), check), { seed: 261, numRuns: 100 })
})

test("Animations: nextFrameUnless defects for missing frames only when the registrar chooses a frame", async () => {
  const { host } = fakeHost(() => null)
  const missing = Animations.make({ ...host, requestAnimationFrame: () => { throw new Error("missing frame host") } })
  const pending = missing.nextFrameUnless((resume) => { resume(); return () => {} })
  expect(Exit.isSuccess(await Effect.runPromiseExit(pending))).toBe(true)
  const frame = missing.nextFrameUnless(() => undefined)
  const failed = await Effect.runPromiseExit(frame)
  expect(Exit.isFailure(failed)).toBe(true)
  expect(String(failed)).toContain("missing frame host")
  const registrar = missing.nextFrameUnless(() => { throw new Error("registrar failure") })
  expect(String(await Effect.runPromiseExit(registrar))).toContain("registrar failure")
})

test("Animations: frameDeltas gives the time since the last frame, the first since the Stream started, and cancels on end", async () => {
  await fc.assert(fc.asyncProperty(fc.array(fc.integer({ min: 1, max: 1000 }), { minLength: 1, maxLength: 20 }), async (gaps) => {
    const { fireFrames, frames, host, log } = fakeHost(() => null)
    const deltas = await Effect.runPromise(Effect.gen(function*() {
      const fiber = yield* Effect.forkChild(Stream.runCollect(Stream.take(Animations.make(host).frameDeltas, gaps.length)))
      let time = 100
      for (const gap of gaps) {
        yield* until(() => frames.size === 1)
        time += gap
        fireFrames(time)
      }
      return yield* Fiber.join(fiber)
    }))
    expect(deltas).toEqual(gaps)
    expect(frames.size).toBe(0)
    expect(log.at(-1)).toBe("cancel")
  }), { numRuns: 50 })
})

test("Animations: frameDeltas is never negative, though a frame's timestamp can precede the Stream's start", async () => {
  const corpus = await Bun.file(new URL("./corpus/foldkit-request-frame-delta.json", import.meta.url)).json()
  const check = async (steps: number[]) => {
    const { fireFrames, frames, host, log } = fakeHost(() => null)
    const stream = Animations.make(host).frameDeltas
    expect(frames.size).toBe(0)
    const deltas = await Effect.runPromise(Effect.gen(function*() {
      const fiber = yield* Effect.forkChild(Stream.runCollect(Stream.take(stream, steps.length)))
      let time = 100
      for (const step of steps) {
        yield* until(() => frames.size === 1)
        time += step
        fireFrames(time)
      }
      return yield* Fiber.join(fiber)
    }))
    expect(deltas).toEqual(steps.map((step) => step < 0 ? 0 : step))
    expect(frames.size).toBe(0)
    expect(log.at(-1)).toBe("cancel")
  }
  for (const steps of corpus.schedules) await check(steps)
  await fc.assert(fc.asyncProperty(fc.array(fc.integer({ min: -1000, max: 1000 }),
    { minLength: 1, maxLength: 12 }), check), { seed: 7315, numRuns: 200 })
})

test("Animations: the browser layer reads the host when a member runs", async () => {
  const host = globalThis as { requestAnimationFrame?: unknown; cancelAnimationFrame?: unknown; document?: unknown }
  const frame = Effect.flatMap(Effect.service(Animations.Animations), (animations) => animations.nextFrame)
  const missing = await Effect.runPromiseExit(Effect.provide(frame, ExperimentalBrowserAnimations.layer))
  expect(Exit.isFailure(missing)).toBe(true)
  expect(String(missing)).toContain("requestAnimationFrame")
  // A macrotask, as a host's frame is: a frame in a microtask would starve the fiber that ends frameDeltas.
  host.requestAnimationFrame = (callback: (time: number) => void) => setTimeout(() => callback(0), 0)
  host.cancelAnimationFrame = (id: ReturnType<typeof setTimeout>) => clearTimeout(id)
  host.document = { querySelector: (selector: string) => selector === "#x" ? null : null }
  try {
    await Effect.runPromise(Effect.provide(frame, ExperimentalBrowserAnimations.layer))
    const settled = Effect.flatMap(Effect.service(Animations.Animations), (animations) => animations.settled("#x"))
    await Effect.runPromise(Effect.provide(settled, ExperimentalBrowserAnimations.layer))
    const deltas = Effect.flatMap(Effect.service(Animations.Animations), (animations) => Stream.runCollect(Stream.take(animations.frameDeltas, 1)))
    expect(await Effect.runPromise(Effect.provide(deltas, ExperimentalBrowserAnimations.layer))).toHaveLength(1)
  } finally {
    delete host.requestAnimationFrame
    delete host.cancelAnimationFrame
    delete host.document
  }
})

test("Animations: layerTest completes at once, and takes the members a test needs", async () => {
  const seen: Array<string> = []
  const service = Effect.service(Animations.Animations)
  const frame = await Effect.runPromise(Effect.provide(Effect.flatMap(service, (animations) => animations.nextFrame), Animations.layerTest()))
  expect(frame).toBe(0)
  const fired = await Effect.runPromise(Effect.provide(
    Effect.flatMap(service, (animations) => animations.nextFrameUnless(() => undefined)),
    Animations.layerTest()
  ))
  expect(fired).toBeUndefined()
  const stayed = Effect.flatMap(service, (animations) => Effect.timeoutOption(Stream.runDrain(animations.frameDeltas), "10 millis"))
  expect((await Effect.runPromise(Effect.provide(stayed, Animations.layerTest())))._tag).toBe("None")
  const run = Effect.flatMap(Effect.service(Animations.Animations), (animations) =>
    Effect.andThen(animations.nextFrame, animations.settled("#menu")))
  await Effect.runPromise(Effect.provide(run, Animations.layerTest()))
  await Effect.runPromise(Effect.provide(run, Animations.layerTest({ settled: (selector) => Effect.sync(() => void seen.push(selector)) })))
  expect(seen).toEqual(["#menu"])
})

// VIP-33 cold atomic registration, native callback phase and cancellation property; rule: docs/design/vips/0033-platform-stdlib.md#b21803be8f5bf9aa
// VIP-33 cold atomic registration, native callback phase and cancellation property; rule: docs/design/vips/0033-platform-stdlib.md#c930eec6fcfc8e6c
// VIP-33 cold atomic registration, native callback phase and cancellation property; rule: docs/design/vips/0033-platform-stdlib.md#d6198daf1f533661
// VIP-33 cold atomic registration, native callback phase and cancellation property; rule: docs/design/vips/0033-platform-stdlib.md#960d1e3d1811dd77

// VIP-33 atomic frame registration timing cancellation and interruption property; rule: docs/design/vips/0033-platform-stdlib.md#bea0837d29b0fba5

// VIP-33 atomic frame registration timing cancellation and interruption property; rule: docs/design/vips/0033-platform-stdlib.md#2d0b93b24ae63196

// VIP-9 host injection and synchronous frame registration preserve public timing and cancellation; rule: docs/design/vips/0009-service-declarations.md#912bd5fa167ac011

// VIP-33 host injection and synchronous frame registration preserve public timing and cancellation; rule: docs/design/vips/0033-platform-stdlib.md#56cc801a259b8866
