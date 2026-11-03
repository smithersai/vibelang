import { Effect } from "effect";
/** @throws {never} */
export declare function clamp(n: number): number;
/** @throws {never} */
export declare function length(value: any): any;
/** @throws {never} */
export declare function rethrown(n: number): unknown;
export declare function main(): Effect.Effect<{
    clamp: number[];
    length: any[];
    defect: string[];
    rethrown: unknown[];
    steps: string[];
}, never, never>;
