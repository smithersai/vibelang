import { Effect, Schema } from "effect";
export declare const Address: Schema.Struct<{
    readonly city: Schema.String;
    readonly zip: Schema.optional<Schema.String>;
}>;
export type Address = typeof Address.Type;
export declare const User: Schema.Struct<{
    readonly id: Schema.String;
    readonly name: Schema.String;
    readonly nickname: Schema.optional<Schema.String>;
    readonly role: Schema.Literals<readonly ["admin", "member"]>;
    readonly tags: Schema.$Array<Schema.String>;
    readonly home: Schema.Struct<{
        readonly city: Schema.String;
        readonly zip: Schema.optional<Schema.String>;
    }>;
    readonly score: Schema.Tuple<readonly [Schema.Number, Schema.String]>;
    readonly counts: Schema.$Record<Schema.String, Schema.mutableKey<Schema.Number>>;
    readonly verified: Schema.Union<readonly [Schema.Boolean, Schema.Null]>;
    readonly login: Schema.Struct<{
        readonly at: Schema.Number;
    }>;
}>;
export type User = typeof User.Type;
export declare function main(): Effect.Effect<{
    a: string | {
        readonly id: string;
        readonly name: string;
        readonly nickname?: string | undefined;
        readonly role: "admin" | "member";
        readonly tags: readonly string[];
        readonly home: {
            readonly city: string;
            readonly zip?: string | undefined;
        };
        readonly score: readonly [number, string];
        readonly counts: {
            [x: string]: number;
        };
        readonly verified: boolean | null;
        readonly login: {
            readonly at: number;
        };
    };
    b: string | {
        readonly id: string;
        readonly name: string;
        readonly nickname?: string | undefined;
        readonly role: "admin" | "member";
        readonly tags: readonly string[];
        readonly home: {
            readonly city: string;
            readonly zip?: string | undefined;
        };
        readonly score: readonly [number, string];
        readonly counts: {
            [x: string]: number;
        };
        readonly verified: boolean | null;
        readonly login: {
            readonly at: number;
        };
    };
    c: boolean;
}, never, never>;
