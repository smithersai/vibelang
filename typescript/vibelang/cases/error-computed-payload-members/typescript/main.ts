import { Data, Schema } from "effect"

const key = "computed" as const
export class Entry extends Data.TaggedError("Entry")<{
  readonly "quoted": number
  readonly 7: number
  readonly [key]: number
}> {}
export const entry = new Entry({ quoted: 1, 7: 2, computed: 3 })

export class SchemaEntry extends Schema.TaggedError<SchemaEntry>()("SchemaEntry", {
  "quoted": Schema.Number,
  7: Schema.Number,
  [key]: Schema.Number
}) {}
export const schemaEntry = new SchemaEntry({ quoted: 4, 7: 5, computed: 6 })

export const fields: readonly [number, number, number] = [entry.quoted, entry[7], entry.computed]
export const schemaFields: readonly [number, number, number] = [schemaEntry.quoted, schemaEntry[7], schemaEntry.computed]
