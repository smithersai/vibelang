import { Effect } from "effect"
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false
type ObjectSlots = Effect.Effect<number, { reason: string }, { service: number }>
type ObjectRequirement = Effect.Effect<number, never, { service: number }>
type Negative = Effect.Effect<number, never, -1>
type TupleRequirement = Effect.Effect<number, never, [0]>
type GenericRequirement = Effect.Effect<number, never, <T>() => T>
type Find = (id: string) => Effect.Effect<number, string>
type Make = new () => Effect.Effect<number, string>
export const checks: [
  Equal<ObjectSlots, Effect.Effect<number, { reason: string }, { service: number }>>,
  Equal<ObjectRequirement, Effect.Effect<number, never, { service: number }>>,
  Equal<Negative, Effect.Effect<number, never, -1>>,
  Equal<TupleRequirement, Effect.Effect<number, never, [0]>>,
  Equal<GenericRequirement, Effect.Effect<number, never, <T>() => T>>,
  Equal<ReturnType<Find>, Effect.Effect<number, string>>,
  Equal<InstanceType<Make>, Effect.Effect<number, string>>
] = [true, true, true, true, true, true, true]
export function main(): Effect.Effect<number> { return Effect.succeed(1) }
