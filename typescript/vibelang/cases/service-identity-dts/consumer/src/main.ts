// TypeScript code that uses the .vibe services through their declarations, as
// it would Effect TypeScript's Context.Service classes (D501): it implements
// and provides each service's shape and requires its identifier, and stock
// TypeScript rejects what would stand for a service without being it.
import { Context, Effect, Layer } from "effect"
import { current, Flags, greet, sourceOf, Users, UsersInMemory } from "../../out/main.js"

class UsersFake implements Context.Service.Shape<typeof Users> {
  readonly source = "fake"
  find(id: string) {
    return Effect.succeed({ id, name: `user ${id}` })
  }
}

// @ts-expect-error a class with the service's members lacks its key (TS2420)
export class UsersForged implements Users {
  readonly source = "forged"
  find(id: string) {
    return Effect.succeed({ id, name: id })
  }
}

const shaped: Context.Service.Shape<typeof Users> = {
  source: "literal",
  find: (id) => Effect.succeed({ id, name: id })
}
// @ts-expect-error a plain object has the shape, not the identifier (TS2739)
export const forged: Users = shaped

const program = Effect.gen(function* () {
  const users = yield* Users
  const user = yield* users.find("7")
  const flags = yield* Flags
  return `${user.name} from ${users.source}, beta ${flags.beta}`
})

// A requirement of Users is Effect's identifier, nominal by its key: it is not
// a structural type with the service's members, so nothing relabels it.
type Structural = Context.Service.Shape<typeof Users>
// @ts-expect-error Users is not its shape (TS2322)
export const widened: Effect.Effect<string, never, Structural> = program

const viaCurrent = Effect.flatMap(current(), (users: Context.Service.Shape<typeof Users>) => sourceOf(users))

export const fake: Effect.Effect<string, never, never> = Effect.provide(program, Layer.succeed(Users, new UsersFake()))
export const literal: Effect.Effect<string, never, never> = Effect.provideService(program, Users, shaped)
export const live: Effect.Effect<string, never, never> = Effect.provide(greet("1"), Users.layer)
export const memory: Effect.Effect<string, never, never> = Effect.provide(viaCurrent, Layer.succeed(Users, new UsersInMemory()))
