// expect-result: {"written":[2,"1"],"captured":"1","typed":3,"mixed":[42,"4"],"shadowed":"5!","collided":"6x"}
// The values are what the retired hatches returned: the arrow called with its
// inputs, whose parameter is a binding of its own (PREVIEW-3). lib.vibe is
// what vibelang --fix-vip-only writes for hatch-parameter-cell.fail.
import { Effect } from "effect"
import { captured, collided, mixed, shadowed, typed, written } from "./lib.vibe"

export function main() {
  return Effect.gen(function* () {
    return {
      written: yield* written(),
      captured: yield* captured(),
      typed: yield* typed(),
      mixed: yield* mixed(),
      shadowed: yield* shadowed(),
      collided: yield* collided(),
    }
  })
}
