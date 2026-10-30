import { Effect } from "effect";
declare const UserNotFound_base: new <A extends Record<string, any> = {}>(args: import("effect/Types").VoidIfEmpty<{ readonly [P in keyof A as P extends "_tag" ? never : P]: A[P]; }>) => import("effect/Cause").YieldableError & {
    readonly _tag: "UserNotFound";
} & Readonly<A>;
export declare class UserNotFound extends UserNotFound_base<{
    readonly id: string;
}> {
}
declare const Invalid_base: new <A extends Record<string, any> = {}>(args: import("effect/Types").VoidIfEmpty<{ readonly [P in keyof A as P extends "_tag" ? never : P]: A[P]; }>) => import("effect/Cause").YieldableError & {
    readonly _tag: "Invalid";
} & Readonly<A>;
export declare class Invalid extends Invalid_base<{
    readonly raw: string;
}> {
}
export interface User {
    id: string;
    name: string;
}
export declare function find(id: string): Effect.Effect<User, UserNotFound, never>;
export declare function wide(id: string): Effect.Effect<string, UserNotFound | Invalid, never>;
export declare function answer(): Effect.Effect<number, never, never>;
export declare function point(): Effect.Effect<{
    x: number;
    kind: "point";
}, never, never>;
export declare function greeting(id: string): Effect.Effect<string, UserNotFound, never>;
export declare function safe(id: string): Effect.Effect<string, never, never>;
export declare function named(id: string): Effect.Effect<{
    id: string;
    name: string;
}, UserNotFound, never>;
export declare function everything(id: string): Effect.Effect<User, UserNotFound, never>;
export declare const twice: (n: number) => number;
export declare function main(): Effect.Effect<{
    find: string;
    wide: string;
    answer: number;
    point: "point";
    greeting: string;
    safe: string;
    named: string;
    everything: string;
    twice: number;
}, Invalid | UserNotFound, never>;
export {};
