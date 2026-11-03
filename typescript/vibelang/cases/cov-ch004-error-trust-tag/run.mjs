import { Effect } from "effect"
import { fileURLToPath } from "node:url"
import { compare } from "../../test/cov-ch004-twin.mjs"
await compare(fileURLToPath(new URL(".", import.meta.url)), Effect, [[true, true], "undefined", false, false])

// Chapter 004: foreign errors need not carry the local fields/getters.
// Mutate payload shape independently of the tag; recognition cannot read it.
const {createRequire}=await import("node:module")
const assert=await import("node:assert/strict")
// fast-check comes from docs/tools, which declares it; Effect's install does not.
const fc=createRequire(new URL("../../../../docs/tools/package.json",import.meta.url))("fast-check")
const actual=await import("./out/main.js")
const reference=await import("./typescript/out/main.js")
fc.assert(fc.property(fc.dictionary(fc.string(),fc.jsonValue()),fc.boolean(),(payload,hit)=>{
  const subject={...payload,_tag:hit?"Missing":"Other"}
  delete subject.id
  Object.defineProperty(subject,"label",{get(){throw new Error("matcher read a promised getter")}})
  assert.deepEqual(actual.probe(subject),reference.probe(subject))
}),{seed:4100,numRuns:1000})
fc.assert(fc.property(fc.jsonValue(),payload=>{
  const subject={payload,toString(){return "ready"}}
  Object.defineProperty(subject,Symbol.toPrimitive,{get(){throw new Error("template coerced its subject")}})
  assert.equal(actual.templateProbe(subject),reference.templateProbe(subject))
}),{seed:4140,numRuns:1000})
