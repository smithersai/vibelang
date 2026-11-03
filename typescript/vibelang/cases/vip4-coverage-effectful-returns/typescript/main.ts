import { Effect } from "effect"
import { effectful, stream, layer, safe, constrained, Foreign } from "./foreign.js"
export function accepted<T extends Effect.Effect<number>>() {
  return Effect.gen(function* () {
    const a = effectful()
    const s = stream()
    const l = layer()
    const n = safe()
    const g = constrained<T>()
    return [a,s,l,n,g]
  })
}
export function accessor(value: Foreign) { const n = value.value; value.value = n; return n }
