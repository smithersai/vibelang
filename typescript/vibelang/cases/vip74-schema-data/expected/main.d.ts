import { Effect, Schema } from "effect";
export declare const Address: Schema.Struct<{
    readonly city: Schema.String;
}>;
export type Address = typeof Address.Type;
export declare const Delivery: Schema.TaggedUnion<{
    readonly Failed: Schema.TaggedStruct<"Failed", {
        readonly code: Schema.mutableKey<Schema.Number>;
    }>;
    readonly Sent: Schema.TaggedStruct<"Sent", {
        readonly tracking: Schema.String;
        readonly note: Schema.mutableKey<Schema.optional<Schema.String>>;
        readonly address: Schema.mutableKey<Schema.Struct<{
            readonly city: Schema.String;
        }>>;
    }>;
    readonly Waiting: Schema.TaggedStruct<"Waiting", {}>;
}>;
export type Delivery = typeof Delivery.Type;
/** @throws {never} */
export declare function describe(d: Delivery): string;
export declare function main(): Effect.Effect<{
    decoded: string[];
    guard: boolean;
    encodedTag: "Failed" | "Sent" | "Waiting";
    unionMatch: string;
}, Schema.SchemaError, never>;
