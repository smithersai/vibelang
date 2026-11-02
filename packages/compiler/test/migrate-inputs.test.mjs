import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { spawnSync } from "node:child_process"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { test } from "node:test"

const root = fileURLToPath(new URL("../../../", import.meta.url))
const flow = ".smithers/flows/migrate"
// Every file of the migrate flow: the targets run its tests and import its library, templates and corpus. A list of
// chosen files went stale as lanes added tests (and 10 rejections in 12 hours on 2026-11-01 were lanes editing that
// list); a `//` glob in packages/PACKAGE.ts matched no file at all.
const flowFiles = (dir = flow) => readdirSync(join(root, dir), { withFileTypes: true })
  .flatMap(e => e.isDirectory() ? (e.name === "node_modules" ? [] : flowFiles(dir + "/" + e.name)) : [dir + "/" + e.name])
for (const label of ["//packages:compiler-test", "//packages:migrate-test", "//packages:vite-test", "//packages:compiler-tools-test"]) {
  test(label + " keys every file of the migrate flow, including hidden directories", { timeout: 180000 }, () => {
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
    // migrate-test also runs the convert flow's tests.
    const required = [...flowFiles(), ...(label.includes("migrate-test") ? flowFiles(".smithers/flows/convert") : [])]
    assert.ok(required.some(f => f.startsWith(flow + "/templates/")) && required.some(f => f.startsWith(flow + "/test/corpus/")))
    for (const file of required) {
      assert.ok(files.has(file), label + ": missing cache input " + file)
      assert.equal(files.get(file), createHash("sha256").update(readFileSync(join(root, file))).digest("hex"), label + ": stale digest for " + file)
    }
  })
}
