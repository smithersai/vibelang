import { Effect } from "effect"
function ordinary() { const Effect = { gen: () => 7 }; return Effect.gen() }
export function probe() { return Effect.gen(function* () { return ordinary() }) }
type Equal<A,B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false
const success: Equal<Effect.Success<ReturnType<typeof probe>>, number> = true
const failure: Equal<Effect.Error<ReturnType<typeof probe>>, never> = true
const requirements: Equal<Effect.Services<ReturnType<typeof probe>>, never> = true
export const typeEvidence = [success, failure, requirements]