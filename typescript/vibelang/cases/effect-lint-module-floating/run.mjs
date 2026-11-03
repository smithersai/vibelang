import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
const dir = mkdtempSync(join(tmpdir(), "vip38-mixed-"))
try {
  mkdirSync(join(dir, "node_modules"))
  symlinkSync(join(process.env.EFFECT_NODE_MODULES, "effect"), join(dir, "node_modules/effect"))
  symlinkSync(process.env.VIBELANG_RUNTIME, join(dir, "node_modules/vibelang-runtime"))
  writeFileSync(join(dir, "package.json"), '{"type":"module"}')
  const source = 'import { Effect } from "effect"; Effect.succeed(1); export {};'
  for (const name of ["native.ts", "main.vibe"]) writeFileSync(join(dir, name), source)
  const plugin = diagnosticSeverity => ({ name: "@effect/language-service", diagnosticSeverity })
  const issues = []
  for (const [name, plugins, severities, category] of [
    ["default", [plugin({})], {}, "error"],
    ["plugin-warning", [plugin({ floatingEffect: "warning" })], {}, "warning"],
    ["modern-off", [plugin({ floatingEffect: "error" })], { EK3801: "off" }, undefined],
    ["modern-error", [plugin({ floatingEffect: "warning" })], { EK3801: "error" }, "error"],
    ["modern-warning", [plugin({ floatingEffect: "error" })], { EK3801: "warning" }, "warning"],
    ["modern-suggestion", [plugin({ floatingEffect: "error" })], { EK3801: "suggestion" }, "suggestion"]
  ]) {
    try {
    writeFileSync(join(dir, "tsconfig.json"), JSON.stringify({ compilerOptions: {
      strict: true, types: [], skipLibCheck: true, noEmit: true, target: "ES2022", module: "NodeNext", plugins
    }, files: ["native.ts", "main.vibe"], vibe: { effectGlobals: false, effectModules: false, severities } }))
    const r = spawnSync(process.env.VIBELANG_BINARY, ["-p", "tsconfig.json", "--pretty", "false"], { cwd: dir, encoding: "utf8", timeout: 15000 })
    assert.equal(r.error, undefined, String(r.error))
    const output = r.stdout + r.stderr
    assert.equal(r.status === 0, category !== "error", name + "\n" + output)
    const observed = [...output.matchAll(/(native\.ts|main\.vibe)\(\d+,\d+\): (error|warning|suggestion) EK3801: floatingEffect:/g)].map(([, file, severity]) => [file, severity])
    // CLI may omit suggestion presentation, as ordinary TypeScript does; the
    // API oracle separately checks the stored category. Error/warning/off must
    // be observable in both selected source kinds.
    if (category !== "suggestion") assert.deepEqual(observed.sort(), category ? [["main.vibe", category], ["native.ts", category]] : [], name + "\n" + output)
    assert.doesNotMatch(output, /TS\d+|EK(?!3801\b)\d+/, name + "\n" + output)
    } catch (error) { issues.push(new Error(name + ": " + error.message)) }
  }
  // Native activation is explicit, not an automatic opt-in from project membership.
  writeFileSync(join(dir, "tsconfig.json"), JSON.stringify({ compilerOptions: {
    strict: true, types: [], skipLibCheck: true, noEmit: true, target: "ES2022", module: "NodeNext"
  }, files: ["native.ts"], vibe: { severities: { EK0801: "off" } } }))
  const absent = spawnSync(process.env.VIBELANG_BINARY, ["-p", "tsconfig.json", "--pretty", "false"], { cwd: dir, encoding: "utf8", timeout: 15000 })
  assert.equal(absent.error, undefined)
  assert.equal(absent.status, 0, absent.stdout + absent.stderr)
  assert.doesNotMatch(absent.stdout + absent.stderr, /EK38\d+/)
  if (issues.length) throw new AggregateError(issues, "VIP-38 mixed-input matrix")
} finally { rmSync(dir, { recursive: true, force: true }) }
console.log("mixed lint inputs")
