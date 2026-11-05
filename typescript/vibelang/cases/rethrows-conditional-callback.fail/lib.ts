export const events:string[]=[]
export const defect=new RangeError("callback")
/** @throws {RangeError} */
export function risky(n:number):number{events.push("risky");throw defect}
/** @throws {never} */
export function safe(n:number):number{events.push("safe");return n+1}
/** @throws {never}
 * @rethrows cb
 */
export function invoke(cb:(n:number)=>number):number{events.push("invoke");return cb(7)}
