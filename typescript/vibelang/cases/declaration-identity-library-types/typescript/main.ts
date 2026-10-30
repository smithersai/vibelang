import { Context, Effect, Schema } from "effect"

export const decode = Schema.decodeUnknownSync(Schema.String)
export const decodeEffect = Schema.decodeUnknownEffect(Schema.String)
export const makeContext = Context.make
