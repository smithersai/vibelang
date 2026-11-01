import { Effect } from "effect"
import * as m from "./out/main.js"

const out = { shadowed: m.shadowed, value: m.value(), arrow: m.arrow(), main: m.main() }
try {
  m.thrower()
  out.thrown = null
} catch (e) {
  out.thrown = e
}
const program = m.timed()
out.afterCall = [...m.trace]
out.runs = [await Effect.runPromise(program), await Effect.runPromise(program)]
out.afterRuns = [...m.trace]
console.log(JSON.stringify(out))
