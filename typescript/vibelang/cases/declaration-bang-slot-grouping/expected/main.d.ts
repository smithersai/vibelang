import { Clock, Effect, Path } from "effect";
export declare function bytes<Format extends "bytes" | "hex">(options: {
    readonly format: Format;
}): Effect.Effect<Format extends "bytes" ? Uint8Array : string, string>;
export type Success = Effect.Effect<string | number, boolean>;
export type Failure = Effect.Effect<string, number | boolean>;
export type Requirement = Effect.Effect<string, boolean, Path.Path | Clock.Clock>;
export type Callback = Effect.Effect<() => void, string>;
export type Nested = Effect.Effect<Effect.Effect<string, number>, boolean>;
export type Inside = Effect.Effect<(keyof (A | B))[], string>;
export type Written = Effect.Effect<(string | number), boolean>;
type A = {
    a: 1;
};
type B = {
    b: 2;
};
export {};
