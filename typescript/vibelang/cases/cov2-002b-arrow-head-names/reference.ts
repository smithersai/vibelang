import { Effect } from "effect"
function arrowHeadNames() {
 return Effect.gen(function* () {
  function plain(join: number) { return join }
  const later = async (value: number) => { const join = value; return join }
  return plain(7)
 })
}
export function main() { return Effect.gen(function* () { return yield* arrowHeadNames() }) }
