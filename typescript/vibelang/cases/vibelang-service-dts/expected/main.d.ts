import { Context, Effect, Layer } from "effect";
export interface User {
    id: string;
    name: string;
}
type Users_shape = {
    find(id: string): Effect.Effect<User, never, never>;
    readonly source: string;
};
declare const Users_base: Context.ServiceClass<Users, "vibelang-service-dts/main#Users", Users_shape>;
export declare class Users extends Users_base {
    static readonly layer: Layer.Layer<Users, never, never>;
}
export declare namespace Users {
    type Shape = Users_shape;
}
type Flags_shape = {
    readonly beta: boolean;
};
export declare const Flags: Context.Reference<Flags_shape>;
export declare namespace Flags {
    type Shape = Flags_shape;
}
export declare function greet(id: string): Effect.Effect<string, never, Users>;
export {};
