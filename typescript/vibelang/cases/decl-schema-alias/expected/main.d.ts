import { Effect, Schema } from "effect";
export declare const Code: Schema.Literals<readonly ["root_missing", "read_failed"]>;
export type Code = typeof Code.Type;
export declare const Port: Schema.Number;
export type Port = typeof Port.Type;
export declare function main(): Effect.Effect<{
    code: string;
    invalid: string;
    described: string;
    port: boolean;
    id: boolean[];
    tags: readonly string[];
    names: boolean;
    pair: readonly [string, number];
    counts: {
        [x: string]: number;
    };
    point: {
        readonly x: number;
        readonly y?: number | undefined;
    };
    home: {
        readonly city: string;
    };
    status: boolean[];
    flag: boolean;
    version: number;
}, Schema.SchemaError, never>;
