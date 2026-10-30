import { Schema, SchemaAST } from "effect"

export const decode = Schema.decodeUnknownSync(Schema.String)
export const first: SchemaAST.ParseOptions = { errors: "first" }
