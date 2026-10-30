import { Schema } from "effect"
export const A = Schema.Struct({ c: Schema.optional(Schema.String) })
console.log("checked")
