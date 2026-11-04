import { Schema } from "effect";
export declare namespace Model {
    /** Value docs. */ const Message: Schema.Struct<{
        readonly id: Schema.mutableKey<Schema.String>;
    }>; /** Type docs. */
    type Message = typeof Message.Type;
}
