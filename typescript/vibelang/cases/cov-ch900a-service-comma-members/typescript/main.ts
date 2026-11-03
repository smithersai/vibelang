import { Effect, Context } from "effect"
type Shape = { a: number; b: string }
class Users extends Context.Service<Users, Shape>()("app/Users") {}
const shape: Shape = { a: 1, b: "ok" }
export function main() {
  return Effect.gen(function* () { return shape.a 
  })
}
