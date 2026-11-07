import { Data, Schema } from "effect"
export const S = Schema.Struct({
  plain: Schema.mutableKey(Schema.optionalKey(Schema.String)),
  frozen: Schema.optionalKey(Schema.Number),
  loose: Schema.mutableKey(Schema.optional(Schema.String)),
  nested: Schema.optionalKey(Schema.Struct({
    value: Schema.mutableKey(Schema.optionalKey(Schema.Boolean)),
    inner: Schema.optionalKey(Schema.Struct({ deep: Schema.optionalKey(Schema.String) }))
  }))
})
export type S = typeof S.Type
export const N = Schema.Struct({
  items: Schema.mutableKey(Schema.mutable(Schema.Array(Schema.Struct({ tag: Schema.optionalKey(Schema.String) })))),
  table: Schema.Record(Schema.String, Schema.mutableKey(Schema.Struct({ n: Schema.optionalKey(Schema.Number) }))),
  pair: Schema.Tuple([Schema.String, Schema.optionalKey(Schema.Number)])
})
export type N = typeof N.Type
export class E extends Schema.TaggedError<E>()("E", {
  plain: Schema.optionalKey(Schema.String),
  loose: Schema.optional(Schema.String)
}) {}
export const T = Schema.mutable(Schema.Tuple([Schema.String, Schema.optionalKey(Schema.Number)]))
export type T = typeof T.Type
export const U = Schema.Tuple([Schema.String, Schema.optional(Schema.Number)])
export type U = typeof U.Type
export type D = Data.TaggedEnum<{ Ready: { plain?: string; loose?: string | undefined } }>
export const D = Data.taggedEnum<D>()
export const looseUndefined = D.Ready({ loose: undefined })
export const Exact = Schema.Struct({
  name: Schema.optionalKey(Schema.String),
  explicit: Schema.optional(Schema.String)
})
export type Exact = typeof Exact.Type
export type SEncoded = typeof S.Encoded
export type NEncoded = typeof N.Encoded
export type EEncoded = typeof E.Encoded
export type TEncoded = typeof T.Encoded
export type UEncoded = typeof U.Encoded
