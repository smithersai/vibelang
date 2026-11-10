import { Effect, Schema } from "effect";
export declare const Triage: import("vibelang-runtime").Workflow<[repo: string], number, string, {
    readonly payload: {
        repo: Schema.String;
    };
    readonly success: Schema.Number;
    readonly error: Schema.String;
}>;
export declare function main(): Effect.Effect<{
    fields: string[][];
    since: string;
    labels: string[];
    cents: string;
    failure: boolean;
    success: boolean;
    log: boolean[];
    triage: boolean[];
}, Schema.SchemaError, never>;
