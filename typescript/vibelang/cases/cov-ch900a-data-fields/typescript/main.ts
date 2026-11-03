import { Effect, Data } from "effect"
type D = Data.TaggedEnum<{ A: { readonly x: string | number; readonly n: number } }>
const D = Data.taggedEnum<D>()
type Equal<X,Y> = (<T>() => T extends X ? 1 : 2) extends (<T>() => T extends Y ? 1 : 2) ? true : false
if (false) {
 const item = D.A({ x: "ok", n: 1 })
 // @ts-expect-error: data payloads are readonly
 item.x = "no"
}
export function main() {
  return Effect.gen(function* () { const item = D.A({ x: "ok", n: 1 }); return [item.x, item.n ] 
  })
}
