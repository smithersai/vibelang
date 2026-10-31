export declare function seed(b: boolean): {
    readonly status: 1;
} | {
    readonly status?: never;
};
export declare function read(b: boolean): {
    status: number;
} | {
    status?: never;
};
