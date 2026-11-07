import { Context, Effect } from "effect";
declare const Gone_base: new <A extends Record<string, any> = {}>(args: import("effect/Types").VoidIfEmpty<{ readonly [P in keyof A as P extends "_tag" ? never : P]: A[P]; }>) => import("effect/Cause").YieldableError & {
    readonly _tag: "Gone";
} & Readonly<A>;
declare class Gone extends Gone_base<{
    readonly id: string;
}> {
}
type Users_shape = {
    find(id: string): Effect.Effect<string, Gone>;
};
declare const Users_base: Context.ServiceClass<Users, "vip3-infer-slot/main#Users", Users_shape>;
declare class Users extends Users_base {
}
declare namespace Users {
    type Shape = Users_shape;
}
export declare function errors(id: string): Effect.Effect<string, Gone, Users>;
export declare function needs(id: string): Effect.Effect<string, Gone, Users>;
export declare function value(id: string): Effect.Effect<{
    name: string;
}, Gone, Users>;
export declare function bang(id: string): Effect.Effect<string, Gone, Users>;
export declare const everything: (id: string) => Effect.Effect<string, Gone, Users>;
export declare function main(): Effect.Effect<string[], Gone, never>;
export declare function recover(error: Gone): Effect.Effect<string, never, never>;
export declare function recoverUsingUsers(program: Effect.Effect<never, Gone, never>): Effect.Effect<string, Gone, Users>;
export {};
