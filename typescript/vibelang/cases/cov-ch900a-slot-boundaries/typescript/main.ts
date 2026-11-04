import { Effect } from "effect"

type RequiredObjects = Effect.Effect<number, { reason: string }, { service: number }>
type OptionalError = [(Effect.Effect<number, string>)?]
type OptionalSuccess = [(Effect.Effect<number>)?]
type OptionalNegative = [(Effect.Effect<number, never, -1>)?]
type GenericRequirement = Effect.Effect<number, never, (<T>() => T)>
type as = { service: number }
type satisfies = { other: string }
type NamedRequirement = Effect.Effect<number, never, as>
type OtherRequirement = Effect.Effect<number, string, satisfies>

function assertions(x: unknown) {
  const asserted = x as Effect.Effect<number> as unknown
  const checked = x as Effect.Effect<number> satisfies unknown
  const named = x as Effect.Effect<number, never, as> satisfies unknown
  const tuple = x as Effect.Effect<number, never, [0]>
  // @ts-expect-error: Effect values are not comparison operands
  const comparison = (x as Effect.Effect<number>) < 3
  // @ts-expect-error: an Effect has no numeric index
  const indexed = (x as Effect.Effect<number>)[0]
}

function lineBreak(x: unknown, B: unknown) {
  const value = x as Effect.Effect<number, never, as>
  B
  return value
}


export function main() {
  return Effect.gen(function* () {
  const empty: OptionalError = []
  const noError: OptionalSuccess = []
  return [empty.length, noError.length, empty[0] === undefined] as const

  })
}
function preference(x: unknown, B: unknown) {
  const y = x as Effect.Effect<number, never, as>
  B
  const check: Effect.Effect<number, never, as> = y
  return check
}
function operands(x: unknown) {
  const compact: Effect.Effect<number, never, -1> = x as Effect.Effect<number, never, -1>
  const spaced: Effect.Effect<number, never, -1> = x as Effect.Effect<number, never, -1>
  const nonnull: Effect.Effect<number> = (x as Effect.Effect<number>)!
  const chosen = x as Effect.Effect<number> ? 1 : 2
  // @ts-expect-error: Effect values are not arithmetic operands
  const product = (x as Effect.Effect<number>) * 2
  // @ts-expect-error: Effect values are not arithmetic operands
  const subtract = (x as Effect.Effect<number>) - 1
  return [compact, spaced, nonnull, chosen, product, subtract]
}

type Same<X,Y> = (<T>() => T extends X ? 1 : 2) extends (<T>() => T extends Y ? 1 : 2) ? true : false
const requiredObjectsMatches: Same<RequiredObjects, Effect.Effect<number, { reason: string }, { service: number }>> = true
const optionalErrorMatches: Same<OptionalError, [Effect.Effect<number, string>?]> = true
const optionalSuccessMatches: Same<OptionalSuccess, [Effect.Effect<number>?]> = true
const optionalNegativeMatches: Same<OptionalNegative, [Effect.Effect<number, never, -1>?]> = true
const genericRequirementMatches: Same<GenericRequirement, Effect.Effect<number, never, <T>() => T>> = true
const namedRequirementMatches: Same<NamedRequirement, Effect.Effect<number, never, as>> = true
const otherRequirementMatches: Same<OtherRequirement, Effect.Effect<number, string, satisfies>> = true
