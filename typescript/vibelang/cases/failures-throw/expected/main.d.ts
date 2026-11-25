import { Effect } from "effect";
declare const InvalidId_base: new <A extends Record<string, any> = {}>(args: import("effect/Types").VoidIfEmpty<{ readonly [P in keyof A as P extends "_tag" ? never : P]: A[P]; }>) => import("effect/Cause").YieldableError & {
    readonly _tag: "InvalidId";
} & Readonly<A>;
export declare class InvalidId extends InvalidId_base<{
    readonly raw: string;
}> {
}
declare const UserNotFound_base: new <A extends Record<string, any> = {}>(args: import("effect/Types").VoidIfEmpty<{ readonly [P in keyof A as P extends "_tag" ? never : P]: A[P]; }>) => import("effect/Cause").YieldableError & {
    readonly _tag: "UserNotFound";
} & Readonly<A>;
export declare class UserNotFound extends UserNotFound_base<{
    readonly id: string;
}> {
}
export interface User {
    id: string;
    name: string;
}
export declare function parseId(raw: string): Effect.Effect<number, InvalidId, never>;
export declare function find(id: string): Effect.Effect<User, UserNotFound, never>;
export declare function lookup(raw: string): Effect.Effect<User, InvalidId, never>;
export declare function lookupOrGuest(raw: string): Effect.Effect<User, InvalidId, never>;
export declare function oops(n: number): Effect.Effect<number, string | Error, never>;
export declare function describe(raw: string): Effect.Effect<string, never, never>;
export declare function main(): Effect.Effect<{
    found: string;
    missing: string;
    orGuest: string;
    invalid: string;
    oops: (string | number)[];
    describe: string[];
    lambda: (number | "InvalidId")[];
}, InvalidId, never>;
export {};
