import assert from "node:assert/strict"
import { test } from "node:test"
import { block, chapter, read, run } from "./spec-witness.mjs"

// The rule's precedent is an async body, so each row of the chapter's table is
// checked on the same body written async. An async function rejects where the
// Effect dies.
class Base {
  static value = 7
  get value() { return 7 }
  offset() { return this.n }
  tag(_parts, value) { return this.n + value }
}

test("building reads nothing, and running reads this where the body does", async () => {
  class Derived extends Base {
    constructor(early) {
      const p = async () => this
      const unreached = async (flag) => { if (flag) return this; return 7 }
      const results = early ? [p(), unreached(false)] : undefined
      super()
      this.p = p
      this.results = results
    }
  }
  const late = new Derived(false)
  assert.equal(await late.p(), late)
  const [read, skipped] = new Derived(true).results
  await assert.rejects(read, ReferenceError)
  assert.equal(await skipped, 7)
})

test("this is read before a computed key", async () => {
  const seen = []
  const key = () => { seen.push("key"); return "value" }
  class Derived extends Base {
    constructor() {
      const read = (async () => super[key()])()
      super()
      this.read = read
    }
  }
  await assert.rejects(new Derived().read, ReferenceError)
  assert.deepEqual(seen, [])
})

test("a static block has its own super", async () => {
  class Derived extends Base { static program; static { this.program = async () => super.value } }
  assert.equal(await Derived.program(), 7)
})

test("a super call keeps its receiver and reads no call property", async () => {
  class Sub extends Base {
    n = 2
    go() { return (async () => super.offset())() }
    tagged() { return (async () => super.tag`value ${2}`)() }
  }
  Object.defineProperty(Base.prototype.offset, "call", { get() { throw new Error("call was read") } })
  assert.equal(await new Sub().go(), 2)
  // JavaScriptCore loses the receiver of a tagged template through super; V8 keeps it, as ECMA-262 says.
  if (!process.versions.bun) assert.equal(await new Sub().tagged(), 4)
})

test("the chapter states the rule with no helper recipe", () => {
  const functions = chapter("001-functions")
  assert.match(functions, /exactly as the same body reads them in an `async` function/)
  for (const name of ["001-functions", "002-running", "008-runtime"]) {
    assert.doesNotMatch(chapter(name), /\$super_get|\$super_set|\$new_target|\$apply/)
  }
  const producerMeaning = chapter("002-running").split("\n").find(line => line.startsWith(String.fromCharCode(96) + "effect function*"))
  assert.ok(producerMeaning, "missing producer binding contract")
  assert.doesNotMatch(producerMeaning, /with .Effect\.gen\(\{ self: this \}/)
  assert.match(producerMeaning, /how the compiler passes these bindings is its choice/)
  assert.match(read("docs/design/vips/0001-effect-and-async-functions.md"), /Amended 2026-10-30: bindings behave as in an `async` body/)
})
