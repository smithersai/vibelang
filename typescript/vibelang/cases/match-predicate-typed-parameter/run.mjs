import * as Effect from "effect/Effect"
import * as M from "./out/main.js"
const run = value => Effect.isEffect(value) ? Effect.runSync(value) : value
console.log(JSON.stringify([
  M.label("a"), M.label(2), M.test("abc"), M.test(4), M.parity(2), M.parity(3), M.extracted(7), M.extracted(-1),
].map(run)))
