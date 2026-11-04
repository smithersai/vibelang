import { Effect, Scope } from "effect";
export { NotFound } from "./users.ts";
export declare const one: Effect.Effect<number>;
export declare const scoped: Effect.Effect<void, never, Scope.Scope>;
export declare function main(): Effect.Effect<string, import("./users.ts").NotFound, never>;
