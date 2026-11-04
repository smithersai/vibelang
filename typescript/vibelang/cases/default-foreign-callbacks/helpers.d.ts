import type * as Effect from "effect/Effect"
export declare function source():unknown
/** @throws {never} */
export declare function safe():unknown
export declare function fx():Effect.Effect<number>
export declare function generic<T>():T
export declare const instantiated:typeof generic<Effect.Effect<number>>
export declare function constrained<T extends Effect.Effect<number>>():T
export interface Owner<R>{method():R;bounded<T extends R>():T;chain<T extends R,U extends T>():U}
export declare const fxOwner:Owner<Effect.Effect<number>>
export interface Handler {():unknown}
export interface API {run:Handler}
export interface Admitting {
/** @throws {unknown} */
():unknown}
/** @throws {never} */
export declare function consume(fn:Handler):void
/** @throws {never} */
export declare function admit(fn:Admitting):void
export declare class Parent {run:typeof source}
export declare function numeric(value:number):void
export interface TextAPI {run(value:string):void}
/** @throws {never} */
export declare function consumeText(fn:(value:string)=>void):void
export declare const intersectionOwner: {method<T>():T} & {marker:true}
export declare const unionOwner: {method<T>():T} | {method<T>():T;marker:true}
export declare const intersectionFx: {method<T extends Effect.Effect<number>>():T} & {marker:true}
declare global {interface String {foreignContractMethod<T>():T}}
export declare const capturedIntersection:Owner<Effect.Effect<number>> & {marker:true}
