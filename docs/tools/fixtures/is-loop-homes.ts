// Native TypeScript counterpart retained from docs/design/src/004-match.md
// at f0360d72 (parent of 1e7e769c1859). Braced homes remain valid under VIP-7.
import { Effect } from "effect"

function drain(it: Iterator<number>) {
  const out: (() => number)[] = []
  for (;;) {
    const r = it.next()
    if (!("done" in r && r.done === false && "value" in r)) break
    const v = r.value
    out.push(() => v)
  }
  return out.map(g => g())
}
function countdown(src: { n: number }) {
  const seen: (() => number)[] = []
  for (let n = src.n; n > 0; n--) seen.push(() => n)
  return seen.map(g => g())
}
function ids(xs: unknown[]) {
  const out: unknown[] = []
  for (const x of xs) {
    if ((typeof x === "object" || typeof x === "function") && x !== null && "id" in x) { let id = x.id; out.push(id) }
  }
  return out
}
const callable = Object.assign(() => 0, { id: 7 })
const callableObjectExit = Effect.runSyncExit(Effect.sync(() => ids([callable]))) // Success([7])
const loopHomesExit = Effect.runSyncExit(Effect.sync(() => [drain([1, 2, 3][Symbol.iterator]()), countdown({ n: 3 }), ids([{ id: 1 }, { id: 2 }])])) // Success([[1, 2, 3], [3, 2, 1], [1, 2]])
