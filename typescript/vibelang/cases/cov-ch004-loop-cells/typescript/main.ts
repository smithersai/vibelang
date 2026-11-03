import { Effect } from "effect"

export function main(): Effect.Effect<unknown> { return Effect.sync(() => {
const x = 99; let n = 0; const readers: (() => number)[] = []
while (n < 2) { let x = ++n; readers.push(() => x); x += 10; continue }
return [x, ...readers.map(f => f())]
}) }
