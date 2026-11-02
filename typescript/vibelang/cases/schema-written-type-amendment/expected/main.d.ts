import { Schema } from "effect";
/** The constant's documentation. */
export declare const Message: Schema.Struct<{
    readonly id: Schema.mutableKey<Schema.String>;
}>;
/** The type's documentation. */
export type Message = typeof Message.Type;
