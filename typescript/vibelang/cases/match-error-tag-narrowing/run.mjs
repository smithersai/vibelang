import * as Effect from "effect/Effect"
import * as M from "./out/main.js"
const run = value => Effect.isEffect(value) ? Effect.runSync(value) : value
const plain = { _tag: "NotFound", id: "2", source: "x" }
console.log(JSON.stringify([
  M.bare(new M.NotFound({ id: "1" })), M.bare(plain), M.bare(new M.Timeout()),
  M.bound(new M.NotFound({ id: "1" })), M.bound(plain), M.bound(new M.Timeout()),
  M.fallback(new M.NotFound({ id: "3" })), M.fallback(7),
].map(run)))
