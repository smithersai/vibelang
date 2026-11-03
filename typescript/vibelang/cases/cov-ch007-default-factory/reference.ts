import { Effect, Context } from "effect"
const cachedFlags: { enabled: boolean } = { enabled: true }
const Flags = Context.Reference<{ enabled: boolean }>('chapter007/Flags', { defaultValue: () => cachedFlags })
const Fresh = Context.Reference<{ enabled: boolean }>('chapter007/Fresh', { defaultValue: () => ({ enabled: true }) })
export function probe() { return Effect.gen(function* () { return { cached: Flags.defaultValue() === Flags.defaultValue(), fresh: Fresh.defaultValue() === Fresh.defaultValue() } }) }
type Equal<A,B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false
const success: Equal<Effect.Success<ReturnType<typeof probe>>, { cached: boolean; fresh: boolean }> = true
const failure: Equal<Effect.Error<ReturnType<typeof probe>>, never> = true
const requirements: Equal<Effect.Services<ReturnType<typeof probe>>, never> = true
export const typeEvidence = [success, failure, requirements]