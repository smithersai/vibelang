import { Schema } from "effect"
export const Canonical=Schema.Record(Schema.Literal("x"),Schema.Number)
export type Canonical=typeof Canonical.Type
export const QualifiedInner=Schema.Record(Schema.Literal("x"),Schema.Number)
export type QualifiedInner=typeof QualifiedInner.Type
export const QualifiedOuter=Schema.Record(Schema.Literal("x"),Schema.Number)
export type QualifiedOuter=typeof QualifiedOuter.Type
export const Both=Schema.Record(Schema.Literal("x"),Schema.Number)
export type Both=typeof Both.Type
export const Renamed=Schema.Record(Schema.Literal("x"),Schema.Number)
export type Renamed=typeof Renamed.Type
export const CrossA=Schema.Record(Schema.Literal("x"),Schema.Number)
export type CrossA=typeof CrossA.Type
export const CrossR=Schema.Record(Schema.Literal("x"),Schema.Number)
export type CrossR=typeof CrossR.Type
export const Nested=Schema.Record(Schema.Literal("x"),Schema.mutable(Schema.Array(Schema.Number)))
export type Nested=typeof Nested.Type
