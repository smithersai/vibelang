import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { createRequire } from "node:module"

const require = createRequire(import.meta.url)
const packageRoot = path.dirname(path.dirname(require.resolve("effect/Effect")))
const projectEffect = new URL("./out/node_modules/effect/", import.meta.url)
fs.mkdirSync(new URL("./out/node_modules/", import.meta.url), { recursive: true })
fs.cpSync(packageRoot, projectEffect, { recursive: true })
const Effect = await import(new URL("dist/Effect.js", projectEffect).href)
const actual = await import("./out/main.js")
const reference = await import("./out/reference.js")
const expected = await Effect.runPromiseExit(reference.main())
assert.equal(expected._tag, "Success")
assert.deepEqual(expected.value, Array(22).fill(true))
const observed = await Effect.runPromiseExit(actual.main())
assert.equal(observed._tag, "Success")
assert.deepEqual(observed.value, expected.value)
console.log("try.all uses the project's Effect instance")
