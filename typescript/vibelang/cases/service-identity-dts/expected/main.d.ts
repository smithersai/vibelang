import { Context, Effect, Layer } from "effect";
export interface User {
    id: string;
    name: string;
}
declare const Users_base: Context.ServiceClass<Users, "service-identity-dts/main#Users", {
    find(id: string): Effect.Effect<User>;
    readonly source: string;
}>;
export declare class Users extends Users_base {
    static readonly layer: Layer.Layer<Users, never, never>;
}
export declare const Flags: Context.Reference<{
    readonly beta: boolean;
}>;
export interface SearchApi {
    find(query: string): Effect.Effect<string>;
}
declare const Search_base: Context.ServiceClass<Search, "service-identity-dts/main#Search", SearchApi>;
export declare class Search extends Search_base {
}
declare const Prefix_base: Context.ServiceClass<Prefix, "service-identity-dts/main#Prefix", string>;
export declare class Prefix extends Prefix_base {
}
export interface Shape {
    sides: number;
}
declare const Geometry_base: Context.ServiceClass<Geometry, "service-identity-dts/main#Geometry", {
    area(shape: Shape): Effect.Effect<number>;
}>;
export declare class Geometry extends Geometry_base {
}
export declare class UsersInMemory implements Context.Service.Shape<typeof Users> {
    readonly source = "in-memory";
    find(id: string): Effect.Effect<{
        id: string;
        name: string;
    }, never, never>;
}
export declare function sourceOf(users: Context.Service.Shape<typeof Users>): Effect.Effect<string, never, never>;
export declare function current(): Effect.Effect<{
    find(id: string): Effect.Effect<User>;
    readonly source: string;
}, never, Users>;
export declare function greet(id: string): Effect.Effect<string, never, Users>;
export {};
