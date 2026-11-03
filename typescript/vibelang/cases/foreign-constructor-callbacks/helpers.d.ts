import type { Effect } from "effect"
export interface Item {readonly value:number}
export declare class Risky {
 readonly value:number
 /** @throws {Error} */
 constructor(value:number)
}
export declare class Safe {
 readonly value:number
 /** @throws {never} */
 constructor(value:number)
}
export declare abstract class Abstract {
 readonly value:number
 /** @throws {Error} */
 constructor(value:number)
}
export declare class Overloaded {
 readonly value:number
 /** @throws {Error} */
 constructor(value:"unsafe")
 /** @throws {never} */
 constructor(value:"safe")
}
export interface Pure {new(value:number):Item}
export interface Admits {
 /** @throws {Error} */
 new(value:number):Item
}
export interface AdmitsUnknown {
 /** @throws {unknown} */
 new(value:number):Item
}
export interface Tagged {
 /** @throws {Error} */
 new(value:number):Item
}
export declare const tagged:Tagged
export interface AnyThrows {
 /** @throws {unknown} */
 new(value:number):Item
}
export declare const anyThrows:AnyThrows
export interface SafeOnly {new(value:"safe"):Item}
export interface UnsafeOnly {new(value:"unsafe"):Item}
export interface FxCtor {
 /** @throws {Error} */
 new():Effect.Effect<number>
}
export interface PureFx {new():Effect.Effect<number>}
export declare const fx:FxCtor
export interface GenericFxCtor {
 /** @throws {Error} */
 new<T extends Effect.Effect<number>>():T
}
export interface PureGenericFx {new<T extends Effect.Effect<number>>():T}
export declare const genericFx:GenericFxCtor
/** @throws {never} */
export declare function take(value:Pure):void
/** @throws {never} */
export declare function takeSafe(value:SafeOnly):void
/** @throws {never} */
export declare function takeUnsafe(value:UnsafeOnly):void
/** @throws {never} */
export declare function allow(value:Admits):void
/** @throws {never} */
export declare function allowAny(value:AdmitsUnknown):void
/** @throws {never} */
export declare function takeOptional(value:Pure|null):void
/** @throws {never} */
export declare function takeFx(value:PureFx):void
/** @throws {never} */
export declare function takeGenericFx(value:PureGenericFx):void
/** @throws {never} */
export declare function wrong(value:new(value:string)=>Item):void
