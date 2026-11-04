/** @throws {never} */
export declare const scalar: (value: number) => string;
export type Tree = {
    readonly _tag: "Leaf";
    readonly text: string;
} | {
    readonly _tag: "Branch";
    readonly children: readonly Tree[];
};
/** @throws {never} */
export declare const tree: (value: Tree) => string;
/** @throws {never} */
export declare const pipelineTree: (values: readonly Tree[]) => string;
