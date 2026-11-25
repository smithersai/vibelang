import { Effect, Scope } from "effect";
declare const NotFound_base: new <A extends Record<string, any> = {}>(args: import("effect/Types").VoidIfEmpty<{ readonly [P in keyof A as P extends "_tag" ? never : P]: A[P]; }>) => import("effect/Cause").YieldableError & {
    readonly _tag: "NotFound";
} & Readonly<A>;
declare class NotFound extends NotFound_base<{
    readonly id: string;
}> {
}
declare const Timeout_base: new <A extends Record<string, any> = {}>(args: import("effect/Types").VoidIfEmpty<{ readonly [P in keyof A as P extends "_tag" ? never : P]: A[P]; }>) => import("effect/Cause").YieldableError & {
    readonly _tag: "Timeout";
} & Readonly<A>;
declare class Timeout extends Timeout_base {
}
export declare function find(id: string): Effect.Effect<string, NotFound>;
export declare function lookup(id: string): Effect.Effect<string, NotFound | Timeout>;
export declare function count(): Effect.Effect<number>;
export type Finder = (id: string) => Effect.Effect<string, NotFound>;
export type Scoped = Effect.Effect<string, NotFound, Scope.Scope>;
export type Values = ReadonlyArray<Effect.Effect<number>>;
export declare function main(): Effect.Effect<{
    found: string;
    slow: string;
    missing: string;
    count: number;
    plain: string;
}, NotFound | Timeout, never>;
export {};
