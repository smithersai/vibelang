import * as Schema from "effect/Schema"
/** @internal */
export const Message = Schema.Struct({ id: Schema.String })
export type Message = typeof Message.Type
