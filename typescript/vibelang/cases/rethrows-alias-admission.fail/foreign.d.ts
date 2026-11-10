/** @throws {RangeError} */
export declare function risky():number
/** @rethrows cb */
export type Direct = (cb:()=>number)=>number
/** @rethrows cb */
export type Parenthesized = ((cb:()=>number)=>number)
/** @rethrows cb */
export type Generic = <T>(cb:()=>T)=>T
/** @throws {never} @rethrows cb */
export type OwnNever = (cb:()=>number)=>number
export declare const direct:Direct
export declare const parenthesized:Parenthesized
export declare const generic:Generic
export declare const ownNever:OwnNever
