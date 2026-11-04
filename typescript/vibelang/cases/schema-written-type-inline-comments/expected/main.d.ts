import { Schema } from "effect";
/** Value docs. */ export declare const Message: Schema.Struct<{
    readonly id: Schema.mutableKey<Schema.String>;
}>; /** Type docs. */
export type Message = typeof Message.Type;
