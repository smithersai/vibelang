import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { spawnSync } from "node:child_process"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { test } from "node:test"

const root = fileURLToPath(new URL("../../../", import.meta.url))
const lib = ".smithers/flows/migrate/lib"
const tests = ".smithers/flows/migrate/test"
const modules = readdirSync(join(root, lib)).filter(f => f.endsWith(".mjs")).map(f => lib + "/" + f)
for (const label of ["//packages:compiler-test", "//packages:vite-test"]) {
  test(label + " keys the actual migration sources it executes, including hidden directories", { timeout: 180000 }, () => {
    const explain = target => {
      const child = spawnSync(process.execPath, [join(root, ".smithers/node_modules/.bin/smthrs"), "explain", target, "--format", "json"],
        { cwd: root, encoding: "utf8", maxBuffer: 16 * 1024 * 1024, timeout: 150000 })
      assert.equal(child.status, 0, child.stderr || child.stdout)
      return JSON.parse(child.stdout)
    }
    const plan = explain(label)
    assert.ok(plan.dependencies.includes("//:migration-sources"), label + ": missing migration source dependency")
    const sources = explain("//:migration-sources")
    const files = new Map(sources.inputs.flatMap(input => input.files ?? []).map(f => [f.path, f.digest]))
    const required = [...modules, ...(label.includes("compiler-test") ? [
      ...readdirSync(join(root, tests)).filter(f => f.startsWith("test-diff") && f.endsWith(".test.mjs")).map(f => tests + "/" + f),
      tests + "/corpus/foldkit-docpage-selector.json"
    ] : [])]
    for (const file of required) {
      assert.ok(files.has(file), label + ": missing cache input " + file)
      assert.equal(files.get(file), createHash("sha256").update(readFileSync(join(root, file))).digest("hex"), label + ": stale digest for " + file)
    }
  })
}
