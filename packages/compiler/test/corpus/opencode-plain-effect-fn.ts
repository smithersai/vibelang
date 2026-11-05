import { Effect } from "effect"

export const trace: string[] = []
export const work = Effect.fn("work")(function(n: number) {
  trace.push("construct:" + n)
  return Effect.sync(() => {
    trace.push("run:" + n)
    return n + 1
  })
})
