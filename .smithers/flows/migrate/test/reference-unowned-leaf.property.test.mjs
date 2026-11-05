import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"
import { tmpdir } from "node:os"
import { test } from "node:test"
import { referenceRefreshPlan, refreshProjectReferences } from "../lib/reference-outputs.mjs"
const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const ts = require("typescript"), fc = require("fast-check")
const corpus = JSON.parse(readFileSync(new URL("./corpus/t3code-reference-unowned-leaf.json", import.meta.url)))
const rule = "They follow the reverse reference closure"
function fixture({ vendor = corpus.vendor, extension = "ts", referenced = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), "reference-unowned-leaf-"))
  const put = (name, value) => {
    mkdirSync(dirname(join(root, name)), { recursive: true })
    writeFileSync(join(root, name), typeof value === "string" ? value : JSON.stringify(value))
  }
  const changed = "owned/src/main." + extension
  put("owned/tsconfig.json", { files: ["src/main." + extension],
    references: referenced ? [{ path: "../" + vendor }] : [] })
  put(changed, corpus.source)
  put(vendor, { extends: corpus.missing })
  put("owned/out/main.js", "keep-owned")
  put(dirname(vendor) + "/out/main.js", "keep-vendor")
  return { root, changed, configs: ["owned/tsconfig.json", vendor], put, vendor,
    close: () => rmSync(root, { recursive: true, force: true }) }
}
test("an independent leaf does not parse an unrelated vendored extends as a required dependency", () => {
  const f = fixture()
  try {
    assert.deepEqual(referenceRefreshPlan({ ...f, ts, changed: [f.changed] }), { projects: [], roots: [], outputs: [] })
  } finally { f.close() }
})
test("a genuine missing vendor reference is still rejected before outputs are cleared", async () => {
  const f = fixture({ referenced: true })
  try {
    await assert.rejects(refreshProjectReferences({ ...f, ts, changed: [f.changed], tracked: [f.changed],
      compiler: "unused", log: join(f.root, "refresh.log"), execute: async () => assert.fail("invalid dependency executed") }),
      error => error.message.includes(f.vendor) && /TS6053/.test(error.message))
    assert.equal(readFileSync(join(f.root, "owned/out/main.js"), "utf8"), "keep-owned")
    assert.equal(readFileSync(join(f.root, dirname(f.vendor), "out/main.js"), "utf8"), "keep-vendor")
  } finally { f.close() }
})
test("unrelated missing extends never changes a reference-free leaf plan", () => {
  assert.ok(readFileSync(new URL("../../../../docs/user/src/setup/existing-project.md", import.meta.url), "utf8").includes(rule))
  fc.assert(fc.property(fc.constantFrom(".repos/vendor", "fixtures/framework", "submodules/sdk"), fc.nat(999),
    fc.constantFrom("ts", "vibe"), fc.boolean(), (directory, suffix, extension, referenced) => {
      const f = fixture({ vendor: directory + suffix + "/tsconfig.json", extension, referenced })
      try {
        if (referenced) assert.throws(() => referenceRefreshPlan({ ...f, ts, changed: [f.changed] }),
          error => error.message.includes(f.vendor) && /TS6053/.test(error.message))
        else assert.deepEqual(referenceRefreshPlan({ ...f, ts, changed: [f.changed] }), { projects: [], roots: [], outputs: [] })
        assert.equal(readFileSync(join(f.root, f.changed), "utf8"), corpus.source)
        assert.equal(readFileSync(join(f.root, "owned/out/main.js"), "utf8"), "keep-owned")
      } finally { f.close() }
    }), { seed: 561107, numRuns: 64 })
})
