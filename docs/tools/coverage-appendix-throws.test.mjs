import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"
const inventory = JSON.parse(readFileSync(new URL("../design/inventory/throws.json", import.meta.url), "utf8"))
const entries = (module, declaration) => {
  const rows = inventory.entries.filter(e => e.module === module && e.declaration === declaration)
  assert.ok(rows.length, module + "." + declaration)
  return rows
}

// Chapter 900: every shipped Array and ReadonlyArray overload keeps its callback contract.
// docs/design/src/900-appendices.md#c1fbc1b5ae03d829 — Chapter 900: Array and ReadonlyArray callback annotations.
test("array annotations cover mutable and readonly overloads", () => {
  for (const receiver of ["Array", "ReadonlyArray"]) {
    for (const method of ["map", "forEach", "filter", "find", "some", "every"]) {
      for (const entry of entries("global", receiver + "." + method)) {
        assert.equal(entry.ownThrows, "never")
        const parameter = ["map", "forEach"].includes(method) ? "callbackfn" : "predicate"
        assert.deepEqual(entry.rethrows, [parameter])
        assert.ok(entry.callbacks.some(c => c.parameter === parameter && c.admits === "unknown"))
      }
    }
  }
  for (const entry of entries("global", "Array.sort")) {
    assert.equal(entry.ownThrows, "never")
    assert.deepEqual(entry.rethrows, ["compareFn"])
  }
})
test("Date.now has the same never contract as Math.max and Option.some", () => {
  for (const [module, declaration] of [["global", "Date.now"], ["global", "Math.max"], ["effect/Option", "some"]])
    assert.ok(entries(module, declaration).every(e => e.ownThrows === "never"))
})
// docs/design/src/900-appendices.md#e3a6001f201852c3 — Chapter 900: Appendix E options-form catch callback has no throws.
// docs/design/src/900-appendices.md#a42359b6bb25674d — Chapter 900: Appendix E promise thunk admits only never.
test("wrapper options admit a throwing try thunk and only a nonthrowing catch", () => {
  for (const declaration of ["try", "tryPromise"]) {
    const contracts = entries("effect/Effect", declaration).flatMap(e => e.callbacks)
    assert.ok(contracts.some(c => c.parameter === "options.try" && c.admits === "unknown"))
    assert.ok(contracts.some(c => c.parameter === "options.catch" && c.admits === "never"))
  }
  assert.ok(entries("effect/Effect", "promise").every(e => e.callbacks.every(c => c.admits === "never")))
})

// Chapter 900: a timer stores its callback, so it has no rethrows contract.
// docs/design/src/900-appendices.md#f3844bec75aee36b — Chapter 900: setTimeout stores callbacks rather than rethrowing.
test("setTimeout is not a rethrowing invocation", () => {
  for (const entry of entries("global", "setTimeout")) assert.deepEqual(entry.rethrows, [])
})

// docs/design/src/900-appendices.md#03259cc60a228a62 — Chapter 900: data-last overload callbacks have no @throws.
test("Chapter 900: data-last dual factories admit only non-throwing callbacks", () => {
  for (const declaration of ["map", "catchTag"]) {
    const factories = entries("effect/Effect", declaration).filter(e => e.returns.length)
    assert.ok(factories.length, declaration)
    const callbacks = factories.flatMap(e => e.callbacks)
    assert.ok(callbacks.length, declaration + " has a callback parameter")
    for (const c of callbacks) assert.equal(c.admits, "never", declaration + "." + c.parameter)
  }
})
