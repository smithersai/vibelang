import assert from "node:assert/strict"
import { Effect } from "effect"
import * as actual from "./out/main.js"
import * as native from "./out/native.js"

function observe(f, args, hostile) {
  const iterator = Object.getOwnPropertyDescriptor(Array.prototype, Symbol.iterator)
  const proto = Object.getPrototypeOf([][Symbol.iterator]())
  const next = Object.getOwnPropertyDescriptor(proto, "next")
  let reads = 0, steps = 0, program
  const problem = { hostile: true }
  Object.defineProperty(Array.prototype, Symbol.iterator, {
    configurable: true,
    get() { reads++; if (hostile) throw problem; return iterator.value },
  })
  Object.defineProperty(proto, "next", {
    ...next,
    value() { steps++; if (hostile) throw problem; return Reflect.apply(next.value, this, []) },
  })
  try { program = Reflect.apply(f, undefined, args) }
  finally {
    Object.defineProperty(Array.prototype, Symbol.iterator, iterator)
    Object.defineProperty(proto, "next", next)
  }
  return { reads, steps, first: Effect.runSync(program), second: Effect.runSync(program) }
}
for (const name of Object.keys(actual)) {
  const inputs = name === "array" ? [[], [[9]]] : name === "prefixed" ? [[3], [3, 5]] :
    name === "destructured" ? [[], [{ x: 9 }]] :
    name === "rested" ? [[], [5, 1, 2]] : [[], [9]]
  for (const args of inputs) for (const hostile of (name === "array" ? [false] : [false, true])) {
    const expected = observe(native[name], args, hostile)
    assert.equal(expected.reads, name === "array" ? 1 : 0)
    assert.equal(expected.steps, name === "array" ? 1 : 0)
    assert.deepEqual(observe(actual[name], args, hostile), expected, name)
  }
}
console.log(JSON.stringify("forwarding-ok"))
