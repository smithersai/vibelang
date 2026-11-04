import { Context, Effect, Layer } from "effect";
export interface SearchApi {
    find(query: string): Effect.Effect<string>;
}
declare const Search_base: Context.ServiceClass<Search, "decl-service-type-dts/main#Search", SearchApi>;
export declare class Search extends Search_base {
}
export declare const SearchLive: Layer.Layer<Search, never, never>;
declare const Prefix_base: Context.ServiceClass<Prefix, "decl-service-type-dts/main#Prefix", string>;
export declare class Prefix extends Prefix_base {
}
export declare const Version: Context.Reference<number>;
export declare function greet(query: string): Effect.Effect<string, never, Prefix | Search>;
export {};
