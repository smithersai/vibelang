/** @throws {never} */
export function makeSubject(log:string[]):Record<PropertyKey,number>{
 const target:Record<PropertyKey,number>={value:7}
 return new Proxy(target,{
  has(target,key){log.push("has:"+String(key));return Reflect.has(target,key)},
  get(target,key,receiver){log.push("get:"+String(key));return Reflect.get(target,key,receiver)}
 })
}
/** @throws {never} */
export function nativeLabels():unknown[]{
 const log:string[]=[]
 function key():"value"{log.push("key");return "value"}
 const subject=makeSubject(log)
 const first=key()
 const present=first in subject
 const captured=present?subject[first]:undefined
 let result=-1
 if(present&&captured===1)result=0
 else{
  const second=key()
  if(second===first&&present)result=captured!
 }
 // Non-objects fail before their computed property names are evaluated.
 const skipped:string[]=[]
 const primitive:unknown=1
 let miss=0
 if(primitive!==null&&(typeof primitive==="object"||typeof primitive==="function")){
  skipped.push("key")
  if("value" in primitive)miss=1
 }
 return [[result,log],[miss,skipped]]
}

/** @throws {never} */
export function makeKey(log:string[],mode:string):()=>"value"{
 return ()=>{
  log.push("key")
  if(mode==="key-throw")throw "key-error"
  return {
   [Symbol.toPrimitive](hint:string){
    log.push("convert:"+hint)
    if(mode==="convert-throw")throw "convert-error"
    return "value"
   }
  } as unknown as "value"
 }
}
/** @throws {never} */
export function nativeAbruptLabels():unknown[]{
 return ["value","key-throw","convert-throw"].map(mode=>{
  const log:string[]=[]
  const subject=makeSubject(log)
  const key=makeKey(log,mode)
  try{
   const converted=Reflect.ownKeys({[key()]:undefined})[0]!
   const present=converted in subject
   const result=present?subject[converted]:0
   return [result,log]
  }catch(error){return [error,log]}
 })
}
