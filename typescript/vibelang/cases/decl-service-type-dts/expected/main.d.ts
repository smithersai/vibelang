import { Context, Effect, Layer } from "effect";
export interface SearchApi {
    find(query: string): Effect.Effect<string>;
}
type Search_shape = SearchApi;
declare const Search_base: Context.ServiceClass<Search, "decl-service-type-dts/main#Search", Search_shape>;
export declare class Search extends Search_base {
}
export declare namespace Search {
    type Shape = Search_shape;
}
export declare const SearchLive: Layer.Layer<Search, never, never>;
type Prefix_shape = string;
declare const Prefix_base: Context.ServiceClass<Prefix, "decl-service-type-dts/main#Prefix", Prefix_shape>;
export declare class Prefix extends Prefix_base {
}
export declare namespace Prefix {
    type Shape = Prefix_shape;
}
type Version_shape = number;
export declare const Version: Context.Reference<Version_shape>;
export declare namespace Version {
    type Shape = Version_shape;
}
export declare function greet(query: string): Effect.Effect<string, never, Prefix | Search>;
export {};
