import { Data } from "effect";
/** Type docs. */
export type Item = Data.TaggedEnum<{
    A: {};
}>;
/** Constructor docs. */
export declare const Item: Data.TaggedEnum.Constructor<{
    readonly _tag: "A";
}>;
