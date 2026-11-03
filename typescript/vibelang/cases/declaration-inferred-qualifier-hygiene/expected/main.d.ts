export declare const SchemaAST = "local";
export declare const decode: (input: unknown, options?: import("effect/SchemaAST").ParseOptions) => string;
export declare const encode: (input: {
    readonly value: number;
}, options?: import("effect/SchemaAST").ParseOptions) => {
    readonly value: number;
};
