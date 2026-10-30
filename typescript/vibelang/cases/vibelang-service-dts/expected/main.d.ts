import { Context, Effect, Layer } from "effect";
export interface User {
    id: string;
    name: string;
}
declare const Users_base: Context.ServiceClass<Users, "vibelang-service-dts/main#Users", {
    find(id: string): Effect.Effect<User, never, never>;
    readonly source: string;
}>;
export declare class Users extends Users_base {
    static readonly layer: Layer.Layer<Users, never, never>;
}
export declare const Flags: Context.Reference<{
    readonly beta: boolean;
}>;
export declare function greet(id: string): Effect.Effect<string, never, Users>;
export {};
