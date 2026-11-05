export const events:string[]=[]
export const defect=new RangeError("callback")
/** @throws {RangeError} */
export function risky(n:number):number{events.push("risky");throw defect}
/** @throws {RangeError} */
export function generic<T>(n:T):T{events.push("generic");throw defect}
export const holder={
 get read():typeof risky{events.push("getter");return risky}
}
