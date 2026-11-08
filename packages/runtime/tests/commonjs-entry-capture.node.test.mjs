import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"
import { runInNewContext } from "node:vm"
import fc from "fast-check"

const corpus = JSON.parse(readFileSync(new URL("./corpus/alchemy-captured-commonjs-exports.json", import.meta.url), "utf8"))
const bridges = [
  ["public", "../dist/native.cjs", "./index.js"],
  ["internal", "../dist/core-native.cjs", "./core.js"],
]

function loadBridge(source, path, abi, rejectVersion = false) {
  const captured = {}
  const module = { exports: captured }
  const stages = []
  const require = id => {
    if (id === "./version-guard.cjs") return {
      checkEffectVersion(version) {
        stages.push("version")
        assert.equal(version, "4.1.1")
        if (rejectVersion) throw new Error("incompatible Effect")
      },
    }
    if (id === "effect/package.json") return { version: "4.1.1" }
    assert.equal(id, path)
    stages.push("abi")
    return abi
  }
  // Bun can capture this original object before the synchronous bridge loads
  // an ES module graph. Keep that observer alongside the normal require result.
  runInNewContext(source, { module, exports: captured, require }, { timeout: 1000 })
  return { captured, returned: module.exports, stages }
}

for (const [name, file, path] of bridges) {
  const source = readFileSync(new URL(file, import.meta.url), "utf8")
  test(name + ": an early CommonJS observer receives all ABI values", () => {
    const entries = Object.fromEntries(corpus.exports.map(key => [key, function value() {}]))
    const result = loadBridge(source, path, Object.freeze(entries))
    assert.deepEqual(result.stages, ["version", "abi"])
    for (const key of Object.keys(entries)) {
      assert.equal(result.returned[key], entries[key], key)
      assert.equal(result.captured[key], entries[key], "early " + key)
    }
    assert.deepEqual(Object.keys(result.captured).sort(), Object.keys(entries).sort())
  })
  test(name + ": generated ABI subsets preserve value identity for early and late observers", () => {
    fc.assert(fc.property(
      fc.shuffledSubarray(corpus.exports, { minLength: 1 }),
      fc.boolean(),
      (keys, frozen) => {
        const entries = Object.fromEntries(keys.map(key => [key, function value() {}]))
        const result = loadBridge(source, path, frozen ? Object.freeze(entries) : entries)
        for (const key of keys) {
          assert.equal(result.captured[key], entries[key], key)
          assert.equal(result.returned[key], entries[key], key)
        }
        assert.deepEqual(Object.keys(result.captured).sort(), [...keys].sort())
      },
    ), { seed: corpus.seed, numRuns: 256 })
  })
  test(name + ": an incompatible Effect fails before reading the ABI", () => {
    assert.throws(() => loadBridge(source, path, {}, true), /incompatible Effect/)
  })
}
