import { Context, Effect } from "effect";
declare const UserNotFound_base: new <A extends Record<string, any> = {}>(args: import("effect/Types").VoidIfEmpty<{ readonly [P in keyof A as P extends "_tag" ? never : P]: A[P]; }>) => import("effect/Cause").YieldableError & {
    readonly _tag: "UserNotFound";
} & Readonly<A>;
declare class UserNotFound extends UserNotFound_base<{
    readonly id: string;
}> {
}
interface User {
    id: string;
    name: string;
}
type Users_shape = {
    find(id: string): Effect.Effect<User, UserNotFound>;
};
declare const Users_base: Context.ServiceClass<Users, "ref4-pausing-function-value/ref4-pausing-function-value#Users", Users_shape>;
declare class Users extends Users_base {
}
declare namespace Users {
    type Shape = Users_shape;
}
export declare function findName(id: string): Effect.Effect<string, UserNotFound, Users>;
/** @throws {never} */
export declare function names(ids: ReadonlyArray<string>): Effect.Effect<string, UserNotFound, Users>[];
export {};
