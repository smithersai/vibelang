import {Data,Effect} from "effect"
export type Outcome<A,B,C,D>=Data.TaggedEnum<{Value:{a:A;b:B;c:C;d:D};Empty:{}}>
interface Definition extends Data.TaggedEnum.WithGenerics<4>{readonly taggedEnum:Outcome<this["A"],this["B"],this["C"],this["D"]>}
export const Outcome=Data.taggedEnum<Definition>()
export type Box<A>=Data.TaggedEnum<{Value:{value:A}}>
interface BoxDefinition extends Data.TaggedEnum.WithGenerics<1>{readonly taggedEnum:Box<this["A"]>}
export const Box=Data.taggedEnum<BoxDefinition>()
type DefaultBox=Box<string>
type StrBox=Outcome<string,number,boolean,bigint>
export function main() {
 const defaulted:DefaultBox=Box.Value({value:"default"})
 const x:StrBox=Outcome.Value({a:"x",b:2,c:true,d:3n})
 const user:[string,number,boolean]=["user",4,true]
 return Effect.succeed([x.a,x.b,x.c,String(x.d),user,defaulted.value])
}
