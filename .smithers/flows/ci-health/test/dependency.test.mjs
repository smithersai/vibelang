import assert from "node:assert/strict"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { spawnSync } from "node:child_process"
import { test } from "node:test"
import { analyze, cause, collect, report, start, targetLines } from "../lib/steps.mjs"

const fc = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))("fast-check")
const fixture = new URL("../fixture-missing-package/", import.meta.url)

test("real overflow package-resolution diagnostics identify the install failure before the assertion", () => {
  const lines = readFileSync(new URL("../fixture-missing-package/overflow-missing-package.log", import.meta.url), "utf8").split("\n")
  assert.equal(cause(lines), "missing package")
})

test("the real same-key dependency fixture reports the missing install and its next step", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "ci-health-dependency-"))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  start(dir, { results: fixture.pathname, since: "" })
  assert.equal(collect(dir).runs.length, 2)
  const result = analyze(dir)
  assert.equal(result.flaky.length, 1)
  assert.deepEqual(result.flaky[0].causes, { "missing package": 1 })
  report(dir)
  assert.match(readFileSync(join(dir, "report.md"), "utf8"), /Check the requesting module's pinned package install and module root/)
})

test("Node package diagnostics retain their classification across scoped names, subpaths and surrounding output", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "ci-health-node-"))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  fc.assert(fc.property(
    fc.stringMatching(/^[a-z]{1,10}$/), fc.boolean(), fc.boolean(),
    (name, scoped, subpath) => {
      const pkg = (scoped ? "@ci-health-absent/" : "ci-health-absent-") + name + (subpath ? "/nested" : "")
      const source = join(dir, "importer.mjs")
      writeFileSync(source, `import ${JSON.stringify(pkg)}\n`)
      const child = spawnSync(process.execPath, [source], { encoding: "utf8", timeout: 20000 })
      assert.ifError(child.error)
      assert.equal(child.status, 1)
      assert.match(child.stderr, /Cannot find package/)
      const lines = ["AssertionError: expected child status 0", ...child.stderr.split("\n")]
      assert.equal(cause(lines), "missing package")
      const log = lines.map((line) => "//:dependency: " + line).join("\n")
      assert.equal(cause(targetLines(log, "//:dependency")), "missing package")
    }
  ), { seed: 110, numRuns: 64 })
})

test("missing packages preserve higher-priority causes and do not swallow missing files or ordinary assertions", () => {
  const missing = "Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'effect' imported from <fixture>/importer.mjs"
  assert.equal(cause([missing, "Error: property paths-imports failed; saved failure.json"]), "property counterexample")
  assert.equal(cause([missing, "ENOSPC"]), "disk full")
  assert.equal(cause([missing, "SIGKILL"]), "killed")
  assert.equal(cause([missing, "deadline exceeded"]), "timeout")
  assert.equal(cause(["Error [ERR_MODULE_NOT_FOUND]: Cannot find module '<fixture>/gone.mjs' imported from <fixture>/importer.mjs"]), "missing file")
  assert.equal(cause(["AssertionError: expected installed package"]), "assertion")
})
