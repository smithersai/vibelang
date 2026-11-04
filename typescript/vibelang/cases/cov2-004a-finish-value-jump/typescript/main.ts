import { Effect } from "effect"
export function main(): Effect.Effect<unknown> {
  return Effect.sync(() => {
    const log: string[] = []
    function* numbers() { try { yield 1; yield 2 } finally { log.push("closed") } }
    function first() { for (const a of numbers()) return a; return -1 }
    let value = -1
    for (const a of numbers()) { value = a; break }
    return [value, first(), log]
  })
}
