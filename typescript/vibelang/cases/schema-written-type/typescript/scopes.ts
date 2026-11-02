import { Schema } from "effect";
export namespace Outer {
    /** Outer schema. */
    export const Message = Schema.String;
    /** Outer type. */
    export type Message = typeof Message.Type;
    export namespace Inner {
        /** Inner type before schema. */
        export type Message = typeof Message.Type;
        /** Inner schema. */
        export const Message = Schema.Struct({ id: Schema.String });
    }
}
