import { Effect } from "effect";
export interface Options {
    readonly label?: string;
}
export declare const make: (options?: Options | undefined) => Effect.Effect<string, never, never>;
export declare const resolve: (input?: {
    readonly host?: string;
} | undefined) => Effect.Effect<string, never, never>;
export declare const open: (name: string, retries?: number | undefined) => Effect.Effect<number, never, never>;
export declare const pick: (value?: number | undefined) => Effect.Effect<number, never, never>;
