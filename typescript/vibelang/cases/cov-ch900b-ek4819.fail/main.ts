// expect:
// Appendix B: EK4819 — spec-rule: docs/design/src/900-appendices.md#8883ec3ff2a18963
// The historical missing-star repair for yield of an Effect is an editor
// request only: compiling this ordinary TypeScript reports no EK4819. The
// editor repair is TestInterimEK4819EditorRepairOnly.
import { Effect } from "effect"

export function* g() {
  yield Effect.succeed(1)
}
