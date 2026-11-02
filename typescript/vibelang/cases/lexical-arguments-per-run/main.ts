import { Effect } from "effect"
import { anonymous, identity, nested, plain, shorthand } from "./args.vibe"

const thrice = <A>(program: Effect.Effect<A>) => [Effect.runSync(program), Effect.runSync(program), Effect.runSync(program)]
console.log("nested", JSON.stringify(thrice(nested(10))))
console.log("identity", Effect.runSync(identity(10)))
console.log("shorthand", Effect.runSync(shorthand(10)))
console.log("anonymous", Effect.runSync(anonymous(7)))
console.log("plain", Effect.runSync(Effect.runSync(plain(5))()))
