import * as Effect from "effect/Effect";
export declare const one: () => Effect.Effect<number, never, never>;
export declare const two: (input: {
    value: number;
}) => Effect.Effect<number, never, never>;
export declare function three(): Effect.Effect<number, never, never>;
