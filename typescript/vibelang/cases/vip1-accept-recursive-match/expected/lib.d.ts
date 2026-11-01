export declare const scalar: (value: number) => string;
export type Tree = {
    readonly _tag: "Leaf";
    readonly text: string;
} | {
    readonly _tag: "Branch";
    readonly children: readonly Tree[];
};
export declare const tree: (value: Tree) => string;
export declare const pipelineTree: (values: readonly Tree[]) => string;
