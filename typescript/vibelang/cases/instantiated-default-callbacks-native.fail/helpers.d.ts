import type * as Effect from "effect/Effect"
import type * as Stream from "effect/Stream"
import type * as Layer from "effect/Layer"
export type Program=Effect.Effect<number>
export type StreamProgram=Stream.Stream<number>
export type LayerProgram=Layer.Layer<any,any,any>
export declare function generic<T>():T
export declare const genericVar:<T>()=>T
export interface Owner<R>{generic<T extends R>():T}
export declare const owner:Owner<unknown>
export declare const mixedOwner:Owner<Program|undefined>
export declare const neverOwner:Owner<never>
export declare const fxOwner:Owner<Program>
export declare const streamOwner:Owner<StreamProgram>
export declare const layerOwner:Owner<LayerProgram>
/** @throws {never} */
export declare function factory():<T>()=>T
export interface Handler{():unknown}
export interface API{run:Handler}
export interface Admitting{
/** @throws {unknown} */
():unknown
}
/** @throws {never} */
export declare function consume(fn:Handler):void
export declare function takes<T>(value:T):void
export interface TextAPI{run(value:string):void}
/** @throws {never} */
export declare function consumeText(fn:(value:string)=>void):void
