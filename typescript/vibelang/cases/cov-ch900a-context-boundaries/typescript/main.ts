import { Effect } from "effect"
function join(n: number): number { return n + 1 }
function fork(n: number): number { return n + 2 }
class Plain { static { join(9); fork(9) } }
const outsideAsync = async (fork: number) => fork + 1
export function main(): Effect.Effect<readonly [number, number, number]> { return Effect.gen(function* () {
  class Base {}
  class C extends (yield* Effect.succeed(Base)) {
    [yield* Effect.succeed("read")]() { return 1 }
    value = join(1)
    program = Effect.gen(function* () { return yield* Effect.succeed(7) })
  }
  enum E { A = fork(1) }
  const c = new C()
  return [c.value, E.A, yield* c.program] as const
}) }
