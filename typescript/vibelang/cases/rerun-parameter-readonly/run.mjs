import { Effect } from "effect"
import * as program from "./out/main.js"

{
  const p = program.compact(1)
  console.log("compact", JSON.stringify([Effect.runSync(p), Effect.runSync(p), Effect.runSync(p)]))
}
{
  const p = program.declared(1)
  console.log("declaration", JSON.stringify([Effect.runSync(p), Effect.runSync(p), Effect.runSync(p)]))
}
{
  const p = new program.Counter().read(1)
  console.log("method", JSON.stringify([Effect.runSync(p), Effect.runSync(p), Effect.runSync(p)]))
}
{
  const p = program.shadowed(1)
  console.log("shadowed", JSON.stringify([Effect.runSync(p), Effect.runSync(p), Effect.runSync(p)]))
}
{
  const p = program.property({ n: 1 })
  console.log("object mutation", JSON.stringify([Effect.runSync(p), Effect.runSync(p), Effect.runSync(p)]))
}
// plain and plainRest are plain functions (VIP-1): each call runs the body.
console.log("plain", JSON.stringify([program.plain(1), program.plain(1), program.plain(1)]))
console.log("plain rest", JSON.stringify([program.plainRest(1, 2), program.plainRest(1, 2), program.plainRest(1, 2)]))
{
  const p = program.hatch(1)
  console.log("sync", JSON.stringify([Effect.runSync(p), Effect.runSync(p), Effect.runSync(p)]))
}
for (const [name, p] of [
  ["shorthand", program.shorthand(1)],
  ["factory", program.factory(1)]
]) console.log(name, JSON.stringify([Effect.runSync(p), Effect.runSync(p), Effect.runSync(p)]))
