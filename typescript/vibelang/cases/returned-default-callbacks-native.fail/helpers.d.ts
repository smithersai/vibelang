import type * as Effect from "effect/Effect"
export type Program=Effect.Effect<number>
export type Fn=()=>number
/** @throws {never} */
export declare function make():()=>number
/** @throws {never} */
export declare const makeVar:()=>()=>number
export declare const api:{
/** @throws {never} */
make():()=>number
}
/** @throws {never} */
export declare function makeGeneric():<T>()=>T
/** @throws {never} */
export declare function makeCaptured<T>():()=>T
/** @throws {never} */
export declare function makeEffect():()=>Effect.Effect<number>
/** @throws {never} */
export declare function makeSafe():{
/** @throws {never} */
():number
}
/** @throws {never} */
export declare const Ctor:{new():()=>number}
/** @throws {never} */
export declare function makeTag(strings:TemplateStringsArray):()=>number
export interface Handler{():unknown}
export interface API{run:Handler}
export interface Admitting{
/** @throws {unknown} */
():unknown
}
/** @throws {never} */
export declare function consume(fn:Handler):void
/** @throws {never} */
export declare function makeNumeric():(value:number)=>void
export interface TextAPI{run(value:string):void}
/** @throws {never} */
export declare function consumeText(fn:(value:string)=>void):void
