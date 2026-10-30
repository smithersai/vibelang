import { Context, Effect, Layer } from "effect";
export interface User {
    id: string;
    name: string;
}
type Users_shape = {
    find(id: string): Effect.Effect<User>;
    readonly source: string;
};
declare const Users_base: Context.ServiceClass<Users, "service-identity-dts/main#Users", Users_shape>;
export declare class Users extends Users_base {
}
export declare namespace Users {
    type Shape = Users_shape;
}
export declare const UsersLive: Layer.Layer<Users, never, never>;
type Flags_shape = {
    readonly beta: boolean;
};
export declare const Flags: Context.Reference<Flags_shape>;
export declare namespace Flags {
    type Shape = Flags_shape;
}
export interface SearchApi {
    find(query: string): Effect.Effect<string>;
}
type Search_shape = SearchApi;
declare const Search_base: Context.ServiceClass<Search, "service-identity-dts/main#Search", Search_shape>;
export declare class Search extends Search_base {
}
export declare namespace Search {
    type Shape = Search_shape;
}
type Prefix_shape = string;
declare const Prefix_base: Context.ServiceClass<Prefix, "service-identity-dts/main#Prefix", Prefix_shape>;
export declare class Prefix extends Prefix_base {
}
export declare namespace Prefix {
    type Shape = Prefix_shape;
}
export interface Shape {
    sides: number;
}
type Geometry_shape = {
    area(shape: Shape): Effect.Effect<number>;
};
declare const Geometry_base: Context.ServiceClass<Geometry, "service-identity-dts/main#Geometry", Geometry_shape>;
export declare class Geometry extends Geometry_base {
}
export declare namespace Geometry {
    type Shape = Geometry_shape;
}
export declare class UsersInMemory implements Context.Service.Shape<typeof Users> {
    readonly source = "in-memory";
    find(id: string): Effect.Effect<{
        id: string;
        name: string;
    }, never, never>;
}
export declare function sourceOf(users: Users.Shape): string;
export declare function current(): Effect.Effect<{
    find(id: string): Effect.Effect<User>;
    readonly source: string;
}, never, Users>;
export declare function greet(id: string): Effect.Effect<string, never, Users>;
export {};
