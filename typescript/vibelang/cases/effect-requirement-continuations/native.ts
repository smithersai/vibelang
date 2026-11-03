import type { Effect } from "effect"
// Appendix A: choose R among complete source parses, including real ASI.
// Spec rule: docs/design/src/900-appendices.md#EffectOperand
type as = unknown
type satisfies = unknown
export function chained(value: unknown) {
  const assertion = value as Effect.Effect<number, never, never> as unknown
  const checked = value as Effect.Effect<number, never, never> satisfies unknown
  return [assertion, checked]
}
export function retained(value: unknown) {
  const result = value as Effect.Effect<number, never, as>
  value
  return result
}
export function retainedCheckName(value: unknown) {
  const result = value as Effect.Effect<number, never, satisfies>
  value
  return result
}
export function collect(value: unknown) {
  let total = 0
  for (const n of value as Effect.Effect<number, never, never> as unknown as number[]) total += n
  return total
}
