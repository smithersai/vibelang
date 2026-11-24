import { Effect } from "effect";
export declare function make(n: number): Effect.Effect<number>;
/** @throws {never} */
export declare function kept(): Effect.Effect<number, never, never>[];
/** @throws {never} */
export declare function dropped(): void;
