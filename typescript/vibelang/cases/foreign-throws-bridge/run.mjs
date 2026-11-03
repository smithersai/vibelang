import { Effect, Exit } from "effect"
import { probe } from "./out/main.js"
const ok = await Effect.runPromise(probe("ok"))
const typed = await Effect.runPromise(Effect.catch(probe("range"), e => Effect.succeed(e.name)))
const defect = await Effect.runPromise(Effect.exit(Effect.catch(probe("other"), () => Effect.succeed("wrong"))))
if (!Exit.isFailure(defect)) throw new Error("unlisted TypeError must stay a defect")
const original = globalThis.RangeError
let replaced
try {
  replaced = await Effect.runPromise(Effect.catch(probe("replace"), e => Effect.succeed(e.name)))
} finally {
  globalThis.RangeError = original
}
console.log(JSON.stringify([ok, typed, "defect", replaced]))
