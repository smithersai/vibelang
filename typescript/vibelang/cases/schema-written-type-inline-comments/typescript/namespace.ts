import { Schema } from "effect";
export namespace Model {
/** Value docs. */ export const Message = Schema.Struct({ id: Schema.mutableKey(Schema.String) }); /** Type docs. */ export type Message = typeof Message.Type
}
