import { Effect } from "effect";
export declare const read: (box: {
    readonly value: string;
}) => Effect.Effect<string, never, never>;
export declare const again: (box: {
    readonly value: string;
}) => Effect.Effect<string, never, never>;
export declare const count: (input: {
    readonly n: number;
}) => Effect.Effect<number, never, never>;
export declare const run: () => number;
