import { Data, Schema } from "effect"
class Plain extends Data.TaggedError("Plain")<{readonly code:number}> {
 label():number{return this.code}
}
class Encoded extends Schema.TaggedError<Encoded>()("Encoded",{code:Schema.Number}) {
 get label():number{return this.code}
}
type P={_tag:"Plain";payload:7}|{_tag:"Other";payload:9}
type S={_tag:"Encoded";payload:7}|{_tag:"Other";payload:9}
function plain(s:P):number{
 if(s._tag==="Plain")return s.payload
 if(s._tag==="Other")return s.payload
 const remaining:never=s;return remaining
}
function schema(s:S):number{
 if(s._tag==="Encoded")return s.payload
 if(s._tag==="Other")return s.payload
 const remaining:never=s;return remaining
}
function own(s:unknown,tag:"Plain"|"Encoded"):number{
 if(s!==null&&(typeof s==="object"||typeof s==="function")&&"_tag" in s&&s._tag===tag)return (s as unknown as {code:number}).code
 return -1
}
/** @throws {never} */
export function nativeLabels():number[]{
 return [
  plain({_tag:"Plain",payload:7}),plain({_tag:"Other",payload:9}),
  plain({_tag:"Plain",payload:7}),plain({_tag:"Other",payload:9}),
  schema({_tag:"Encoded",payload:7}),schema({_tag:"Other",payload:9}),
  schema({_tag:"Encoded",payload:7}),schema({_tag:"Other",payload:9}),
  own(new Plain({code:7}),"Plain"),own(new Encoded({code:7}),"Encoded")
 ]
}
