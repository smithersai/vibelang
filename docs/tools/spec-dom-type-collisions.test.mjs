import assert from "node:assert/strict"
import { test } from "node:test"
import { chapter } from "./spec-witness.mjs"

// Carried item 17, R3 OPUS-10: the list of DOM collisions omitted both
// type-only names, although VIP-14 already decides their two meanings.
test("chapter 5 classifies both type-only DOM collisions", () => {
  const services = chapter("005-services")
  assert.match(services, /In a type position, a bare name declared as a type by an ambient global declaration[^\n]*keeps that meaning/)
  const subpaths = services.slice(services.indexOf("3. **Subpath namespaces")).split("\n\n")[0]
  assert.match(subpaths, /`KeyFormat` \(`effect\/crypto`\) and `Transferable` \(`effect\/workers`\)[^\n]*DOM types only/)
  assert.match(subpaths, /a bare type[^\n]*keeps the DOM(?:'s)? meaning/)
})
