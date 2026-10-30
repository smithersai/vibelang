import { Schema } from "effect"
class Model extends Schema.Class<Model>("Model")({ value: Schema.String }) {}
const Optional = Schema.optionalKey(Schema.Number)
const Mutable = Schema.mutableKey(Schema.String)
export const ModelAlias = Model
export type ModelAlias = typeof ModelAlias.Type
export const OptionalAlias = Optional
export type OptionalAlias = typeof OptionalAlias.Type
export const MutableAlias = Mutable
export type MutableAlias = typeof MutableAlias.Type
export const UnknownAlias = Schema.Unknown
export type UnknownAlias = typeof UnknownAlias.Type
export const AnyAlias = Schema.Any
export type AnyAlias = typeof AnyAlias.Type
