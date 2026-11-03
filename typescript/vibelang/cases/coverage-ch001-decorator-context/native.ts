
import { Effect } from "effect"
function mark<This, A extends unknown[], R>(value:(this:This,...args:A)=>R, _context:ClassMethodDecoratorContext<This,(this:This,...args:A)=>R>) { return value }
export const main = () => Effect.gen(function* () {
 const decorator = yield* Effect.succeed(mark)
 const resolved = yield* Effect.succeed(decorator)
 class Repo { @resolved load() { return Effect.gen(function* () { return 7 }) } }
 return yield* new Repo().load()
})
