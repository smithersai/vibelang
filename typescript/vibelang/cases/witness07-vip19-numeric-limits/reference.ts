import { Effect } from "effect"
import type { Types } from "effect"

export const visit = (limit: Types.Concurrency) => Effect.gen(function* () {
  const parent = yield* Effect.fiberId
  const started: number[] = []
  const finished: number[] = []
  const onParent: boolean[] = []
  let active = 0
  let peak = 0
  yield* Effect.forEach([1, 2, 3, 4, 5], (n) => Effect.gen(function* () {
    started.push(n)
    const self = yield* Effect.fiberId
    onParent.push(self === parent)
    active++
    peak = Math.max(peak, active)
    yield* Effect.yieldNow
    active--
    finished.push(n)
  }), { concurrency: limit, discard: true })
  return { started, finished, onParent, peak }
})
