// run-seconds: 120
import assert from "node:assert/strict"
import {spawnSync} from "node:child_process"
import {readFile} from "node:fs/promises"
import {fileURLToPath} from "node:url"

const {observations} = await import("./out/main.js")
assert.deepEqual(observations, [1, 2, 3, "namespace/Single", "namespace/Nested", "namespace/Dotted"])
const declaration = await readFile(new URL("./out/main.d.ts", import.meta.url), "utf8")
assert.ok(declaration.includes("Context"))
assert.ok(declaration.includes("namespace Single"))

const compiler = process.env.VIBELANG_BINARY ?? fileURLToPath(new URL("../../../built/local/tsc", import.meta.url))
const result = spawnSync(compiler, ["-p", fileURLToPath(new URL("input/tsconfig.json", import.meta.url)), "--noEmit", "--pretty", "false"], {encoding:"utf8", timeout:120000})
assert.equal(result.error, undefined)
assert.equal(result.signal, null)
assert.equal(result.status, 0, result.stdout + result.stderr)
console.log("namespace services retain native key builders and declaration imports")
