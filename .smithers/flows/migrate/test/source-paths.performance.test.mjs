import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { createRequire } from "node:module"
import { readFileSync } from "node:fs"
import { test } from "node:test"
import { matchesGlob } from "node:path"
import { rewriteSourceLiterals as rewriteActual } from "../lib/source-paths.mjs"
const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const ts = require("typescript"), fc = require("fast-check")
const rewriteSourceLiterals = (ts, text, file, renames, options = {}) => rewriteActual(ts, text, file, renames, { inventory: renames.map(r => r.from), ...options })
const corpus = JSON.parse(readFileSync(new URL("./corpus/foldkit-selector-brace-literals.json", import.meta.url)))

test("foldkit-94: thousands of brace literals finish within five seconds", () => {
  const worker = String.raw`
    import { createRequire } from "node:module";
    import { readFileSync } from "node:fs";
    import { rewriteSourceLiterals } from ${JSON.stringify(new URL("../lib/source-paths.mjs", import.meta.url).href)};
    const require = createRequire(${JSON.stringify(new URL("../../../../packages/runtime/package.json", import.meta.url).href)});
    const ts = require("typescript");
    const c = JSON.parse(readFileSync(new URL(${JSON.stringify(new URL("./corpus/foldkit-selector-brace-literals.json", import.meta.url).href)})));
    const text = Array.from({length:c.count}, (_,i) => "const value" + i + " = " + JSON.stringify(i % 2 ? c.data : c.longPath) + ";").join("\n")
      + "\nconst selected = import.meta.glob(" + JSON.stringify(c.glob) + ");";
    const start = performance.now();
    const result = rewriteSourceLiterals(ts, text, "collector.ts", c.renames, { inventory: c.renames.map(r => r.from) });
    console.log(JSON.stringify({ms:performance.now()-start, edits:result.edits.length}));
  `
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", worker], { encoding:"utf8", timeout:5000 })
  assert.equal(result.error, undefined, "brace corpus exceeded five seconds: " + result.error)
  assert.equal(result.status, 0, result.stderr)
  const receipt = JSON.parse(result.stdout)
  assert.equal(receipt.edits, 1)
  assert.ok(receipt.ms < 5000)
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
