// compareApiIdentity splits entries into batches. A batch must keep the entry
// that declares the globals the others read, as the whole project does.
import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { compareApiIdentity, loadTypeScript } from "./api-identity.mjs"

const ts = loadTypeScript()
const globals = "declare global {\n  interface Env {\n    readonly token: string;\n  }\n}\nexport {};\n"
const user = "export declare function read(env: Env): string;\n"
const options = { strict: true, types: [], module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler }

function compare(after = globals, entryBatchSize = 1) {
  const root = mkdtempSync(join(tmpdir(), "api-identity-batch-ambient-"))
  try {
    const entries = {}
    for (const side of ["before", "after"]) {
      const files = { "a.d.ts": user, "z/globals.d.ts": side === "after" ? after : globals }
      for (const [file, text] of Object.entries(files)) {
        mkdirSync(dirname(join(root, side, file)), { recursive: true })
        writeFileSync(join(root, side, file), text)
      }
      entries[side] = { "./a.js": "a.d.ts", "./z/globals.js": "z/globals.d.ts" }
    }
    return compareApiIdentity(ts, join(root, "before"), join(root, "after"), {
      beforeEntrypoints: entries.before, afterEntrypoints: entries.after, compilerOptions: options, entryBatchSize })
  } finally { rmSync(root, { recursive: true, force: true }) }
}

test("a batch keeps a global another entry reads", () => {
  const result = compare()
  assert.equal(result.comparisonComplete, true, JSON.stringify(result))
  assert.equal(result.identical, true, JSON.stringify(result))
})

test("batching still sees a changed global", () => {
  const result = compare(globals.replace("token: string", "token: number"))
  assert.equal(result.identical, false, JSON.stringify(result))
})

test("batch size does not change a whole-program answer", () => {
  assert.deepEqual([1, 2].map(size => compare(globals, size).identical), [true, true])
})
