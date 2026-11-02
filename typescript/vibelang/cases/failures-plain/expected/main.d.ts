import { Effect } from "effect";
export declare function clamp(n: number): Effect.Effect<number, never, never>;
export declare function length(value: any): Effect.Effect<any, never, never>;
export declare function rethrown(n: number): Effect.Effect<string | number, never, never>;
export declare function main(): Effect.Effect<{
    clamp: number[];
    length: any[];
    defect: string[];
    rethrown: (string | number)[];
    steps: string[];
}, never, never>;
