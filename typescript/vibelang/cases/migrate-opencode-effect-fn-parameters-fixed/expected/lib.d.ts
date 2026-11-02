import { Effect, Schema } from "effect";
export declare const Path: Schema.brand<Schema.String, "Path">;
export type Path = typeof Path.Type;
export declare const cleanup: (files: readonly string[]) => Effect.Effect<number, never, never>;
export declare const canonical: (input: string & import("effect/Brand").Brand<"Path">) => Effect.Effect<string & import("effect/Brand").Brand<"Path">, never, never>;
export declare const explicit: (files: readonly string[]) => Effect.Effect<number, never, never>;
export declare const optional: (input?: (() => number) | undefined) => Effect.Effect<(() => number) | undefined, never, never>;
