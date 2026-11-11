/** @throws {never} */
export declare function takeUnknown(body: () => Generator<number, void, unknown>): number
/** @throws {never} */
export declare function takeUnknown(value: unknown): number
/** @throws {never} */
export declare function takeAny(value: any): number
/** @throws {never} */
export declare function takeAny(body: () => Generator<number, void, unknown>): number
/** @throws {never} */
export declare function takeObject(body: () => Generator<number, void, unknown>): number
/** @throws {never} */
export declare function takeObject(value: object): number
/** @throws {never} */
export declare function takeEmpty(value: {}): number
/** @throws {never} */
export declare function takeEmpty(body: () => Generator<number, void, unknown>): number
/** @throws {never} */
export declare function takeFunction(body: () => Generator<number, void, unknown>): number
/** @throws {never} */
export declare function takeFunction(value: Function): number
/** @throws {never} */
export declare function reject(body: () => Generator<number, void, unknown>): number

type G = () => Generator<number, void, unknown>
/** @throws {never} */ export declare function takeVariadicTail(...args:[...number[],unknown]):number;/** @throws {never} */ export declare function takeVariadicTail(f:G):number;
/** @throws {never} */ export declare function takeVariadicTailPrefix(...args:[...number[],unknown]):number;/** @throws {never} */ export declare function takeVariadicTailPrefix(prefix:number,f:G):number;
/** @throws {never} */ export declare function takeVariadicPrefix(f:unknown,...args:[...number[],()=>void]):number;/** @throws {never} */ export declare function takeVariadicPrefix(f:G,done:()=>void):number;
/** @throws {never} */ export declare function takeVariadicMiddle(...args:[...number[],unknown,()=>void]):number;/** @throws {never} */ export declare function takeVariadicMiddle(prefix:number,f:G,done:()=>void):number;
/** @throws {never} */ export declare function takeOptionalMetadata(tag?:number,f?:unknown):number;/** @throws {never} */ export declare function takeOptionalMetadata(tag:number|undefined,f:G):number;
/** @throws {never} */ export declare function takeOptionalTuple(...args:[tag?:number,f?:unknown]):number;/** @throws {never} */ export declare function takeOptionalTuple(tag:number|undefined,f:G):number;
/** @throws {never} */ export declare function takeVoidMetadata(f:unknown,unused:void):number;/** @throws {never} */ export declare function takeVoidMetadata(f:G):number;
/** @throws {never} */ export declare function takeSpreadArray(f:unknown,...meta:number[]):number;/** @throws {never} */ export declare function takeSpreadArray(f:G,...meta:number[]):number;
/** @throws {never} */ export declare function takeSpreadTuple(f:unknown,n:number):number;/** @throws {never} */ export declare function takeSpreadTuple(f:G,n:number):number;
/** @throws {never} */ export declare function takeSpreadBefore(n:number,f:unknown):number;/** @throws {never} */ export declare function takeSpreadBefore(n:number,f:G):number;
/** @throws {never} */ export declare function takeGenericValue<F extends object>(f:F):number;/** @throws {never} */ export declare function takeGenericValue(f:G):number;
/** @throws {never} */ export declare function takeGenericValueExplicit<F>(f:F):number;/** @throws {never} */ export declare function takeGenericValueExplicit(f:G):number;
