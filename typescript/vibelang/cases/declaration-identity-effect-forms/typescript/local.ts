import { Schema } from "effect"

const log = (text: string): string => text
export const decode = Schema.decodeUnknownEffect(Schema.String)
export const said = log("hi")
