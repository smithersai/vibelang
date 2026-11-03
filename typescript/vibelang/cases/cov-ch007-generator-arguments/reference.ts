import { Effect, Context } from "effect"
let made = 0
const makeGenerator = () => { made += 1; return function* () { yield* []; return 7 } }
const factory = () => Effect.gen(makeGenerator())
function ordinary() { const Effect = { gen: () => 7 }; return Effect.gen() }
export function probe() { return Effect.gen(function* () { const p = factory(); const atCall = made; const value = yield* p; return { atCall, afterRun: made, value, ordinary: ordinary() } }) }
type Equal<A,B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false
const success: Equal<Effect.Success<ReturnType<typeof probe>>, { atCall: number; afterRun: number; value: number; ordinary: number }> = true
const failure: Equal<Effect.Error<ReturnType<typeof probe>>, never> = true
const requirements: Equal<Effect.Services<ReturnType<typeof probe>>, never> = true
export const typeEvidence = [success, failure, requirements]