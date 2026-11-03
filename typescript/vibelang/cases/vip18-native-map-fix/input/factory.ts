import { Effect } from "effect"
let evaluations = 0, maps = 0, runs = 0
/** @throws {never} */
export function makeRows(): readonly [Effect.Effect<number>, Effect.Effect<string>] {
  evaluations++
  const rows = [Effect.sync(() => { runs++; return 1 }), Effect.sync(() => { runs++; return "two" })] as const
  Object.defineProperty(rows, "map", { value(callback: (value: unknown) => unknown) {
    maps++
    return Array.prototype.map.call(rows, callback)
  } })
  return rows
}
/** @throws {never} */
export function counts() { return { evaluations, maps, runs } }
