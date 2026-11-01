import assert from "node:assert/strict"
import { readdirSync, readFileSync } from "node:fs"
import test from "node:test"
import { fileURLToPath } from "node:url"

// //packages:runtime-dist deletes dist/ before it builds. A target that reads that directory without
// declaring the build shares the checkout with it: 9d38528780b3 changed packages/PACKAGE.ts, the build
// reran beside //packages:compiler-test, and the cache properties failed on a missing dist/index.js in
// 7 ms while every test in cache.test.mjs skipped. Declaring the build orders the two and puts dist/ in
// the test's cache key.

const repo = fileURLToPath(new URL("../", import.meta.url))
const read = (path) => readFileSync(repo + path, "utf8")

const dataOf = (variable) => {
  const text = read("packages/PACKAGE.ts")
  const start = text.indexOf(`const ${variable} = S.Shell.`)
  assert.notEqual(start, -1, `packages/PACKAGE.ts has no ${variable}`)
  const data = /\n\s*data: \[([\s\S]*?)\],\n/.exec(text.slice(start))
  assert.ok(data, `${variable} declares no data`)
  return data[1]
}

const readersOfRuntimeDist = () =>
  readdirSync(repo + "packages/compiler/test")
    .filter((file) => file.endsWith(".mjs"))
    .filter((file) => /runtime[/"', ]+dist/.test(read(`packages/compiler/test/${file}`)))

test("the compiler package's tests read the runtime's dist/", () => {
  assert.ok(readersOfRuntimeDist().length >= 2, "no compiler test reads packages/runtime/dist: retire this check")
})

test("//packages:compiler-test declares the build of the dist/ its tests read", () => {
  const entries = dataOf("compilerTest").split(",").map((entry) => entry.trim())
  assert.ok(
    entries.includes("runtimeDist"),
    `compilerTest reads packages/runtime/dist in ${readersOfRuntimeDist().join(", ")} but does not declare runtimeDist`
  )
})
