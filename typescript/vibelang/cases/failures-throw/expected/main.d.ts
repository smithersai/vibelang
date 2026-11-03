import * as $nativeTryEffect4 from "effect/Effect";
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
export declare function parseId(raw: string): $nativeTryEffect4.Effect<number, InvalidId, never>;
export declare function find(id: string): $nativeTryEffect4.Effect<User, UserNotFound, never>;
export declare function lookup(raw: string): $nativeTryEffect4.Effect<User, InvalidId, never>;
export declare function lookupOrGuest(raw: string): $nativeTryEffect4.Effect<User, InvalidId, never>;
export declare function oops(n: number): $nativeTryEffect4.Effect<number, string | Error, never>;
export declare function describe(raw: string): $nativeTryEffect4.Effect<string, never, never>;
export declare function main(): $nativeTryEffect4.Effect<{
    found: string;
    missing: string;
    orGuest: string;
    invalid: string;
    oops: (string | number)[];
    describe: string[];
    lambda: (number | "InvalidId")[];
}, InvalidId, never>;
export {};
