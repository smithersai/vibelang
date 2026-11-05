import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
const dir = mkdtempSync(join(tmpdir(), "lint-activation-"))
try {
  mkdirSync(join(dir, "node_modules"))
  symlinkSync(join(process.env.EFFECT_NODE_MODULES, "effect"), join(dir, "node_modules/effect"))
  writeFileSync(join(dir, "package.json"), '{"type":"module"}')
  writeFileSync(join(dir, "main.ts"), 'import * as Effect from "effect/Effect"; Effect.succeed(1); export {}')
  const plugin = options => [{ name: "@effect/language-service", ...options }]
  for (const [name, plugins, active, legacy] of [
    ["absent", undefined, true, true],
    ["empty", [], true, true],
    ["unrelated", [{ name: "unrelated" }], true, true],
    ["null", plugin({ diagnosticSeverity: null }), false, false],
    ["disabled", plugin({ diagnostics: false }), false, false],
    ["enabled", plugin({ diagnosticSeverity: { floatingEffect: "off" } }), true, false]
  ]) {
    for (const inherited of [false, true]) for (const configured of [false, true]) {
      const present = active && configured
      const migration = legacy && configured
      const config = { compilerOptions: {
        strict: true, skipLibCheck: true, types: [], target: "ES2022",
        module: "NodeNext", noEmit: true, plugins
      }, vibe: configured ? { severities: { EK3801: "error" } } : undefined }
      writeFileSync(join(dir, "base.json"), JSON.stringify(config))
      writeFileSync(join(dir, "tsconfig.json"), JSON.stringify(inherited
        ? { extends: "./base.json", files: ["main.ts"] }
        : { ...config, files: ["main.ts"] }))
      const r = spawnSync(process.env.VIBELANG_BINARY, ["-p", "tsconfig.json", "--pretty", "false"], {
        cwd: dir, encoding: "utf8", timeout: 30000
      })
      assert.equal(r.error, undefined)
      assert.equal(r.signal, null)
      const output = r.stdout + r.stderr
      assert.equal(/EK3801: floatingEffect:/.test(output), present, name + "/" + inherited + "\n" + output)
      assert.equal(/warning EK3012:/.test(output), migration, name + "/migration/" + configured + "\n" + output)
      assert.doesNotMatch(output, /TS\d+|EK(?!(?:3801|3012)\b)\d+/)
      assert.equal(r.status === 0, !present, name + "\n" + output)
    }
  }
} finally { rmSync(dir, { recursive: true, force: true }) }
console.log("lint activation controls")
