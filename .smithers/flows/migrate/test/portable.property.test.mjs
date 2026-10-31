import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { test } from "node:test"
const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const fc = require("fast-check")
const contract = readFileSync(new URL("../README.md", import.meta.url), "utf8")

import { absolutePaths } from "../lib/portable.mjs"
function check(input) {
  const { protocol, slashes, path, prefix, suffix } = input
  const bare = protocol + ":" + "/".repeat(slashes)
  assert.deepEqual(absolutePaths(prefix + bare + " " + suffix, []), [])
  assert.deepEqual(absolutePaths(prefix + bare, []), [])
  const absolute = bare + path
  assert.deepEqual(absolutePaths(prefix + absolute + " " + suffix, []), [absolute])
  assert.deepEqual(absolutePaths(prefix + protocol + ":../" + path + " " + suffix, []), [])
}
test("t3code: a bare file URL in prose is portable while absolute specifiers still fail", () => {
  assert.ok(contract.includes("checks the lines it adds for this machine's absolute paths"))
  const corpus = JSON.parse(readFileSync(new URL("./corpus/t3code-portable-prose.json", import.meta.url), "utf8"))
  assert.deepEqual(absolutePaths(corpus.witness, []), [])
  const segment = fc.stringMatching(/^[a-z][a-z0-9_-]{0,8}$/)
  const path = fc.array(segment, { minLength: 1, maxLength: 4 }).map((parts) => parts.join("/") + ".tgz")
  fc.assert(fc.property(fc.record({
    protocol: fc.constantFrom("file", "link", "portal"),
    slashes: fc.integer({ min: 1, max: 5 }),
    path,
    prefix: fc.constantFrom("/** Absolute ", "specifier: ", "\"", "'"),
    suffix: fc.constantFrom("preload URL */", "end", "\"", "'")
  }), check), { seed: 70567056, numRuns: 350 })
})
