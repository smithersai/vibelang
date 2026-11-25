import { Effect } from "effect";
declare const NotFound_base: new <A extends Record<string, any> = {}>(args: import("effect/Types").VoidIfEmpty<{ readonly [P in keyof A as P extends "_tag" ? never : P]: A[P]; }>) => import("effect/Cause").YieldableError & {
    readonly _tag: "NotFound";
} & Readonly<A>;
declare class NotFound extends NotFound_base<{
    readonly id: string;
}> {
}
export declare function mapAll<A, B, E, R>(items: ReadonlyArray<A>, f: (a: A) => Effect.Effect<B, E, R>): Effect.Effect<B[], E, R>;
export declare function mapSafe<A, B>(items: ReadonlyArray<A>, f: (a: A) => Effect.Effect<B, never, never>): Effect.Effect<B[], never, never>;
export declare function withRetry<A, E, R>(times: number, program: () => Effect.Effect<A, E, R>): Effect.Effect<A, E, R>;
export declare function main(): Effect.Effect<{
    names: string[];
    sizes: number[];
    safe: number[];
    retried: number;
    caught: string;
}, NotFound, never>;
export {};
