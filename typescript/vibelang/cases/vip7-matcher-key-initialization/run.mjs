import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const dir = path.dirname(fileURLToPath(import.meta.url))
const native = Object.getOwnPropertyDescriptor(Symbol, "customMatcher")
assert.equal(native, undefined, "this host already has Symbol.customMatcher")
const program = await import(pathToFileURL(path.join(dir, "out", "main.js")).href)
assert.deepEqual(Object.getOwnPropertyDescriptor(Symbol, "customMatcher"), {
  value: Symbol.for("Symbol.customMatcher"), writable: false, enumerable: false, configurable: false,
})
assert.equal(program.observed, true, "probe.ts ran before the runtime initialized the key")
assert.equal(program.classify(2), "even")
assert.equal(program.classify(3), "other")
const emitted = fs.readFileSync(path.join(dir, "out", "main.js"), "utf8")
const imports = [...emitted.matchAll(/^import\s.*?from\s+"([^"]+)"|^import\s+"([^"]+)"/gm)].map(m => m[1] ?? m[2])
assert.match(imports[0], /^vibelang-runtime/, "first import: " + imports.join(", "))
console.log("matcher key initialized first, with well-known descriptors")
