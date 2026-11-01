import { Data } from "effect";
export type Shape = Data.TaggedEnum<{
    Circle: {
        radius: number;
    };
    Square: {
        side: number;
    };
    Dot: {};
}>;
export declare const Shape: Data.TaggedEnum.Constructor<{
    readonly _tag: "Circle";
    readonly radius: number;
} | {
    readonly _tag: "Dot";
} | {
    readonly _tag: "Square";
    readonly side: number;
}>;
export type Tree<A> = Data.TaggedEnum<{
    Leaf: {
        value: A;
    };
    Node: {
        left: Tree<A>;
        right: Tree<A>;
    };
}>;
export interface TreeDefinition extends Data.TaggedEnum.WithGenerics<1> {
    readonly taggedEnum: Tree<this["A"]>;
}
export declare const Tree: Data.TaggedEnum.GenericConstructor<TreeDefinition>;
export declare function area(shape: Shape): number;
