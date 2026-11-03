import { Context, Effect } from "effect"
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false
type Shape = { readonly value: number; read(): number; identity<A>(value: A): A }
class Users extends Context.Service<Users, Shape>()("coverage/Users") {}
const Flags = Context.Reference<{ enabled: boolean }>("coverage/Flags", { defaultValue: () => ({ enabled: true }) })
abstract class Ordinary { abstract value: string }
class Concrete extends Ordinary { value = "ordinary" }
export const shape: Equal<Context.Service.Shape<typeof Users>, Shape> = true
export const nativeShape: Equal<Context.Service.Shape<typeof Users>, Context.Service.Shape<typeof Users>> = true
function read(): Effect.Effect<number, never, Users> { return Effect.map(Users, u => u.value) }
export const requirement: Equal<ReturnType<typeof read>, Effect.Effect<number, never, Users>> = true
export function main() {
  return Effect.gen(function* () {
    const a = yield* Effect.provideService(read(), Users, { value: 7, read: () => 8, identity: <A>(x: A) => x })
    const b = (yield* Flags).enabled
    const c = yield* Effect.provideService(Effect.map(Flags, f => f.enabled), Flags, { enabled: false })
    return [a, b, c, new Concrete().value, "Shape" in Users, Users.key]
  })
}
