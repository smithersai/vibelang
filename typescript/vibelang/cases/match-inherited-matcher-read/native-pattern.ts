/** @throws {never} */
export function makePattern(kind: string, own: boolean, trace: string[]) {
 const key=(Symbol as any).customMatcher ?? Symbol.for("Symbol.customMatcher")
 const sentinel={inherited:true}
 class Base {}
 Object.defineProperty(Base,key,{get(){
  trace.push("inherited")
  if(kind==="throw")throw sentinel
  return kind==="function"?()=>false:undefined
 }})
 class Derived extends Base {}
 if(own)Object.defineProperty(Derived,key,{get(){
  trace.push("own")
  return function(this:unknown,subject:unknown,hint:{matchType:string}){
   trace.push("call:"+hint.matchType)
   return this===Derived && subject instanceof Derived
  }
 }})
 return Derived
}
