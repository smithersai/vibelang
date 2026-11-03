import { Effect } from "effect";
export declare const program: (n: number) => Effect.Effect<void, Error, never>;
export declare const reverse: (n: number) => Effect.Effect<void, Error, never>;
export declare const control: (n: number) => Effect.Effect<void, Error, never>;
export declare const tagged: (n: number) => Effect.Effect<void, import("./lib.js").TagError, never>;
export declare const only: (n: number) => Effect.Effect<number, never, never>;
