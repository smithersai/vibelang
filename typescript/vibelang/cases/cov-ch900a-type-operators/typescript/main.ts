import { Effect } from "effect"
type Prefix = Effect.Effect<keyof { a: number }, string>
type Postfix = Effect.Effect<number[], string>
type ObjectRequirement = Effect.Effect<number, never, { service: number }>
type UnionSuccess = Effect.Effect<string | number, boolean>
type UnionEffect = string | Effect.Effect<number, boolean>
type Three = Effect.Effect<number, string, boolean>
type Nested = Effect.Effect<Effect.Effect<number, string>, boolean>
export function main() {
  return Effect.gen(function* () { return 1 
  })
}

type Same<X,Y> = (<T>() => T extends X ? 1 : 2) extends (<T>() => T extends Y ? 1 : 2) ? true : false
const prefixMatches: Same<Prefix, Effect.Effect<keyof { a: number }, string>> = true
const postfixMatches: Same<Postfix, Effect.Effect<number[], string>> = true
const objectRequirementMatches: Same<ObjectRequirement, Effect.Effect<number, never, { service: number }>> = true
const unionSuccessMatches: Same<UnionSuccess, Effect.Effect<string | number, boolean>> = true
const unionEffectMatches: Same<UnionEffect, string | Effect.Effect<number, boolean>> = true
const threeMatches: Same<Three, Effect.Effect<number, string, boolean>> = true
const nestedMatches: Same<Nested, Effect.Effect<Effect.Effect<number, string>, boolean>> = true
