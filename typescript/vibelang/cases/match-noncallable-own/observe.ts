/** @throws {never} */
export function capture(f:()=>unknown):string {
 try { return JSON.stringify(["value",f()]) }
 catch(error) { const e=error as Error; return JSON.stringify(["throw",e.name,e.message]) }
}
/** @throws {never} */
export function nativeCapture(type:Function,subject:unknown,key:symbol):string {
 return capture(()=>{
  const method=Reflect.get(type,key)
  return method===undefined?subject===type:!!Reflect.apply(method,type,[subject,{matchType:"boolean"},null])
 })
}
