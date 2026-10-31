import * as Effect from "effect/Effect"
import * as M from "./out/main.js"
const run = value => Effect.isEffect(value) ? Effect.runSync(value) : value
console.log(JSON.stringify([
  M.first([1]), M.first([1, 2]), M.second([1, "x"]), M.second("ab"),
  M.bytes(new Uint8Array([1, 2])), M.bytes(new Uint8Array([1])),
  M.map(new Map([[1, 2]])), M.map({}),
  M.extracted(7), M.extracted("7"), M.iterated("go"), M.iterated("no"), M.predicate("a"), M.predicate(1), M.custom(7),
].map(run)))
