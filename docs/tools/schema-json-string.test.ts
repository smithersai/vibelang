import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { Schema } from "effect"
import fc from "fast-check"
import { extract } from "./check-snippets"

test("the JSON string guide shows the embedded object's exported schema", () => {
  const page = readFileSync(new URL("../user/src/schema/101-json-schema.md", import.meta.url), "utf8")
  const block = extract(page).find(block => block.source.includes("const DepotText"))
  const depot = Schema.Struct({ name: Schema.String, capacity: Schema.Finite })
  const document = Schema.toJsonSchemaDocument(Schema.fromJsonString(depot))
  expect(JSON.parse(block!.output!)).toEqual(document.schema)
  expect(block!.pending).toBeUndefined()
})

test("JSON string exports retain their nested encoded schemas", () => {
  fc.assert(fc.property(
    fc.dictionary(fc.string({ minLength: 1, maxLength: 12 }), fc.constantFrom(
      Schema.String, Schema.Finite, Schema.Boolean, Schema.FiniteFromString,
      Schema.optionalKey(Schema.String)
    ), { minKeys: 1, maxKeys: 5 }),
    fields => {
      const schema = Schema.Struct(fields)
      expect(Schema.toJsonSchemaDocument(Schema.fromJsonString(schema)).schema).toEqual({
        type: "string",
        contentMediaType: "application/json",
        contentSchema: Schema.toJsonSchemaDocument(schema).schema
      })
    }
  ), { seed: 10113, numRuns: 100 })
})
