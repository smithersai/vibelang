import { Schema } from "effect"
const RequiredNumber = Schema.Number
export const Pair = Schema.Tuple([Schema.String, RequiredNumber])
export type Pair = typeof Pair.Type
export const PresentUndefined = Schema.Tuple([Schema.Union([Schema.Number, Schema.Undefined])])
export type PresentUndefined = typeof PresentUndefined.Type
export const Nested = Schema.Tuple([Schema.Tuple([Schema.String, Schema.Number])])
export type Nested = typeof Nested.Type
export const ObjectSlot = Schema.Tuple([Schema.Struct({ value: Schema.Number })])
export type ObjectSlot = typeof ObjectSlot.Type
export const ArraySlot = Schema.Tuple([Schema.mutable(Schema.Array(Schema.Number))])
export type ArraySlot = typeof ArraySlot.Type
const DeclaredNumber = Schema.Number
type DeclaredNumber = typeof DeclaredNumber.Type
export const ViaDeclaration = Schema.Tuple([DeclaredNumber])
export type ViaDeclaration = typeof ViaDeclaration.Type
