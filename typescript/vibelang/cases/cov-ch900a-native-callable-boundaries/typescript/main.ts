import { Effect } from "effect"
function join(n: number) { return n + 1 }
function fork(n: number) { return n + 2 }
const seen: number[] = []
class Plain { static { seen.push(join(9), fork(9)) } }
const outsideAsync = async (fork: number) => fork + 1
export function main() { return Effect.gen(function* () {
 function h(join: number) { return join + 1 }
 const plainArrow = () => { const join = 5; return join }
 const asyncArrow = async () => { const join = 7; return join }
 return [h(3), plainArrow(), yield* Effect.promise(() => outsideAsync(5)), yield* Effect.promise(() => asyncArrow()), ...seen]
}) }
