import { Effect } from "effect";
export declare const Triage: import("vibelang-runtime").Workflow<[repo: string], number, string>;
export declare function main(): Effect.Effect<{
    keys: string[];
    options: import("vibelang-runtime").DurableOptions[];
    count: number;
    runs: string[];
    words: (string | number)[];
}, string, never>;
