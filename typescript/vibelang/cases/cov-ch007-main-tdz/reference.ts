function hoistingContrast():string { return typeof inner; function inner():number { return 7 } }
const hoisted = hoistingContrast()
import { Effect, Context } from "effect"
let seen: unknown
function read(): unknown { return main }
try { seen = typeof read() } catch (e) { seen = e instanceof Error ? e.name : String(e) }
export const main = (): number => 7
export function probe() { return Effect.gen(function* () { return {seen,hoisted} }) }
type Equal<A,B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false
const success: Equal<Effect.Success<ReturnType<typeof probe>>, {seen:unknown;hoisted:string}> = true
const failure: Equal<Effect.Error<ReturnType<typeof probe>>, never> = true
const requirements: Equal<Effect.Services<ReturnType<typeof probe>>, never> = true
export const typeEvidence = [success, failure, requirements]