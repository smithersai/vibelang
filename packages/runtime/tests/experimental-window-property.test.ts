import { expect, test } from "bun:test"
import * as Cause from "effect/Cause"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as fc from "fast-check"
import { Window } from "vibelang-runtime/experimental"

type State = {
  window: number
  target: number
  color: string
  failCurrent: boolean
  failStyle: boolean
  repeats: number
}

test("Window: generated host changes, repeated cold reads, live identity and defects follow the host", async () => {
  const corpus = await Bun.file(new URL("./corpus/foldkit-window-current-and-live-style.json", import.meta.url)).json()
  const check = (states: Array<State>) => {
    const windows = Array.from({ length: 3 }, () => new EventTarget() as unknown as globalThis.Window)
    const elements = [{}, {}] as Array<Element>
    const styles = [{ color: "red" }, { color: "blue" }] as Array<CSSStyleDeclaration>
    const failure = new Error("foldkit window host failed")
    let state = states[0]!
    let currentCalls = 0
    const styleCalls: Array<Element> = []
    const service = Window.make({
      window: () => {
        currentCalls++
        if (state.failCurrent) throw failure
        return windows[state.window]!
      },
      computedStyle: (element) => {
        styleCalls.push(element)
        if (state.failStyle) throw failure
        return styles[elements.indexOf(element)]!
      }
    })
    const current = service.current
    const reads = elements.map((element) => service.computedStyle(element))
    expect(currentCalls).toBe(0)
    expect(styleCalls).toEqual([])
    for (const next of states) {
      state = next
      const style = styles[state.target]!
      style.color = state.color
      const currentExit = Effect.runSyncExit(current)
      expect(Exit.isFailure(currentExit)).toBe(state.failCurrent)
      if (Exit.isSuccess(currentExit)) expect(currentExit.value).toBe(windows[state.window])
      else expect(Cause.hasDies(currentExit.cause)).toBe(true)
      const before = styleCalls.length
      for (let n = 0; n < state.repeats; n++) {
        const styleExit = Effect.runSyncExit(reads[state.target]!)
        expect(Exit.isFailure(styleExit)).toBe(state.failStyle)
        if (Exit.isSuccess(styleExit)) {
          expect(styleExit.value).toBe(style)
          expect(styleExit.value.color).toBe(state.color)
          style.color = state.color + ":live"
          expect(styleExit.value.color).toBe(style.color)
          style.color = state.color
        } else expect(Cause.hasDies(styleExit.cause)).toBe(true)
      }
      expect(styleCalls.slice(before)).toEqual(Array(state.repeats).fill(elements[state.target]))
    }
    expect(currentCalls).toBe(states.length)
  }
  check(corpus.states)
  fc.assert(fc.property(fc.array(fc.record({
    window: fc.integer({ min: 0, max: 2 }),
    target: fc.integer({ min: 0, max: 1 }),
    color: fc.string({ maxLength: 32 }),
    failCurrent: fc.boolean(),
    failStyle: fc.boolean(),
    repeats: fc.integer({ min: 1, max: 4 })
  }), { minLength: 1, maxLength: 20 }), check), { seed: 5087, numRuns: 150 })
})
