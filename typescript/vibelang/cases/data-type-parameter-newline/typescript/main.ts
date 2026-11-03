import { Data } from "effect"
export type Name
<T> = Data.TaggedEnum<{ Ok: { value: T } }>
export interface NameDefinition extends Data.TaggedEnum.WithGenerics<1> {
  readonly taggedEnum: Name<this["A"]>
}
export const Name = Data.taggedEnum<NameDefinition>()

export type Pair /* first
second */ <A, B> = Data.TaggedEnum<{ Both: { left: A; right: B } }>
export interface PairDefinition extends Data.TaggedEnum.WithGenerics<2> {
  readonly taggedEnum: Pair<this["A"], this["B"]>
}
export const Pair = Data.taggedEnum<PairDefinition>()

export type Quad
<A, B, C, D> = Data.TaggedEnum<{ All: { a: A; b: B; c: C; d: D } }>
export interface QuadDefinition extends Data.TaggedEnum.WithGenerics<4> {
  readonly taggedEnum: Quad<this["A"], this["B"], this["C"], this["D"]>
}
export const Quad = Data.taggedEnum<QuadDefinition>()

export const name: Name<number> = Name.Ok({ value: 42 })
export const pair: Pair<string, number> = Pair.Both({ left: "ok", right: 7 })
export const quad: Quad<number, string, boolean, null> = Quad.All({ a: 1, b: "x", c: true, d: null })
