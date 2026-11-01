import { Effect, Scope } from "effect";
export declare function withResource<A extends Disposable, R>(open: () => Effect.Effect<A, never, R>): Effect.Effect<string, never, Exclude<R, Scope.Scope>>;
export declare function withResourceTyped<A extends Disposable, R>(open: () => Effect.Effect<A, never, R>): Effect.Effect<string, never, Exclude<R, Scope.Scope>>;
export declare function withScoped<A, R extends Scope.Scope>(open: () => Effect.Effect<A, never, R>): Effect.Effect<string, never, Exclude<R, Scope.Scope>>;
