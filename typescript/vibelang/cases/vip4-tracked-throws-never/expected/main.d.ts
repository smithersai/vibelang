import { Effect } from "effect";
declare const NotFound_base: new <A extends Record<string, any> = {}>(args: import("effect/Types").VoidIfEmpty<{ readonly [P in keyof A as P extends "_tag" ? never : P]: A[P]; }>) => import("effect/Cause").YieldableError & {
    readonly _tag: "NotFound";
} & Readonly<A>;
declare class NotFound extends NotFound_base<{
    readonly id: string;
}> {
}
/** @throws {never} */
export declare function add(a: number, b: number): number;
export declare function sum(): Effect.Effect<number, never, never>;
export declare function load(id: string): Effect.Effect<string, NotFound, never>;
export {};
