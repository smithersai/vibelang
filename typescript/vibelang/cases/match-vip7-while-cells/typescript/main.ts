import { Effect } from "effect"
export function whileCells(): readonly unknown[] {
  const n = 99
  let turn = 0
  const nested:(()=>number)[]=[]
  const reads: (() => number)[] = []
  while (++turn < 4) {
    let n = turn
    reads.push(() => n)
    { const n=100; nested.push(()=>n) }
    n += 10
    if (turn === 2) continue
  }
  return [reads.map(read => read()), n, nested.map(read=>read())]
}
export function main(): Effect.Effect<unknown> { return Effect.sync(whileCells) }
