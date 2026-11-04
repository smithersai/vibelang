import { Schema } from "effect";
/** Value docs. */ export const Message = Schema.Struct({ id: Schema.mutableKey(Schema.String) }); /** Type docs.
 * Details retained across lines.
 */ export type Message = typeof Message.Type
