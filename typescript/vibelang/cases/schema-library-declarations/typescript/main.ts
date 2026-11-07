import { Schema } from "effect"

export const Order = Schema.Struct({
  id: Schema.String,
  at: Schema.Date,
  tags: Schema.ReadonlySet(Schema.String),
  counts: Schema.ReadonlyMap(Schema.String, Schema.Number),
  cause: Schema.Defect().pipe(Schema.refine((u): u is Error => u instanceof Error)),
})
export type Order = typeof Order.Type
