import {Data,Effect,Equal} from "effect"
export interface BoxDefinition extends Data.TaggedEnum.WithGenerics<1> {readonly taggedEnum:Box<this["A"]>}
export const Box:Data.TaggedEnum.GenericConstructor<BoxDefinition>=Data.taggedEnum<BoxDefinition>()
export type Box<T>=Data.TaggedEnum<{Empty:{};Value:{readonly value:T}}>
export function main():Effect.Effect<readonly [number,boolean,boolean],never> {
  return Effect.gen(function*(){
    const value=Box.Value({value:7})
    return [value.value,Box.$is("Value")(value),Equal.equals(value,Box.Value({value:7}))] as const
  })
}
