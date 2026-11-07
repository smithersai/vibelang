import { Data, Schema } from "effect"
export const S = Schema.Struct({
  plain: Schema.mutableKey(Schema.optional(Schema.String)),
  frozen: Schema.optional(Schema.Number),
  loose: Schema.mutableKey(Schema.optional(Schema.String)),
  nested: Schema.optional(Schema.Struct({
    value: Schema.mutableKey(Schema.optional(Schema.Boolean)),
    inner: Schema.optional(Schema.Struct({ deep: Schema.optional(Schema.String) }))
  }))
})
export type S = typeof S.Type
export const N = Schema.Struct({
  items: Schema.mutableKey(Schema.mutable(Schema.Array(Schema.Struct({ tag: Schema.optional(Schema.String) })))),
  table: Schema.Record(Schema.String, Schema.mutableKey(Schema.Struct({ n: Schema.optional(Schema.Number) }))),
  pair: Schema.Tuple([Schema.String, Schema.optional(Schema.Number)])
})
export type N = typeof N.Type
export class E extends Schema.TaggedError<E>()("E", {
  plain: Schema.optional(Schema.String),
  loose: Schema.optional(Schema.String)
}) {}
export const T = Schema.mutable(Schema.Tuple([Schema.String, Schema.optional(Schema.Number)]))
export type T = typeof T.Type
export const U = Schema.Tuple([Schema.String, Schema.optional(Schema.Number)])
export type U = typeof U.Type
export type D = Data.TaggedEnum<{ Ready: { plain?: string; loose?: string | undefined } }>
export const D = Data.taggedEnum<D>()
export const looseUndefined = D.Ready({ loose: undefined })
export const Sugar = Schema.Struct({ name: Schema.optional(Schema.String) })
export type Sugar = typeof Sugar.Type
export const Direct = Schema.Struct({ name: Schema.optionalKey(Schema.String) })
export type Direct = typeof Direct.Type
export const plainUndefined = D.Ready({ plain: undefined })
const present: S = { plain: undefined }
const element: T = ["a", undefined]
export const typed = [present, element]
export type SEncoded = typeof S.Encoded
export type NEncoded = typeof N.Encoded
export type EEncoded = typeof E.Encoded
export type TEncoded = typeof T.Encoded
export type UEncoded = typeof U.Encoded
