import { Effect } from "effect"
type Callback = () => number
interface Local { method(): number }
export function accepted(callback: Callback, local: Local) {
  return Effect.gen(function* () { return callback() + local.method() })
}
