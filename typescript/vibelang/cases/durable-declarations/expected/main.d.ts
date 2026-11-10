import { Effect, Schema } from "effect";
export declare const Triage: import("vibelang-runtime").Workflow<[repo: string], number, string, {
    readonly payload: {
        repo: Schema.String;
    };
}, never>;
export declare function main(): Effect.Effect<{
    keys: string[];
    options: import("vibelang-runtime").DurableOptions[];
    counts: number[];
    calls: string[];
    words: (string | number)[];
}, string, never>;
