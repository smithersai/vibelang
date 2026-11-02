import { Schema } from "effect";
/** The constant's documentation. */
export const Message = Schema.Struct({ id: Schema.String });
/** The type's documentation. */
export type Message = typeof Message.Type;
