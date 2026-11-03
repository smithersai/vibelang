import { Effect } from "effect"
function fork(n: number) { return n + 1 }
function join(n: number) { return n + 2 }
const ordinary = async (join: number) => join
export function main(): Effect.Effect<number[]> {
 return Effect.gen(function* () {
  const props = { fork: 1, join: 2 }
  class C { x = fork(3); static y = join(4) }
  enum E { Value = join(5) }
  const plain = function(join: number) { return join }
  const asyncBody = async () => { const fork = 8; const join = 9; return fork + join }
  const text = ["a", "b"].join(",")
  return [props.fork, props.join, new C().x, C.y, E.Value, plain(6), text.length, yield* Effect.promise(() => ordinary(10)), yield* Effect.promise(asyncBody)]
 })
}
