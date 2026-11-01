import assert from "node:assert/strict"
import { test } from "node:test"
import { read } from "./spec-witness.mjs"

// Loop round 5, OPUS-3 and ASTRA-2 (decided detail 252): the try.allSettled
// counterpart for a literal with spreads builds the source array once,
// natively, and wraps it by index. The round 1 text, ...[...$xs].map(Effect.exit),
// spread a second, compiler-created array through Array.prototype[Symbol.iterator].

const row = () => read("docs/design/src/002-running.md").split("\n").find(l => l.startsWith("| `try.allSettled [a(), b()]` |"))

test("002 states the build-once counterpart and drops the double spread", () => {
  const r = row()
  assert.ok(r.includes("A literal with a spread element is built once, natively, in element order, as `[a(), ...xs, b()]` is"))
  assert.ok(r.includes("`const $source = [a(), ...xs, b()]; yield* Effect.all($source.map(Effect.exit), { concurrency: \"unbounded\" })`, and iterates no array the compiler creates"))
  assert.ok(r.includes("the `.map` describes evaluation and widens no literal's type"))
  for (const file of ["docs/design/src/002-running.md", "docs/design/vips/0018-concurrent.md"]) {
    assert.doesNotMatch(read(file), /\.\.\.\[\.\.\.\$xs\]\.map\(Effect\.exit\)/, file)
  }
})

test("VIP-18 carries the dated amendment", () => {
  assert.match(read("docs/design/vips/0018-concurrent.md"), /\*\*Amended 2026-10-31: spreads in a `try\.allSettled` literal\.\*\* A literal containing a spread is evaluated once, in native element order/)
})

// The oracle: for every literal shape, the stated counterpart observes the
// same Array.prototype[Symbol.iterator] calls and yields the same order as
// native [a(), ...xs, b()]; the old projection does not whenever an element
// is wrapped through a generated array.
const original = Array.prototype[Symbol.iterator]
function patched(mode, body) {
  let calls = 0
  Object.defineProperty(Array.prototype, Symbol.iterator, {
    configurable: true, writable: true,
    value: function () {
      calls++
      const items = Array.from({ length: this.length }, (_, i) => this[i])
      if (mode === "throw") throw new Error("iterator")
      return original.call(mode === "reverse" ? items.reverse() : items)
    },
  })
  try {
    return { value: body(), calls }
  } catch (e) {
    return { thrown: e.message, calls }
  } finally {
    Object.defineProperty(Array.prototype, Symbol.iterator, { configurable: true, writable: true, value: original })
  }
}
const kinds = {
  // Built without iterating an array, so only the spread reaches the patch.
  set: () => new Set().add("x").add("y"),
  generator: () => (function* () { yield "x"; yield "y" })(),
  own: () => { const a = ["i"]; Object.defineProperty(a, Symbol.iterator, { value: function* () { yield "x"; yield "y" } }); return a },
  array: () => ["x", "y"],
  empty: () => [],
}
const wrap = v => `exit(${v})`
// Compiler-owned arrays are walked by index, so only a source spread can reach
// the patched iterator, as in native [p0, ...xs, s0].
function push(out, items) { for (let i = 0; i < items.length; i++) out.push(items[i]) }
function spreadInto(out, iterable) { for (const v of iterable) out.push(v) }
function buildLiteral(pre, spreads, post) {
  const out = []
  push(out, pre)
  for (let i = 0; i < spreads.length; i++) spreadInto(out, kinds[spreads[i]]())
  push(out, post)
  return out
}
// The stated counterpart: one native construction, then wrap by index.
const stated = (pre, spreads, post) => buildLiteral(pre, spreads, post).map(wrap)
// The round 1 projection: [exit(p0), ...[...xs].map(exit), exit(s0)].
function old(pre, spreads, post) {
  const out = []
  push(out, pre.map(wrap))
  for (let i = 0; i < spreads.length; i++) {
    const inner = []
    spreadInto(inner, kinds[spreads[i]]())
    spreadInto(out, inner.map(wrap))
  }
  push(out, post.map(wrap))
  return out
}
const native = (pre, spreads, post) => [...pre, ...spreads.flatMap(k => [...kinds[k]()]), ...post]
function shapes() {
  const names = Object.keys(kinds), out = []
  for (const pre of [[], ["a"], ["a", "b"]])
    for (const post of [[], ["z"]])
      for (const n of [0, 1, 2])
        for (let i = 0; i < names.length ** n; i++) {
          const spreads = Array.from({ length: n }, (_, j) => names[Math.floor(i / names.length ** j) % names.length])
          out.push([pre, spreads, post])
        }
  return out
}

test("the stated counterpart matches native construction for every shape and patch mode", () => {
  let oldDiffers = 0
  for (const [pre, spreads, post] of shapes()) {
    for (const mode of ["count", "reverse", "throw"]) {
      const want = patched(mode, () => buildLiteral(pre, spreads, post))
      const got = patched(mode, () => stated(pre, spreads, post))
      assert.equal(got.calls, want.calls, `${mode} ${JSON.stringify([pre, spreads, post])}`)
      assert.equal(got.thrown, want.thrown)
      if (!want.thrown) assert.deepEqual(got.value, want.value.map(wrap))
      const was = patched(mode, () => old(pre, spreads, post))
      if (was.calls !== want.calls || was.thrown !== want.thrown || JSON.stringify(was.value) !== JSON.stringify(want.value?.map(wrap))) oldDiffers++
    }
    assert.deepEqual(buildLiteral(pre, spreads, post), native(pre, spreads, post))
  }
  // The round 5 witnesses: a Set and an ordinary array both expose the old projection.
  assert.ok(oldDiffers > 0)
  assert.deepEqual([patched("count", () => stated([], ["set"], [])).calls, patched("count", () => old([], ["set"], [])).calls], [0, 1])
  assert.deepEqual([patched("count", () => stated([], ["array"], [])).calls, patched("count", () => old([], ["array"], [])).calls], [1, 2])
})
