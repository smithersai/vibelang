export const events:string[]=[]
export const failure=new RangeError("enum failure")
/** @throws {RangeError} */
export function number(fail:boolean):number{
 events.push(fail?"call-fail":"call-ok")
 if(fail)throw failure
 return 7
}
/** @throws {RangeError} */
export function tag(_strings:TemplateStringsArray,fail:boolean):number{
 events.push(fail?"tag-fail":"tag-ok")
 if(fail)throw failure
 return 7
}
export class Factory{
 readonly value=7
 /** @throws {RangeError} */
 constructor(fail:boolean){
  events.push(fail?"new-fail":"new-ok")
  if(fail)throw failure
 }
}
