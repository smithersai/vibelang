import { Context, Effect } from "effect"
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false
export type Shape = { readonly value: string }
class Port extends Context.Service<Port, Shape>()("coverage/Port") {}
const DefaultPort = Context.Reference<Shape>("coverage/DefaultPort", { defaultValue: () => ({ value: "default" }) })
export const exact: Equal<Context.Service.Shape<typeof Port>, Shape> = true
export const defaultExact: Equal<Context.Service.Shape<typeof DefaultPort>, Shape> = true
export function main() {
  return Effect.gen(function* () {
    const a = yield* Effect.provideService(Effect.map(Port, p => p.value), Port, { value: "provided" })
    return [a, (yield* DefaultPort).value, "Shape" in Port, "Shape" in DefaultPort]
  })
}
