export declare const scalar: {
    /** @throws {never} */
    (value: number): string;
};
export type Tree = {
    readonly _tag: "Leaf";
    readonly text: string;
} | {
    readonly _tag: "Branch";
    readonly children: readonly Tree[];
};
export declare const tree: {
    /** @throws {never} */
    (value: Tree): string;
};
export declare const pipelineTree: {
    /** @throws {never} */
    (values: readonly Tree[]): string;
};
