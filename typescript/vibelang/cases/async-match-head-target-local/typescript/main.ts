import { Effect } from "effect"

function choose() {
  const trace: string[] = []
  let pending: Promise<number> = Promise.resolve(0)
  class C {
    [(() => {
      pending = (async () => {
        const subject = (trace.push("subject"), 1)
        local: while (true) { break local }
        trace.push("arm")
        return 7
      })()
      trace.push("key")
      return "m"
    })()]() { return 11 }
  }
  return pending.then(value => [value, trace] as const)
}

export function main() { return Effect.gen(function* () { return yield* Effect.promise(choose) }) }
