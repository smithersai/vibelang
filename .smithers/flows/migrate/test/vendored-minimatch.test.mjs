// lib/vendor/minimatch.mjs is the pinned minimatch bundled into the flow, which
// is staged without node_modules (see the staged-flow tests in
// emitted-js.test.mjs). The pinned package stays in .smithers/package.json as
// this test's oracle: the bundle must be that version and match as it does.
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { test } from "node:test"
import { Minimatch as Installed } from "minimatch"
import { Minimatch as Vendored } from "../lib/vendor/minimatch.mjs"

const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const fc = require("fast-check")
const pinned = JSON.parse(readFileSync(new URL("../../../package.json", import.meta.url), "utf8")).dependencies.minimatch

test("the vendored minimatch is the version .smithers/package.json pins", () => {
  const installed = createRequire(new URL("../../../package.json", import.meta.url))("minimatch/package.json").version
  assert.equal(installed, pinned)
  assert.match(readFileSync(new URL("../lib/vendor/minimatch.mjs", import.meta.url), "utf8"), new RegExp(`^// minimatch ${pinned.replaceAll(".", "\\.")} `))
})

// source-paths.mjs's options, and the same with case folding and negation on.
const options = [
  { nonegate: true, nocomment: true, windowsPathsNoEscape: true, nocaseMagicOnly: true, optimizationLevel: 2, platform: "linux", nocase: false },
  { nonegate: true, nocomment: true, windowsPathsNoEscape: true, nocaseMagicOnly: true, optimizationLevel: 2, platform: "darwin", nocase: true },
  { dot: true, platform: "linux" }
]
const piece = fc.constantFrom("src", "a", "b.ts", "x.vibe", "*", "**", "?", "[ab]", "[!a]", "{a,b}", "{1..3}", "+(a|b)", "!(a)", "@(x|y)", "/", "/", ".", "..", "\\", "#", "!", "-", ".ts")
const pattern = fc.array(piece, { maxLength: 7 }).map((parts) => parts.join(""))
const path = fc.array(fc.constantFrom("src", "a", "b", "b.ts", "x.vibe", ".hidden", "1", "2", "ab", "A"), { maxLength: 4 }).map((parts) => parts.join("/"))
const outcome = (Matcher, glob, option, file) => {
  try {
    const matcher = new Matcher(glob, option)
    return { match: matcher.match(file), magic: matcher.hasMagic(), set: matcher.set.length }
  } catch (error) { return { threw: error.constructor.name, message: error.message } }
}

test("vendored-minimatch: the bundle matches, and refuses, exactly as the pinned package", () => {
  fc.assert(fc.property(pattern, path, fc.constantFrom(...options), (glob, file, option) => {
    assert.deepEqual(outcome(Vendored, glob, option, file), outcome(Installed, glob, option, file))
  }), { seed: 20261102, numRuns: 2000 })
})
