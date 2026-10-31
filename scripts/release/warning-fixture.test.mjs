import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { test } from "node:test"

const root = fileURLToPath(new URL("../../", import.meta.url))
const script = readFileSync(join(root, "scripts/release/check-app.sh"), "utf8")
function heredoc(path, delimiter) {
  const start = "cat >" + path + " <<'" + delimiter + "'\n"
  assert.ok(script.includes(start), "missing release fixture " + path)
  return script.split(start)[1].split("\n" + delimiter)[0]
}
const config = JSON.parse(heredoc("warning-vite/tsconfig.json", "JSON"))
const source = heredoc("warning-vite/warning.vibe", "VIBE")
const appendix = readFileSync(join(root, "docs/design/src/900-appendices.md"), "utf8")
  .split("## Appendix B. Diagnostics")[1].split("\n## Appendix C.")[0]
const warnings = new Set([...appendix.matchAll(/^\| `(EK\d{4,})` \| (?:lint )?warning:/gm)].map(match => match[1]))

test("release warning-only fixture uses an assigned warning without demoting a retired error", () => {
  const expected = /grep -Fq 'warning (EK\d+)'/.exec(script)?.[1]
  assert.ok(warnings.has(expected), expected + " must be an Appendix B warning")
  assert.equal(config.compilerOptions.noEmitOnError, true)
  assert.equal(config.compilerOptions.vibelang, undefined, "retired compilerOptions settings must not hide config errors")
  for (const [code, severity] of Object.entries(config.vibe?.severities || {})) {
    assert.ok(warnings.has(code), code + " is not a configurable warning")
    assert.equal(severity, "warning")
  }
})

const native = process.env.VIBELANG_BINARY || join(root, "packages/compiler/native/vibelang")
const modules = process.env.EFFECT_NODE_MODULES || join(root, "experiments/node_modules")
test("the exact release warning fixture emits JavaScript with noEmitOnError", {
  skip: !existsSync(native) || !existsSync(join(modules, "effect"))
}, t => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "release-warning-")))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  mkdirSync(join(dir, "node_modules"))
  symlinkSync(realpathSync(join(modules, "effect")), join(dir, "node_modules/effect"))
  symlinkSync(join(root, "packages/runtime"), join(dir, "node_modules/vibelang-runtime"))
  writeFileSync(join(dir, "package.json"), '{"type":"module"}\n')
  writeFileSync(join(dir, "tsconfig.json"), JSON.stringify({
    ...config,
    compilerOptions: { ...config.compilerOptions, outDir: "dist" },
    include: ["warning.vibe"]
  }))
  writeFileSync(join(dir, "warning.vibe"), source)
  const result = spawnSync(native, ["-p", join(dir, "tsconfig.json"), "--pretty", "false"], { encoding: "utf8", timeout: 60_000 })
  assert.equal(result.status, 0, result.stdout + result.stderr + String(result.error || ""))
  const expected = /grep -Fq 'warning (EK\d+)'/.exec(script)?.[1]
  assert.match(result.stdout, new RegExp("warning " + expected + ":"))
  assert.equal([...result.stdout.matchAll(/warning EK\d+:/g)].length, 1, result.stdout)
  assert.ok(existsSync(join(dir, "dist/warning.js")), result.stdout)
  assert.match(readFileSync(join(dir, "dist/warning.js"), "utf8"), /export/)
})
