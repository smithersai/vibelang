export const defect=new RangeError("callback")
/** @throws {RangeError} */
export function risky(n:number):number{throw defect}
/** @throws {never}
 * @rethrows cb
 */
export function invoke(cb?:((n:number)=>number)):number{return cb?cb(7):0}
/** @throws {never}
 * @rethrows cb
 */
export function prefixed(prefix:number,cb?:((n:number)=>number)):number{return cb?cb(prefix):prefix}
export const args:[cb?:typeof risky]=[risky]
export const readonlyArgs:readonly[cb?:typeof risky]=args
export const prefixArgs:[prefix:number,cb?:typeof risky]=[1,risky]
