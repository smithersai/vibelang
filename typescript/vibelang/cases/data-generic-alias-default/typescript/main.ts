import {Data,Effect} from "effect"
export type Box<A> = Data.TaggedEnum<{Full:{value:A}}>
export interface $Box$Definition extends Data.TaggedEnum.WithGenerics<1> { readonly taggedEnum: Box<this["A"]> }
export const Box = Data.taggedEnum<$Box$Definition>()
export type BoxOf<A = string> = Box<A>
export const defaulted: BoxOf = Box.Full({ value: "text" })
export const explicit: BoxOf<number> = Box.Full({ value: 1 })
export function main():Effect.Effect<readonly unknown[],never> {return Effect.gen(function*(){
  return [defaulted._tag, defaulted.value, explicit._tag, explicit.value]
})}
