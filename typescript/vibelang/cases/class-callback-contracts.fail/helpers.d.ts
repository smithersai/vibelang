import type {Effect} from "effect"
export interface API {run(text:string):unknown}
export interface AlsoPure {run(text:string):unknown}
export interface InheritedGenericAPI extends GenericAPI<Error> {}
export interface Allowed {
 /** @throws {Error} */
 (text:string):unknown
}
export interface AllowedAPI {
 /** @throws {Error} */
 run(text:string):unknown
}
export interface UnknownAPI {
 /** @throws {unknown} */
 run(text:string):unknown
}
export interface GenericAPI<E> {
 /** @throws {E} */
 run(text:string):unknown
}
/** @throws {Error} */
export type MisleadingAlias=(text:string)=>unknown
export type Plain=(text:string)=>unknown
export interface AliasAPI {run:MisleadingAlias}
/** @throws {Error} */
export declare function source(text:string):unknown
/** @throws {never} */
export declare function safe(text:string):unknown
/** @throws {unknown} */
export declare function unknownSource(text:string):unknown
/** @throws {Error} */
export declare function wrong(value:number):unknown
export declare class Base {
 /** @throws {Error} */
 run(text:string):unknown
}
/** @throws {Error} */
export declare function overloaded(value:number):unknown
/** @throws {never} */
export declare function overloaded(value:string):unknown
export interface EffectAPI {run(text:string):Effect.Effect<number>}
export interface GenericReturn<R> { (text:string):R }
/** @throws {Error} */
export declare function fx(text:string):Effect.Effect<number>
export interface TaggedReturn<R> {
 /** @throws {Error} */
 (text:string):R
}
export declare class FxBase {run:TaggedReturn<Effect.Effect<number>>}
export interface UnionAPI {run:Plain|Allowed}
export interface OverloadedAPI {
 /** @throws {Error} */
 run(text:string):unknown
 run(value:number):unknown
}
/** @throws {Error} */
export declare function broad(value:string|number):unknown
/** @throws {Error} */
export declare function unconstrained<R>(text:string):R
export declare const instantiated:typeof unconstrained<Effect.Effect<number>>
