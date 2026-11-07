function before(s:{field:number}|null) {
 let value:number
 if(s!==null && "field" in s && ((value=s.field),true) && (()=>true)()) return value
 return 0
}
function after(s:{field:number}|null) {
 let value:number
 if((()=>true)() && s!==null && "field" in s && ((value=s.field),true)) return value
 return 0
}
function narrowed(s:{field:number}|null) {
 let value:number
 if(s!==null && "field" in s && ((value=s.field),true) && (()=>true)() && value===1 && (()=>true)()) {
  const one:1=value
  return one
 }
 return 0
}
/** @throws {never} */
export function nativeResults() {
 return [before({field:7}),before(null),after({field:9}),after(null),narrowed({field:1})]
}
