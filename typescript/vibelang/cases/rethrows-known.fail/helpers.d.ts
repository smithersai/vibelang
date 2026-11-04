import type * as Effect from "effect/Effect"
/** @throws {Error} */
export declare function risky(text:string):unknown
/** @throws {unknown} */
export declare function unknownCallback(text:string):unknown
/** @throws {never} */
export declare function safe(text:string):number
/** @throws {Error} */
export declare function fx(text:string):Effect.Effect<number>
/** @throws {never} @rethrows cb */
export declare function invoke(cb:(text:string)=>unknown):unknown
export interface Builder {
/** @throws {never} @rethrows cb */
new(cb:(text:string)=>unknown):object
}
export declare const Builder:Builder
/** @throws {never} @rethrows cb */
export declare function tag(parts:TemplateStringsArray,cb:(text:string)=>unknown):unknown
/** @throws {never} @rethrows a @rethrows b */
export declare function both(a:(text:string)=>unknown,b:(text:string)=>unknown):unknown
/** @throws {never} @rethrows cbs */
export declare function all(...cbs:((text:string)=>unknown)[]):unknown
/** @throws {TypeError} @rethrows cb */
export declare function ownAndCallback(cb:(text:string)=>unknown):unknown
/** @throws {Error} */
export declare function overloaded(text:number):unknown
/** @throws {never} */
export declare function overloaded(text:string):unknown
