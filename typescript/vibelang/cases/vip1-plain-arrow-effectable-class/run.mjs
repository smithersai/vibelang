import { Effect } from "effect"
import * as m from "./out/main.js"

const out = { kind: typeof m.effectClass, localIsEffect: Effect.isEffect(m.Local) }
out.local = await Effect.runPromise(m.Local)
class Store extends m.effectClass(Effect.succeed(7)) {}
out.store = await Effect.runPromise(Store)
out.instance = new Store() instanceof Store
const curried = m.effectClass()
out.curriedKind = typeof curried
class Tagged extends curried(Effect.succeed("t")) {}
out.tagged = await Effect.runPromise(Tagged)
console.log(JSON.stringify(out))
