import { Schema } from "effect"
const RequiredNumber = Schema.Number
export const Writable = Schema.Record(Schema.Literal("a"), Schema.mutableKey(RequiredNumber))
export type Writable = typeof Writable.Type
export const Readonly = Schema.Record(Schema.Literal("a"), Schema.Number)
export type Readonly = typeof Readonly.Type
export const PresentUndefined = Schema.Record(Schema.Literal("a"), Schema.mutableKey(Schema.Union([Schema.Number, Schema.Undefined])))
export type PresentUndefined = typeof PresentUndefined.Type
export const ReadonlyArrays = Schema.Record(Schema.String, Schema.mutable(Schema.Array(Schema.Number)))
export type ReadonlyArrays = typeof ReadonlyArrays.Type
export const Nested = Schema.Record(Schema.String, Schema.Struct({ value: Schema.Number }))
export type Nested = typeof Nested.Type
const DeclaredNumber = Schema.Number
type DeclaredNumber = typeof DeclaredNumber.Type
export const ViaDeclaration = Schema.Record(Schema.String, DeclaredNumber)
export type ViaDeclaration = typeof ViaDeclaration.Type
