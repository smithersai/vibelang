import * as Effect from "effect/Effect"
import { Plain } from "./out/ext.js"
import * as m from "./out/main.js"

// Each call either returns its arm's value or throws the proposal's TypeError.
function run(f, ...args) {
  try {
    const value = f(...args)
    return Effect.isEffect(value) ? Effect.runSync(value) : value
  } catch (error) {
    return error instanceof TypeError ? `TypeError: ${error.message}` : `other: ${error}`
  }
}

const structural = { n: 1 } // a Plain by type, but no instance
const fake = { x: 1 } // a Point by type, but no instance
for (const [name, f, hit, miss] of [
  ["any", m.anyValue, "a", "b"],
  ["error", m.errorValue, new Error("boom"), { message: "fake", name: "Error" }],
  ["number", m.numberValue, 1, 2],
  ["object", m.objectValue, new Date(0), {}],
  ["string", m.stringValue, "a", "b"],
  ["mixed", m.mixedClasses, new Plain(1), structural],
  ["ts class", m.tsClass, new Plain(1), structural],
  ["type parameter", m.typeParameter, "a", 3],
  ["unknown", m.unknownValue, "a", null],
  ["vibe class", m.vibeClass, m.point(1), fake],
  ["slider", m.slider, { orientation: "Vertical", alignment: "Edge" }, { orientation: "Diagonal", alignment: "Edge" }],
  ["optional field", m.optionalField, { mode: "on" }, {}],
  ["mixed union", m.mixedUnion, "a", { n: 1 }]
]) {
  console.log(`${name}: ${run(f, hit)} | ${run(f, miss)}`)
}
console.log(`error tag: ${run(m.mixedClasses, m.notFound("x"))}`)
