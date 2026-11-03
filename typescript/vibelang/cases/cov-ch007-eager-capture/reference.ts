function lifted(props: {id:string}) { return Effect.gen(function*(){ const id=props.id; return id }) }
import { Effect, Context } from "effect"
let made = 0
const make = () => { made += 1; return class {} }
function load() { return Effect.gen(function* () { return 1 }) }
function captureId(props: { id: string }) { const id = props.id; return Effect.gen(function* () { return id }) }
export function probe() { return Effect.gen(function* () {
 const C = make(); let reads = 0; const state = { id: 'A' }; const props = { get id() { reads += 1; return state.id } }; const job = captureId(props); const delayed = lifted(props)
 state.id = 'B'; const lateFirst = yield* delayed; const first = yield* job; state.id = 'C'; const lateSecond = yield* delayed; const second = yield* job
 return { made, reads, constructor: typeof C === 'function', first, second, lateFirst, lateSecond, loaded: yield* load() }
}) }
type Equal<A,B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false
const success: Equal<Effect.Success<ReturnType<typeof probe>>, { made: number; reads: number; constructor: boolean; first: string; second: string; lateFirst: string; lateSecond: string; loaded: number }> = true
const failure: Equal<Effect.Error<ReturnType<typeof probe>>, never> = true
const requirements: Equal<Effect.Services<ReturnType<typeof probe>>, never> = true
export const typeEvidence = [success, failure, requirements]