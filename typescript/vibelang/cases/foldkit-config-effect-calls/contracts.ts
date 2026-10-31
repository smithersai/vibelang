import type { Config, Effect, Scope } from "effect"
import type { read, readBound, readAlias, readGeneric, readConstrained, readConstrainedBound, readConstrainedAlias, readConstrainedGeneric, readAllChannels, readConditional, readIndexed, readUnion, readIntersection, runDiscarded } from "./main.vibe"
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false
type Assert<T extends true> = T
type Expected = Effect.Effect<string, Config.ConfigError>
type Direct = Assert<Equal<ReturnType<typeof read>, Expected>>
type Bound = Assert<Equal<ReturnType<typeof readBound>, Expected>>
type Alias = Assert<Equal<ReturnType<typeof readAlias>, Expected>>
type Generic = Assert<Equal<ReturnType<typeof readGeneric>, Expected>>
type Constrained = Assert<Equal<ReturnType<typeof readConstrained>, Expected>>
type ConstrainedBound = Assert<Equal<ReturnType<typeof readConstrainedBound>, Expected>>
type ConstrainedAlias = Assert<Equal<ReturnType<typeof readConstrainedAlias>, Expected>>
type ConstrainedGeneric = Assert<Equal<ReturnType<typeof readConstrainedGeneric>, Expected>>
type ExpectedChannels = Effect.Effect<number, "bad", Scope.Scope>
type AllChannels = Assert<Equal<ReturnType<typeof readAllChannels<number, "bad", Scope.Scope, ExpectedChannels & { readonly brand: "Sub" }>>, ExpectedChannels>>
type Conditional = Assert<Equal<ReturnType<typeof readConditional>, Effect.Effect<string | number, Config.ConfigError>>>
type Indexed = Assert<Equal<ReturnType<typeof readIndexed>, Expected>>
type Union = Assert<Equal<ReturnType<typeof readUnion>, Effect.Effect<string | number, Config.ConfigError>>>
type Intersection = Assert<Equal<ReturnType<typeof readIntersection>, Expected>>
type Discarded = Assert<Equal<ReturnType<typeof runDiscarded>, Effect.Effect<void, Config.ConfigError>>>
