import { Schema } from "effect";
/** A 2D point in canvas-local coordinates. */
export declare const Point: Schema.Struct<{
    readonly x: Schema.Number;
    readonly y: Schema.Number;
}>;
/** A 2D point in canvas-local coordinates. */
export type Point = typeof Point.Type;
/** The preserved model, as stored. */
export declare const Preserved: Schema.Struct<{
    readonly version: Schema.Number;
}>;
/** The decoded preserved model. */
export type Preserved = typeof Preserved.Type;
/** Documented on the constant alone. */
export declare const Bare: Schema.Struct<{
    readonly id: Schema.String;
}>;
export type Bare = typeof Bare.Type;
