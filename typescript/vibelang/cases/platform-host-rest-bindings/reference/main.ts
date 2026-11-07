import { Effect } from "effect"
export let copies = 0
/** @throws {never} */
export function copy(): string[] {
  copies++
  const { ...timeout } = AbortSignal
  const { ...createObjectURL } = URL
  const { ...revokeObjectURL } = URL
  return [typeof timeout, typeof createObjectURL, typeof revokeObjectURL]
}
/** @throws {never} */
export function main(): Effect.Effect<string[]> {
  return Effect.gen(function* () { return copy() })
}
