// run-seconds: 120
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, symlinkSync } from "node:fs"
import { dirname, join, relative } from "node:path"
import { tmpdir } from "node:os"
for (const code of ["EK4609", "EK4842"]) for (const mode of ["external", "dependency", "symlink-external", "symlink-dependency", "owned", "owned-parent"]) {
  const top = mkdtempSync(join(tmpdir(), "config-owner-"))
  try {
    const repo = join(top, "repo")
    const selected = mode === "owned-parent" ? join(repo, "packages/app") : repo
    mkdirSync(selected, { recursive: true })
    mkdirSync(join(repo, ".jj"))
    let base = join(top, "external/base.json")
    if (mode === "dependency" || mode === "symlink-dependency") base = join(repo, "node_modules/config/base.json")
    const owned = mode === "owned" || mode === "owned-parent"
    if (owned) base = join(repo, "config/base.json")
    mkdirSync(dirname(base), { recursive: true })
    const original = '// keep comment\n' + JSON.stringify({ vibelang: { diagnostics: { [code]: "off" } } }) + "\n"
    writeFileSync(base, original)
    let target = base
    if (mode.startsWith("symlink-")) {
      target = join(repo, "base-link.json")
      symlinkSync(base, target)
    }
    writeFileSync(join(selected, "package.json"), '{"type":"module"}')
    writeFileSync(join(selected, "main.vibe"), "export const n = 1\n")
    writeFileSync(join(selected, "tsconfig.json"), JSON.stringify({
      extends: "./" + relative(selected, target).replaceAll("\\", "/"),
      compilerOptions: { strict: true, noEmit: true, types: [], skipLibCheck: true, target: "ES2022", module: "NodeNext" },
      files: ["main.vibe"], vibe: { effectGlobals: false, effectModules: false }
    }))
    const invoke = () => {
      const r = spawnSync(process.env.VIBELANG_BINARY, ["--fix", "-p", "tsconfig.json", "--pretty", "false"], {
        cwd: selected, encoding: "utf8", timeout: 30000
      })
      assert.equal(r.error, undefined)
      assert.equal(r.signal, null)
      assert.equal(r.status, !owned && code === "EK4609" ? 2 : 0, mode + "/" + code + "\n" + r.stdout + r.stderr)
      return r.stdout + r.stderr
    }
    const output = invoke()
    const after = readFileSync(base, "utf8")
    if (owned) {
      assert.notEqual(after, original, mode)
      assert.match(after, /"severities"/)
      assert.match(after, /keep comment/)
    } else {
      assert.equal(after, original, mode)
      assert.match(output, /not fixed.*outside repository ownership/, mode + "\n" + output)
    }
    invoke()
    assert.equal(readFileSync(base, "utf8"), after, mode + " is not idempotent")
  } finally { rmSync(top, { recursive: true, force: true }) }
}
console.log("config ownership controls")
