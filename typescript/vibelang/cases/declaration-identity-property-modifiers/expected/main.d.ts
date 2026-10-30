export interface Shape {
    value: number;
}
export interface Optional {
    value?: number;
    readonly fixed?: string;
}
export interface Dictionary {
    [key: string]: number;
}
export interface ReadonlyDictionary {
    readonly [key: string]: number;
}
export type Literal = {
    value: number;
    optional?: string;
    readonly fixed: number;
};
export type Nested = {
    inner: {
        value: number;
    };
    readonly fixed: {
        value: number;
    };
};
export type Wrapped = Readonly<{
    inner: {
        value: number;
    };
    readonly fixed: number;
}>;
export declare class Fields {
    value: number;
    optional?: string;
    readonly fixed: number;
    static count: number;
    static readonly version: number;
}
export interface Explicit {
    readonly value: number;
}
