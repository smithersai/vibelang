import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, relative } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"

const script = process.env.VIBELANG_BENCH_MODULES_SCRIPT ?? fileURLToPath(new URL("./bench/modules.sh", import.meta.url))

for (const kind of ["absolute", "relative", "dangling"]) {
  for (const populated of [false, true]) {
    test("benchmark staging refuses a " + kind + " node_modules alias, populated=" + populated, t => {
      const root = mkdtempSync(join(tmpdir(), "vibelang benchmark alias-"))
      t.after(() => rmSync(root, { recursive: true, force: true }))
      const put = (path, value) => {
        const file = join(root, path)
        mkdirSync(dirname(file), { recursive: true })
        writeFileSync(file, value)
        return file
      }
      const copied = put("scripts/bench/modules.sh", "")
      cpSync(script, copied)
      put("packages/runtime/dist/index.js", "")
      put("packages/runtime/node_modules/effect/marker", "pinned")
      put("old effect/marker", "user effect")
      put("old runtime/marker", "user runtime")
      const shared = join(root, "shared install")
      mkdirSync(shared)
      put("shared install/keep.txt", "user marker")
      const names = ["effect", "vibelang-runtime"]
      if (populated) {
        for (let i = 0; i < names.length; i++) symlinkSync(join(root, i === 0 ? "old effect" : "old runtime"), join(shared, names[i]))
      }
      const output = join(root, "benchmark output")
      mkdirSync(output)
      const modules = join(output, "node_modules")
      const target = kind === "dangling" ? join(root, "missing install") : shared
      const alias = kind === "relative" ? relative(output, target) : target
      symlinkSync(alias, modules)
      const before = readdirSync(shared).sort()
      const result = spawnSync("sh", [copied, output], { encoding: "utf8" })
      assert.equal(result.status, 1, result.stdout + result.stderr)
      assert.ok(result.stderr.includes(modules), result.stderr)
      assert.match(result.stderr, /node_modules is a symlink/)
      assert.match(result.stderr, /fresh benchmark output directory/)
      assert.ok(lstatSync(modules).isSymbolicLink())
      assert.equal(readlinkSync(modules), alias)
      assert.deepEqual(readdirSync(shared).sort(), before)
      assert.equal(readFileSync(join(shared, "keep.txt"), "utf8"), "user marker")
      if (populated) {
        for (let i = 0; i < names.length; i++) assert.equal(readlinkSync(join(shared, names[i])), join(root, i === 0 ? "old effect" : "old runtime"))
      }
      assert.equal(existsSync(join(output, "package.json")), false)
      assert.equal(existsSync(join(root, "missing install")), false)
    })
  }
}
