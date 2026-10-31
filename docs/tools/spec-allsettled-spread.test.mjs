// A spread element of a try.allSettled literal spreads natively, then wraps
// each value it yields (loop round 1, ASTRA-1). The old translation,
// ...xs.map(Effect.exit), threw on a Set and read an array by index.
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

const root = process.env.SPEC_ALLSETTLED_ROOT || fileURLToPath(new URL("../..", import.meta.url))
const running = readFileSync(resolve(root, "docs/design/src/002-running.md"), "utf8")
const row = running.split("\n").find(line => line.startsWith("| `try.allSettled [a(), b()]` |"))

test("the try.allSettled row spreads natively before wrapping", () => {
  assert.ok(row, "the try.allSettled row")
  assert.match(row, /A spread element `\.\.\.xs` in the literal spreads natively, then wraps each value it yields: `\.\.\.\[\.\.\.\$xs\]\.map\(Effect\.exit\)`/)
  assert.doesNotMatch(row, /is `\.\.\.\$xs\.map\(Effect\.exit\)`/)
})

// The written translation, with Effect.exit as a tagging function, against
// native spread over each kind of iterable a spread accepts.
const exit = value => ({ exit: value })
const translated = xs => { const $xs = xs; return [...[...$xs].map(exit)] }
const native = xs => [...xs].map(exit)
const custom = () => {
  const xs = ["indexed"]
  Object.defineProperty(xs, Symbol.iterator, { value: function* () { yield "iterated" } })
  return xs
}
for (const [name, make] of [
  ["an array", () => [1, 2]],
  ["a Set", () => new Set([1])],
  ["a generator", () => (function* () { yield 1; yield 2 })()],
  ["an array with its own iterator", custom],
  ["an empty iterable", () => new Set()]
]) {
  test("the translation of a spread of " + name + " matches native spread", () => {
    assert.deepEqual(translated(make()), native(make()))
  })
}

test("the old translation is not native spread", () => {
  assert.throws(() => new Set([1]).map(exit), TypeError)
  assert.deepEqual(custom().map(exit), [{ exit: "indexed" }])
  assert.deepEqual(translated(custom()), [{ exit: "iterated" }])
})
