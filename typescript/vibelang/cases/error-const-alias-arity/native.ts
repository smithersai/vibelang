import { Data, Schema } from "effect"
class Plain extends Data.TaggedError("Plain")<{readonly code:number}>{}
class Encoded extends Schema.TaggedError<Encoded>()("Encoded",{code:Schema.Number}){}
const PlainAlias=Plain
const PlainTyped:typeof Plain=PlainAlias
const PlainChain=(PlainTyped)
const SchemaAlias=Encoded
const SchemaTyped:typeof Encoded=SchemaAlias
const SchemaChain=(SchemaTyped)
function extracted(s:unknown,tag:string):readonly unknown[]|false{
 return s!==null&&(typeof s==="object"||typeof s==="function")&&"_tag" in s&&s._tag===tag?[s]:false
}
function read(s:unknown,tag:string,arity:number):number{
 const list=extracted(s,tag)
 if(list===false||list.length!==arity)return arity===1?-1:0
 return arity===1?(list[0] as {code:number}).code:1
}
/** @throws {never} */
export function nativeLabels():number[]{
 const p=new PlainChain({code:7}),s=new SchemaChain({code:8})
 const copy={_tag:"Plain",code:9},schemaCopy={_tag:"Encoded",code:10}
 return [
  read(p,"Plain",0),read(p,"Plain",1),read(p,"Plain",2),
  read(copy,"Plain",0),read(copy,"Plain",1),read(copy,"Plain",2),
  read(s,"Encoded",0),read(s,"Encoded",1),read(s,"Encoded",2),
  read(schemaCopy,"Encoded",0),read(schemaCopy,"Encoded",1),read(schemaCopy,"Encoded",2),
  read(undefined,"Plain",1),read(undefined,"Encoded",1)
 ]
}
