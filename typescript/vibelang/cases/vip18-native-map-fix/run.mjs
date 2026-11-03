import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { spawnSync } from "node:child_process"
import { fileURLToPath, pathToFileURL } from "node:url"

const dir = path.dirname(fileURLToPath(import.meta.url))
const compiler = fileURLToPath(new URL("../../../built/local/tsc", import.meta.url))
const work = path.join(dir, "out/fix-evidence")
fs.cpSync(path.join(dir, "input"), work, { recursive: true })
const fix = () => {
  const result = spawnSync(compiler, ["-p", work, "--fix", "--pretty", "false"], { encoding: "utf8", timeout: 30000 })
  assert.equal(result.status, 0, result.stdout + result.stderr)
  return result.stdout
}
fix()
const fixed = fs.readFileSync(path.join(work, "main.vibe"), "utf8")
assert(!fixed.includes("try.allSettled"))
const { check, empty, array, emptyArray, literalUnion } = await import(pathToFileURL(path.join(work, "out/main.js")))
const { Effect } = await import("effect")
assert.deepEqual(await Effect.runPromise(check()), {
  length: 2, tags: ["Success", "Success"], counts: { evaluations: 1, maps: 1, runs: 2 }
})
assert.deepEqual(await Effect.runPromise(empty()), [])
assert.deepEqual((await Effect.runPromise(array())).map(x => x.value), [1, "two"])
assert.deepEqual(await Effect.runPromise(emptyArray()), [])
assert.deepEqual((await Effect.runPromise(literalUnion([Effect.succeed(1), Effect.succeed("two")]))).map(x => x.value), [1, "two"])
assert.match(fix(), /0 fixes in 0 files/)
assert.equal(fs.readFileSync(path.join(work, "main.vibe"), "utf8"), fixed)
console.log("preserved")
