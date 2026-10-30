import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"

for (const failure of ["setup", "compile"]) {
  for (const keep of [false, true]) {
    test(`register benchmark ${failure} failure ${keep ? "retains explicit output" : "removes temporary output"}`, t => {
      const root = mkdtempSync(join(tmpdir(), "vibelang-bench-cleanup-"))
      t.after(() => rmSync(root, { recursive: true, force: true }))
      const temp = join(root, "tmp")
      const out = join(root, "output")
      const bench = join(root, "scripts/bench")
      const compiler = join(root, "compiler")
      const register = join(root, "register.mjs")
      mkdirSync(temp)
      mkdirSync(bench, { recursive: true })
      // Run the actual CLI in a fixture checkout; only its external setup and compiler are fixtures.
      cpSync(new URL("./bench/register.mjs", import.meta.url), join(bench, "register.mjs"))
      writeFileSync(join(bench, "modules.sh"), failure === "setup"
        ? "#!/bin/sh\nmkdir -p \"$1/node_modules\"\necho fixture-setup-failed >&2\nexit 7\n"
        : "#!/bin/sh\nmkdir -p \"$1/node_modules\"\n")
      writeFileSync(register, "")
      writeFileSync(compiler, "#!/bin/sh\necho fixture-compile-failed >&2\nexit 7\n")
      chmodSync(compiler, 0o755)
      const result = spawnSync(process.execPath, [join(bench, "register.mjs"), "--packages", "2", "--modules", "1", "--runs", "1", "--register", register, ...(keep ? ["--out", out] : [])], {
        env: { ...process.env, TMPDIR: temp, VIBELANG: compiler }, encoding: "utf8"
      })
      assert.equal(result.status, 1)
      assert.ok(result.stderr.includes(`fixture-${failure}-failed`))
      assert.deepEqual(readdirSync(temp).filter(name => name.startsWith("vibelang-register-bench-")), [])
      if (keep) assert.equal(existsSync(join(out, failure === "setup" ? "node_modules" : "main.ts")), true)
    })
  }
}
