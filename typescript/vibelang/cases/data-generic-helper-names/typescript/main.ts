import {Data,Effect} from "effect"
export type $One$Definition = "kept"
export type $One$Definition$2 = 2
export type One<A> = Data.TaggedEnum<{V:{first:A}}>
export interface $One$Definition$3 extends Data.TaggedEnum.WithGenerics<1> { readonly taggedEnum: One<this["A"]> }
export const One = Data.taggedEnum<$One$Definition$3>()
export type Two<A,B> = Data.TaggedEnum<{V:{first:A;second:B}}>
export interface $Two$Definition$2 extends Data.TaggedEnum.WithGenerics<2> { readonly taggedEnum: Two<this["A"],this["B"]> }
export const Two = Data.taggedEnum<$Two$Definition$2>()
export type Three<A,B,C> = Data.TaggedEnum<{V:{first:A;second:B;third:C}}>
export interface $Three$Definition extends Data.TaggedEnum.WithGenerics<3> { readonly taggedEnum: Three<this["A"],this["B"],this["C"]> }
export const Three = Data.taggedEnum<$Three$Definition>()
export type Four<A,B,C,D> = Data.TaggedEnum<{V:{first:A;second:B;third:C;fourth:D}}>
export interface $Four$Definition$2 extends Data.TaggedEnum.WithGenerics<4> { readonly taggedEnum: Four<this["A"],this["B"],this["C"],this["D"]> }
export const Four = Data.taggedEnum<$Four$Definition$2>()
export type $Two$Definition = "later"
export type $Fo\u0075r$Definition = "escaped"
export function main():Effect.Effect<readonly unknown[],never> {return Effect.gen(function*(){
  const one=One.V({first:1})
  const two=Two.V({first:"a",second:2})
  const three=Three.V({first:true,second:"b",third:3})
  const four=Four.V({first:1,second:"c",third:false,fourth:4})
  return [one._tag,one.first,two._tag,two.first,two.second,three._tag,three.first,three.second,three.third,four._tag,four.first,four.second,four.third,four.fourth]
})}
