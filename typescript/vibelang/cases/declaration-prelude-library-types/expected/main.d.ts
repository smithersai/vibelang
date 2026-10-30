import { Context, Effect, Schema } from "effect";
export declare const done: (value: typeof Schema.Json.Type) => number;
export declare const decodeName: (input: unknown, options?: import("effect/SchemaAST").ParseOptions) => Effect.Effect<string, Schema.SchemaError, never>;
export declare const makeContext: <I, S>(key: Context.Key<I, S>, service: import("effect/Types").NoInfer<S>) => Context.Context<I>;
