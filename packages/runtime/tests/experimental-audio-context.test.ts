import { expect, test } from "bun:test"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as PlatformError from "effect/PlatformError"
import * as fc from "fast-check"
import { AudioContext } from "vibelang-runtime/experimental"
import { ExperimentalBrowserAudioContext } from "vibelang-runtime/experimental/platform-browser"

const fakeContext = (state: string, close: () => Promise<void> = () => Promise.resolve()) => {
  const calls: Array<string> = []
  const context = {
    state,
    close: () => {
      calls.push("close")
      return close()
    }
  } as unknown as globalThis.AudioContext
  return { calls, context }
}

test("AudioContext: acquire opens a context that closes with the scope", async () => {
  const { calls, context } = fakeContext("running")
  const service = AudioContext.make({ makeContext: () => context })
  await Effect.runPromise(Effect.scoped(Effect.gen(function*() {
    expect(yield* service.acquire).toBe(context)
    expect(calls).toEqual([])
  })))
  expect(calls).toEqual(["close"])
})

test("AudioContext: lifetime cleanup survives success, failure, interruption and prior closure (property)", async () => {
  const corpus = await Bun.file(new URL("./corpus/foldkit-note-player-audio-context.json", import.meta.url)).json()
  const check = async (state: string, rejects: boolean, finish: string) => {
    const { calls, context } = fakeContext(state, () => rejects ? Promise.reject(new Error("no")) : Promise.resolve())
    let created = 0
    const service = AudioContext.make({ makeContext: () => { created++; return context } })
    expect(created).toBe(0)
    const exit = await Effect.runPromiseExit(Effect.scoped(Effect.gen(function*() {
      expect(yield* service.acquire).toBe(context)
      expect(calls).toEqual([])
      if (finish === "closed-in-body") (context as unknown as { state: string }).state = "closed"
      if (finish === "failure") yield* Effect.fail("note player failed")
      if (finish === "interrupt") yield* Effect.interrupt
    })))
    expect(created).toBe(1)
    expect(Exit.isFailure(exit)).toBe(finish === "failure" || finish === "interrupt")
    expect(calls).toEqual(state === "closed" || finish === "closed-in-body" ? [] : ["close"])
  }
  for (const sample of corpus.scenarios) await check(sample.state, sample.rejects, sample.finish)
  await fc.assert(fc.asyncProperty(
    fc.constantFrom("running", "suspended", "closed"), fc.boolean(),
    fc.constantFrom("success", "failure", "interrupt", "closed-in-body"), check
  ), { seed: 60, numRuns: 150 })
})

test("AudioContext: a host that refuses fails with a PlatformError that keeps its message", async () => {
  const service = AudioContext.make({ makeContext: () => { throw new Error("too many contexts") } })
  const error = await Effect.runPromise(Effect.flip(Effect.scoped(service.acquire)))
  expect(PlatformError.isPlatformError(error)).toBe(true)
  expect(error.reason).toMatchObject({ _tag: "Unknown", module: "AudioContext", method: "acquire", description: "too many contexts" })
})

test("AudioContext: the browser layer builds without a host, and acquire fails, not dies, naming it", async () => {
  const acquire = Effect.scoped(Effect.flatMap(Effect.service(AudioContext.AudioContext), (service) => service.acquire))
  const error = await Effect.runPromise(Effect.flip(Effect.provide(acquire, ExperimentalBrowserAudioContext.layer)))
  expect(error.reason.description).toContain("window.AudioContext")
})

test("AudioContext: layerTest gives the fake", async () => {
  const { calls, context } = fakeContext("running")
  const acquire = Effect.scoped(Effect.flatMap(Effect.service(AudioContext.AudioContext), (service) => service.acquire))
  expect(await Effect.runPromise(Effect.provide(acquire, AudioContext.layerTest(context)))).toBe(context)
  expect(calls).toEqual(["close"])
})
