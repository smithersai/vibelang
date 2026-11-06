export const events:string[]=[]
export const failure=new RangeError("base failure")
export class Base{readonly value=7}
/** @throws {RangeError} */
export function parent(fail:boolean):typeof Base{
 events.push(fail?"base-fail":"base-ok")
 if(fail)throw failure
 return Base
}
