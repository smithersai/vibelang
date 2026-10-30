import { Effect } from "effect";
declare const NotFound_base: new <A extends Record<string, any> = {}>(args: import("effect/Types").VoidIfEmpty<{ readonly [P in keyof A as P extends "_tag" ? never : P]: A[P]; }>) => import("effect/Cause").YieldableError & {
    readonly _tag: "NotFound";
} & Readonly<A>;
export declare class NotFound extends NotFound_base<{
    readonly id: string;
}> {
}
export declare function main(): Effect.Effect<{
    timeout: string;
    missing: string;
    wrapped: number;
    label: string;
}, never, never>;
export {};
