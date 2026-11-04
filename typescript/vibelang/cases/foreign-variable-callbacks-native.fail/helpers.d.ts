import type * as Effect from "effect/Effect"
export type Program=Effect.Effect<number>
export declare const source:()=>number
export declare const callable:{():number}
/** @throws {never} */
export declare const safe:()=>number
export declare const fx:()=>Effect.Effect<number>
export declare const generic:<T>()=>T
export interface Owner<R>{run:()=>R}
export declare const owner:Owner<number>
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
export declare const numeric:(value:number)=>void
export interface TextAPI {run(value:string):void}
/** @throws {never} */
export declare function consumeText(fn:(value:string)=>void):void
export declare class ForeignParent {run:()=>number}
export declare class FxParent {run:()=>Effect.Effect<number>}
