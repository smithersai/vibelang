import { Effect, Context } from "effect"
function join(n: number) { return () => ({ value: n }) }
export function main() { return Effect.gen(function* () {
 const Flags = Context.Reference<{ value: number }>("app/Flags", { defaultValue: join(7) })
 return (yield* Flags).value
}) }
