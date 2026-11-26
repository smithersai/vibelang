import { Data, Effect } from "effect";
export namespace Outer {
    /** Outer type docs. */
    export type Item = Data.TaggedEnum<{
        A: {};
        B: {
            readonly value: number;
        };
    }>;
    /** Outer constructor docs. */
    export const Item = Data.taggedEnum<Item>();
    export namespace Inner {
        /** Inner constructor before data. */
        export const Item = Data.taggedEnum<Item>();
        /** Inner type docs. */
        export type Item = Data.TaggedEnum<{
            A: {};
        }>;
    }
}
export function use(b: Outer.Item): Effect.Effect<number, never, never> {
    return Effect.gen(function* () {
        const a = Outer.Item.A();
        return b._tag === "A" ? (a._tag === "A" ? 0 : 1) : b.value;
    });
}
