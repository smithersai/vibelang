import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"
import fc from "fast-check"
import { checkerVersionProblems } from "./shim-availability.mjs"

// The peer ranges and actual component-checker controls admit TypeScript 5.9.3.
// A newer minimum cannot describe these tools without a version qualification.
test("checker requirements retain the supported TypeScript 5 counterexamples", () => {
  assert.equal(checkerVersionProblems("vue-tsc and svelte-check need TypeScript 6").length, 1)
  assert.equal(checkerVersionProblems("vue-tsc requires at least TypeScript 7").length, 1)
  assert.deepEqual(checkerVersionProblems("vue-tsc and svelte-check use TypeScript's JavaScript API"), [])
  assert.deepEqual(checkerVersionProblems("vue-tsc and svelte-check do not require TypeScript 6"), [])
  assert.deepEqual(checkerVersionProblems("vue-tsc@99.0.0 requires TypeScript 6"), [])
  assert.deepEqual(checkerVersionProblems("svelte-check v99 requires TypeScript 6"), [])
})

test("the requirement scan leaves code examples and unrelated compilers alone", () => {
  const fence = String.fromCharCode(96).repeat(3)
  assert.deepEqual(checkerVersionProblems(fence + "text\nvue-tsc needs TypeScript 6\n" + fence), [])
  assert.deepEqual(checkerVersionProblems("The native compiler requires TypeScript 7"), [])
  assert.deepEqual(checkerVersionProblems("vue-tsc-extra requires TypeScript 6"), [])
  assert.deepEqual(checkerVersionProblems("vue-tsc uses the JavaScript API; ngc requires TypeScript 6"), [])
  assert.deepEqual(checkerVersionProblems("vue-tsc uses the JavaScript API, but ngc requires TypeScript 6"), [])
  assert.deepEqual(checkerVersionProblems("vue-tsc uses the JavaScript API. ngc requires TypeScript 6"), [])
  assert.deepEqual(checkerVersionProblems("Neither vue-tsc nor svelte-check require TypeScript 6"), [])
  assert.deepEqual(checkerVersionProblems("vue-tsc DOES NOT REQUIRE TypeScript 6"), [])
  assert.equal(checkerVersionProblems("This includes vue-tsc, svelte-check and ngc, which need TypeScript 6").length, 1)

  assert.match(checkerVersionProblems("Introduction\nsvelte-check requires TypeScript 6", { file: "guide.md" })[0], /^guide\.md:2:/)
})

test("the public replacement guide states the API boundary without an unsupported minimum", () => {
  const guide = readFileSync(new URL("../user/src/setup/typescript-shim.md", import.meta.url), "utf8")
  assert.deepEqual(checkerVersionProblems(guide), [])
  assert.match(guide, /JavaScript API/)
})

test("generated tool and wording variants preserve the TypeScript 5 witness", () => {
  fc.assert(fc.property(
    fc.constantFrom("vue-tsc", "svelte-check"),
    fc.constantFrom("need", "needs", "require", "requires"),
    fc.integer({ min: 5, max: 10 }),
    fc.boolean(), fc.boolean(), fc.boolean(), fc.boolean(),
    (tool, verb, major, qualified, negated, fenced, markup) => {
      const name = tool + (qualified ? "@99.0.0" : "")
      const tick = String.fromCharCode(96)
      const mention = markup ? tick + name + tick : name
      let text = mention + (negated ? " does not " : " ") + verb + " TypeScript " + major
      if (fenced) text = tick.repeat(3) + "text\n" + text + "\n" + tick.repeat(3)
      assert.equal(checkerVersionProblems(text).length, major > 5 && !qualified && !negated && !fenced ? 1 : 0)
    }
  ), { seed: 42421106, numRuns: 200 })
})
