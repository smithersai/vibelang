// rule-evidence: docs/design/src/007-tooling.md#config-files
// rule-evidence: docs/design/vips/0034-compiler-and-tooling.md#decision
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

const binary = process.env.VIBELANG_BINARY
assert.ok(binary, "VIBELANG_BINARY must name the tested compiler")
const local = fileURLToPath(new URL(".", import.meta.url))
const root = realpathSync(mkdtempSync(join(tmpdir(), "imported-effect-exit-")))
const warning = readFileSync(new URL("./smithers-warning.ts.txt", import.meta.url), "utf8")
let checks = 0
try {
  mkdirSync(join(root, "node_modules"))
  symlinkSync(realpathSync(join(local, "node_modules/effect")), join(root, "node_modules/effect"))
  symlinkSync(realpathSync(join(local, "node_modules/vibelang-runtime")), join(root, "node_modules/vibelang-runtime"))
  writeFileSync(join(root, "package.json"), '{"type":"module"}')
  const invoke = (config, source, command = []) => {
    rmSync(join(root, "out"), { recursive: true, force: true })
    rmSync(join(root, "main.ts"), { force: true })
    rmSync(join(root, "main.vibe"), { force: true })
    const ext = config.files[0]
    writeFileSync(join(root, ext), source)
    writeFileSync(join(root, "tsconfig.json"), JSON.stringify(config))
    const r = spawnSync(binary, [...command, "-p", ".", "--pretty", "false"], { cwd: root, encoding: "utf8", timeout: 15000 })
    assert.ifError(r.error)
    assert.equal(r.signal, null, r.stdout + r.stderr)
    checks++
    return { ...r, output: r.stdout + r.stderr, emitted: existsSync(join(root, "out/main.js")) }
  }
  const options = {
    target: "ES2022", module: "NodeNext", moduleResolution: "NodeNext",
    strict: true, skipLibCheck: true, types: [], outDir: "out"
  }
  for (const severity of ["warning", "error", "suggestion", "off"]) {
    for (const ignore of [false, true]) {
      for (const mode of ["check", "emit", "noEmitOnError"]) {
        const category = { warning: "Warnings", error: "Errors", suggestion: "Suggestions", off: "Warnings" }[severity]
        const config = { compilerOptions: {
          ...options, ...(mode === "check" ? { noEmit: true } : {}),
          ...(mode === "noEmitOnError" ? { noEmitOnError: true } : {}),
          plugins: [{ name: "@effect/language-service",
            diagnosticSeverity: { promiseInEffectSuccess: severity },
            includeSuggestionsInTsc: true, ["ignoreEffect" + category + "InTscExitCode"]: ignore }]
        }, files: ["main.ts"] }
        const r = invoke(config, warning)
        const fails = severity !== "off" && !ignore
        assert.equal(r.status, fails ? mode === "noEmitOnError" ? 1 : 2 : 0, JSON.stringify({severity,ignore,mode,output:r.output}))
        assert.equal(r.emitted, mode !== "check" && !(mode === "noEmitOnError" && fails), r.output)
        if (severity !== "off") assert.match(r.output, /EK3897/)
      }
    }
  }
  // Visibility is independent of whether a printed suggestion affects status.
  for (const ignore of [false, true]) {
    const r = invoke({ compilerOptions: { ...options, noEmit: true, plugins: [{
      name: "@effect/language-service", diagnosticSeverity: { promiseInEffectSuccess: "suggestion" },
      includeSuggestionsInTsc: false, ignoreEffectSuggestionsInTscExitCode: ignore
    }] }, files: ["main.ts"] }, warning)
    assert.equal(r.status, 0, r.output)
    assert.doesNotMatch(r.output, /EK3897/)
  }
  // Own configurable warnings keep their distinct compiler/lint policy.
  for (const severity of ["warning", "error"]) {
    const config = { compilerOptions: { ...options, lib: ["ESNext", "DOM"], noEmitOnError: true },
      files: ["main.vibe"], vibe: { severities: { EK4609: severity } } }
    for (const command of [[], ["lint"]]) {
      const r = invoke(config, 'import type { Fiber } from "effect"\nexport async function wait(fiber: Fiber.Fiber<number>) { return await fiber }\n', command)
      assert.equal(r.status === 0, severity === "warning", r.output)
      assert.match(r.output, /EK4609/)
      if (!command.length) assert.equal(r.emitted, severity === "warning", r.output)
    }
  }
  for (const severity of ["warning", "error"]) {
    for (const ignore of [false, true]) {
      const r = invoke({ compilerOptions: { ...options, plugins: [{
        name: "@effect/language-service", diagnosticSeverity: { promiseInEffectSuccess: severity },
        ignoreEffectErrorsInTscExitCode: ignore, ignoreEffectWarningsInTscExitCode: ignore
      }] }, files: ["main.ts"] }, warning, ["lint"])
      assert.equal(r.status, severity === "warning" ? 0 : 1, r.output)
      assert.match(r.output, /EK3897/)
    }
  }
  for (const visible of [false, true]) {
    const r = invoke({ compilerOptions: { ...options, plugins: [{
      name: "@effect/language-service", diagnosticSeverity: { promiseInEffectSuccess: "suggestion" },
      includeSuggestionsInTsc: visible, ignoreEffectSuggestionsInTscExitCode: false
    }] }, files: ["main.ts"] }, warning, ["lint"])
    assert.equal(r.status, 0, r.output)
    assert.equal(r.output.includes("EK3897"), visible, r.output)
  }
} finally { rmSync(root, { recursive: true, force: true }) }
assert.equal(checks, 36)
console.log("imported Effect exit policy: 36 checks passed")
