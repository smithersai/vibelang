import assert from "node:assert/strict"
import { test } from "node:test"
import { chapter, read } from "./spec-witness.mjs"

// Loop round 3, OPUS-5 (decided detail 181, local own-shape hook).
test("chapter 5 and VIP-9 agree on a local service's Shape", () => {
  const services = chapter("005-services")
  assert.ok(services.includes("Inside the service's own members `Users.Shape` names that private type"))
  assert.ok(services.includes("Elsewhere `Users.Shape` is not declared; write `Context.Service.Shape<typeof Users>`:"))
  assert.ok(services.includes('service Local { static readonly key = "app/Local"; value: number; next?: Local.Shape }'))
  assert.ok(!services.includes("There `Users.Shape` is not declared"))
  const vip = read("docs/design/vips/0009-service-declarations.md")
  assert.ok(vip.includes("Inside that service's own shape, `S.Shape` denotes that alias directly"))
  assert.ok(vip.includes("Outside its own shape, a service declared in a function or block has no `S.Shape`"))
})
