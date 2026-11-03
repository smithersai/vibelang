import { Effect, Data } from "effect"
type Empty = Data.TaggedEnum<{}>
type Equal<X,Y> = (<T>() => T extends X ? 1 : 2) extends (<T>() => T extends Y ? 1 : 2) ? true : false
const emptyType: Equal<Empty, never> = true
export function main() {
  return Effect.gen(function* () { return emptyType 
  })
}
