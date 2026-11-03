import { Effect } from "effect";
export declare function clamp(n: number): number;
export declare function length(value: any): any;
export declare function rethrown(n: number): unknown;
export declare function main(): Effect.Effect<{
    clamp: number[];
    length: any[];
    defect: string[];
    rethrown: unknown[];
    steps: string[];
}, never, never>;
