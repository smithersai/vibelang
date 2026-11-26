import { Data } from "effect";
/** Type docs. */
export type Item = Data.TaggedEnum<{
    A: {};
}>;
/** Constructor docs. */
export const Item = Data.taggedEnum<Item>();
