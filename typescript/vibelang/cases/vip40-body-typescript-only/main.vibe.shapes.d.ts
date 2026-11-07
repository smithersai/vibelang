export declare enum Kind {
    Circle = "circle"
}
export declare namespace Geometry {
    const unit = 1;
}
export declare class Point {
    readonly x: number;
    /** @throws {never} */
    constructor(x: number);
}
export declare const resolved: "bigint" | "boolean" | "function" | "number" | "object" | "string" | "symbol" | "undefined";
