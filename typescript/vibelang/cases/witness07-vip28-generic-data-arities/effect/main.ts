import {Data,Effect} from "effect"
export type One<A>=Data.TaggedEnum<{Got:{a:A};None:{}}>
interface OneDefinition extends Data.TaggedEnum.WithGenerics<1>{readonly taggedEnum:One<this["A"]>}
export const One=Data.taggedEnum<OneDefinition>()
export type Two<A,B>=Data.TaggedEnum<{Left:{left:A};Right:{right:B}}>
interface TwoDefinition extends Data.TaggedEnum.WithGenerics<2>{readonly taggedEnum:Two<this["A"],this["B"]>}
export const Two=Data.taggedEnum<TwoDefinition>()
export type Three<A,B,C>=Data.TaggedEnum<{Triple:{a:A;b:B;c:C};Nothing:{}}>
interface ThreeDefinition extends Data.TaggedEnum.WithGenerics<3>{readonly taggedEnum:Three<this["A"],this["B"],this["C"]>}
export const Three=Data.taggedEnum<ThreeDefinition>()
export type Four<A,B,C,D>=Data.TaggedEnum<{Quad:{a:A;b:B;c:C;d:D};Empty:{}}>
interface FourDefinition extends Data.TaggedEnum.WithGenerics<4>{readonly taggedEnum:Four<this["A"],this["B"],this["C"],this["D"]>}
export const Four=Data.taggedEnum<FourDefinition>()
export function main() {
 const reserved:string="free"
 const one:One<string>=One.Got({a:"one"})
 const two:Two<number,string>=Two.Right({right:"two"})
 const three:Three<string,number,boolean>=Three.Triple({a:"x",b:3,c:true})
 const four:Four<string,number,boolean,bigint>=Four.Quad({a:"y",b:4,c:false,d:4n})
 return Effect.succeed([one._tag,one.a,two._tag,two.right,three.a,three.b,three.c,four.a,four.b,four.c,String(four.d),One.None()._tag,Three.Nothing()._tag,Four.Empty()._tag,reserved])
}
