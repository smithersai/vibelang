import { Schema } from "effect"

export const Keyed = Schema.Struct({
  byDate: Schema.ReadonlyMap(Schema.Date, Schema.Number),
  byPair: Schema.ReadonlyMap(Schema.Tuple([Schema.String, Schema.Number]), Schema.String),
  bySet: Schema.ReadonlyMap(Schema.ReadonlySet(Schema.String), Schema.Boolean),
  nested: Schema.Array(Schema.ReadonlyMap(Schema.URL, Schema.ReadonlySet(Schema.Date))),
})
export type Keyed = typeof Keyed.Type
