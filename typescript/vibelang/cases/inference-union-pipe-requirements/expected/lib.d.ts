import * as Effect from "effect/Effect";
export interface A {
    readonly a: "A";
}
export interface B {
    readonly b: "B";
}
export declare const provider: Effect.Effect<string, never, B>;
