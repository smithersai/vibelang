import { Effect } from "effect"
export function whileCells(): readonly unknown[] {
  const n = 99
  let turn = 0
  const reads: (() => number)[] = []
  while (++turn < 4) {
    let n = turn
    reads.push(() => n)
    n += 10
    if (turn === 2) continue
  }
  return [reads.map(read => read()), n]
}
export function main(): Effect.Effect<unknown> { return Effect.sync(whileCells) }
