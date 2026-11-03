import { Effect, Context } from "effect"
class Users extends Context.Service<Users, { key: string }>()("app/Users") {}
export function main() {
  return Effect.gen(function* () { return yield* Effect.provideService(Effect.gen(function* () { return (yield* Users).key }), Users, { key: "payload" }) 
  })
}
