import { Effect } from "effect";
export declare function direct(flag: boolean): Effect.Effect<string | number, never, never>;
export declare function byName(flag: boolean): Effect.Effect<string | number, never, never>;
export declare function main(): Effect.Effect<(string | number)[], "refused", never>;
