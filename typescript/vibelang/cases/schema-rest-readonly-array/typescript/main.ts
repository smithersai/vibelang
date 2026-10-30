import { Schema } from "effect"
type LegalReadonlyRest = [head: string, ...tail: readonly number[]]
const legal: LegalReadonlyRest = ["x", 1]
export const ReadonlyRest = Schema.TupleWithRest(Schema.Tuple([Schema.String]), [Schema.Number])
export type ReadonlyRest = typeof ReadonlyRest.Type
export const MutableRest = Schema.mutable(Schema.TupleWithRest(Schema.Tuple([Schema.String]), [Schema.Number]))
export type MutableRest = typeof MutableRest.Type
const writable: MutableRest = ["x", 1]
writable.push(2)
export const GenericReadonlyRest = Schema.TupleWithRest(Schema.Tuple([Schema.String]), [Schema.Number])
export type GenericReadonlyRest = typeof GenericReadonlyRest.Type
export const GenericMutableRest = Schema.mutable(Schema.TupleWithRest(Schema.Tuple([Schema.String]), [Schema.Number]))
export type GenericMutableRest = typeof GenericMutableRest.Type
