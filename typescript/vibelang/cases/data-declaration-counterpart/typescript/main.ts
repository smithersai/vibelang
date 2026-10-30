import { Data } from "effect"

/** Why a lazy call ran its view instead of reusing the cached result. */
export type LazyMissReason = Data.TaggedEnum<{
  NoCachedEntry: {}
  ArgumentCountChanged: { readonly previousCount: number; readonly currentCount: number }
}>
/** Why a lazy call ran its view instead of reusing the cached result. */
export const LazyMissReason = Data.taggedEnum<LazyMissReason>()

/** A parcel on its way. */
export type Delivery = Data.TaggedEnum<{
  Waiting: {}
  Sent: { tracking: string; carrier?: string }
  Rejected: { readonly reason: string }
}>
/** A parcel on its way. */
export const Delivery = Data.taggedEnum<Delivery>()

export type Tree = Data.TaggedEnum<{ Leaf: {}; Node: { left: Tree; right: Tree } }>
export const Tree = Data.taggedEnum<Tree>()

export type Json = Data.TaggedEnum<{ Null: {}; Items: { items: ReadonlyArray<Json> }; Fields: { fields: Record<string, Json> } }>
export const Json = Data.taggedEnum<Json>()

export type Outcome<A, E> = Data.TaggedEnum<{ Ok: { value: A }; Err: { error: E } }>
export interface $Outcome$Definition extends Data.TaggedEnum.WithGenerics<2> {
  readonly taggedEnum: Outcome<this["A"], this["B"]>
}
export const Outcome = Data.taggedEnum<$Outcome$Definition>()
