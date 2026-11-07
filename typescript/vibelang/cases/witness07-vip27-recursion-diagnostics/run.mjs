// project/ holds the same text as a .vibe file and an unchanged .ts file.
// tsc 7.0.2 and 5.9.3 report exactly these errors for both as .ts files, and
// declaration emit elides the anonymous cycle on line 4 of each without one.
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import path from "node:path"
import { fileURLToPath } from "node:url"

const root = fileURLToPath(new URL("../../../", import.meta.url))
const binary = process.env.VIBELANG_BINARY || path.join(root, "built/local/tsc")
const r = spawnSync(binary, ["-p", fileURLToPath(new URL("./project", import.meta.url)), "--pretty", "false"], { encoding: "utf8", timeout: 60000 })
assert.ifError(r.error)
const text = r.stdout + r.stderr
assert.equal(r.status, 2, text)
const got = [...text.matchAll(/^(\S+\(\d+,\d+\)): error (TS\d+):/gm)].map(m => m[1].replace(/^project\//, "") + " " + m[2])
const want = ["(1,14) TS7022", "(1,28) TS7024", "(2,17) TS7023", "(3,14) TS7023"]
assert.deepEqual(got, [...want.map(w => "lib.ts" + w), ...want.map(w => "main.vibe" + w)], text)
console.log("recursion diagnostics unchanged")
