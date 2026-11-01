import { Effect } from "effect";
export declare function clamp(n: number): number;
export declare function length(value: any): any;
export declare function rethrown(n: number): string | number;
export declare function main(): Effect.Effect<{
    clamp: number[];
    length: any[];
    defect: string[];
    rethrown: (string | number)[];
    steps: string[];
}, never, never>;
