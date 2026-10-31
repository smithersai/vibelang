// expect-result: {"doubled":"doubled=6","checked":2,"defect":"negative","operand":"operand=4","positions":"a?b6 3 6 t=3","held":{"one":1,"two":2},"projected":4,"shout":"A=2","hidden":1}
// main.ts stays TypeScript: it calls lib.
import { Cause, Effect, Exit } from "effect"
import { checked, doubled, held, hidden, operand, positions, projected, shout } from "./lib.vibe"

const defect = (exit: Exit.Exit<unknown, unknown>): unknown => {
  if (Exit.isSuccess(exit)) return "no defect"
  const thrown = Cause.squash(exit.cause)
  return thrown instanceof Error ? thrown.message : "not an Error"
}

export function main() {
  return Effect.gen(function* () {
    return {
      doubled: yield* doubled(3),
      checked: yield* checked(2),
      defect: defect(yield* Effect.exit(checked(-1))),
      operand: yield* operand(2),
      positions: yield* positions(3),
      held: yield* held(1),
      projected: yield* projected.reduce(2),
      shout: shout("a"),
      hidden: hidden(1),
    }
  })
}
