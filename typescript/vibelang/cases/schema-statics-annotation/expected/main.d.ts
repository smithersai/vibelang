import { Schema } from "effect";
import * as Effect from "effect/Effect";
export declare const TextPart: Schema.Struct<{
    readonly type: Schema.Literal<"text">;
    readonly text: Schema.String;
}> & {
    /** @throws {never} */
    make: (input: {
        readonly text: string;
    }) => TextPart;
};
export type TextPart = typeof TextPart.Type;
export declare const Counter: Schema.Struct<{
    readonly n: Schema.Number;
}> & {
    make: (n: number) => Effect.Effect<typeof Counter.Type, never, never>;
};
export declare function main(): Effect.Effect<{
    part: {
        readonly type: "text";
        readonly text: string;
    };
    counter: number;
}, never, never>;
