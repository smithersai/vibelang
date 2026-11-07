import { Effect } from "effect";
export declare function failure(): Effect.Effect<number, string, never>;
export declare function success(): Effect.Effect<number, never, never>;
export declare function every(): Effect.Effect<string, never, never>;
export declare const object: {
    m(): Effect.Effect<number, never, never>;
};
export declare function shorthand(): Effect.Effect<boolean, never, never>;
