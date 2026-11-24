import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { readFileSync } from "node:fs"
import { test } from "node:test"
import { matchesGlob } from "node:path"
import { rewriteSourceLiterals as rewriteActual } from "../lib/source-paths.mjs"
const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const ts = require("typescript"), fc = require("fast-check")
const rewriteSourceLiterals = (ts, text, file, renames, options = {}) => rewriteActual(ts, text, file, renames, { inventory: renames.map(r => r.from), ...options })
const corpus = JSON.parse(readFileSync(new URL("./corpus/foldkit-selector-brace-literals.json", import.meta.url)))

// foldkit-94: thousands of brace literals must not compile a matcher per
// literal. Count compilations, not seconds, so a loaded host cannot fail it:
// compiledSelector stores each compiled pattern once, so set calls count them.
test("foldkit-94: thousands of brace literals compile each selector once and never compile data", () => {
  const text = Array.from({ length: corpus.count }, (_, i) => "const value" + i + " = " + JSON.stringify(i % 2 ? corpus.data : corpus.longPath) + ";").join("\n")
    + "\nconst selected = import.meta.glob(" + JSON.stringify(corpus.glob) + ");"
  const compiled = []
  const cache = new Map()
  const set = cache.set.bind(cache)
  cache.set = (pattern, matcher) => { compiled.push(pattern); return set(pattern, matcher) }
  const result = rewriteSourceLiterals(ts, text, "collector.ts", corpus.renames, { matcherCache: cache })
  assert.equal(result.edits.length, 1)
  assert.equal(new Set(compiled).size, compiled.length, "a pattern compiled twice: " + compiled.join(" "))
  assert.ok(compiled.includes(corpus.glob) && compiled.includes(corpus.longPath), compiled.join(" "))
  assert.ok(!compiled.includes(corpus.data), "a data literal was compiled as a selector")
  // The glob, its rewritten form for the edit's proof, and the long path.
  assert.ok(compiled.length <= 3, compiled.join(" "))
})

test("foldkit-94: repeated path globs compile once; data and long literals never compile", () => {
  fc.assert(fc.property(fc.integer({min:1,max:40}), fc.constantFrom("a", "b"), (count, name) => {
    const cache = new Map()
    const glob = "src/{" + name + ",other}/**/*.ts"
    const source = Array.from({length:count}, (_,i) => "const f" + i + " = import.meta.glob(" + JSON.stringify(glob) + ")").join("\n")
      + "; const data = " + JSON.stringify(corpus.data) + "; const long = " + JSON.stringify("src/" + "{a,b}".repeat(50) + ".ts")
    const renames = [{from:"src/" + name + "/main.ts",to:"src/" + name + "/main.vibe"}]
    const result = rewriteSourceLiterals(ts, source, "collector.ts", renames, { matcherCache:cache })
    assert.equal(result.edits.length, count)
    assert.equal(cache.size, 2)
    assert.equal(result.text.includes(JSON.stringify(corpus.data)), true)
    assert.equal(rewriteSourceLiterals(ts, result.text, "collector.ts", renames).edits.length, 0)
  }), {seed:940067, numRuns:100})
})


test("foldkit-94: cached matching retains the host path matcher case rules", () => {
  fc.assert(fc.property(fc.constantFrom("src", "Src"), fc.constantFrom("a", "A"), fc.constantFrom("a", "A"), (directory, file, patternName) => {
    const from = directory + "/" + file + "/main.ts"
    const pattern = "src/{" + patternName + ",other}/**/*.ts"
    const result = rewriteSourceLiterals(ts, "const files = import.meta.glob(" + JSON.stringify(pattern) + ")", "collector.ts", [{from,to:from.replace(/\.ts$/, ".vibe")}])
    assert.equal(result.edits.length, matchesGlob(from,pattern) ? 1 : 0)
  }), {seed:940068,numRuns:50})
})
