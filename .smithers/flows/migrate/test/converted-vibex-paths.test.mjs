import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { test } from "node:test"
import { checkConvertedPaths, scannedFiles } from "../lib/converted-paths.mjs"

const ts = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))("typescript")
const check = files => checkConvertedPaths({ ts, tracked: Object.keys(files), read: path => files[path] })

// Issue 507: a .tsx module converted to .vibex is checked as a .ts module converted to .vibe is.
test("a selector that chose src/Card.tsx and not src/Card.vibex is refused", () => {
  const result = check({ "package.json": "{}", "src/Card.vibex": "export const Card = () => <div />\n",
    "build.config.ts": 'export default { plugins: [transform({ include: ["src/**/*.tsx"] })] }\n' })
  assert.equal(result.ok, false)
  assert.deepEqual(result.refusals.map(r => [r.module, r.file]), [["src/Card.tsx", "build.config.ts"]])
})

test("a stale path inside a converted .vibex file is scanned and refused", () => {
  const result = check({ "package.json": "{}", "src/worker.vibe": "export const w = 1\n",
    "src/main.vibex": 'import { fork } from "node:child_process"\nexport const View = () => <div />\nfork(new URL("./worker.ts", import.meta.url))\n' })
  assert.equal(result.ok, false)
  assert.equal(result.files, 3)
  assert.deepEqual(result.refusals.map(r => [r.module, r.file, r.kind]), [["src/worker.ts", "src/main.vibex", "static"]])
})

test("a run-time path to a converted .mts module is refused, and .d.vibex.ts sidecars are not code", () => {
  const result = check({ "package.json": "{}", "src/job.vibe": "export const j = 1\n",
    "src/run.ts": 'import { join } from "node:path"\nexport const load = (name: string) => import(join(import.meta.dirname, name + ".mts"))\n' })
  assert.equal(result.ok, false)
  assert.ok(result.refusals.some(r => r.module === "src/job.mts" && r.kind === "run-time"), JSON.stringify(result.refusals))
  assert.deepEqual(scannedFiles(["src/Card.d.vibex.ts", "src/a.d.vibe.ts", "src/Card.vibex"]), ["src/Card.vibex"])
})
