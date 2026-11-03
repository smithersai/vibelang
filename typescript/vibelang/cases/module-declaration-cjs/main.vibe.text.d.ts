import { Effect } from "effect";
export interface Cleaned {
    readonly value: string;
    readonly length: number;
}
export type Mode = "trim" | "upper";
export declare const separator = "-";
export declare function clean(value: string, mode?: Mode): Cleaned;
export declare function safeLength(value: string): number;
export declare function later(file: string): Promise<string>;
export declare const greet: (name: string) => Effect.Effect<string, never, never>;
export default class Counter {
    count: number;
    increment(): number;
}
