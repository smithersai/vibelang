import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, statSync, utimesSync, writeFileSync } from "node:fs"
import { fileURLToPath, pathToFileURL } from "node:url"
import path from "node:path"

const dir = path.dirname(fileURLToPath(import.meta.url))
const compiler = path.resolve(dir, "../../../built/local/tsc")
assert.ok(existsSync(path.join(dir, "out/main.js")), "the warning-only case must emit JavaScript")
// Keep the original unannotated Smithers repro as well as the explicitly
// plain contracts in plain-catch-exceptions (the projector requires those).
// Its try statement is JavaScript's (detail 205), so the catch receives the
// coercion exception.
const repro = `export const f = (x: unknown): string => {
  try {
    return String(x)
  } catch {
    return ""
  }
}
`
const base = JSON.parse(readFileSync(path.join(dir, "tsconfig.json"), "utf8"))
let checks = 0
for (const mode of ["-p", "-b"]) {
  for (const severity of ["warning", "error", "mixed"]) {
    const fixture = path.join(dir, "out", `${mode.slice(1)}-${severity}`)
    mkdirSync(fixture, { recursive: true })
    const config = structuredClone(base)
    config.include = ["main.vibe"]
    config.compilerOptions.outDir = "js"
    config.compilerOptions.vibelang.diagnostics.EK4403 = severity === "error" ? "error" : "warning"
    writeFileSync(path.join(fixture, "tsconfig.json"), JSON.stringify(config))
    writeFileSync(path.join(fixture, "main.vibe"), `${repro}export const clock = performance.now()\n${severity === "mixed" ? 'export const wrong: number = "bad"' : ""}\n`)
    const compile = () => spawnSync(compiler, [mode, fixture, "--pretty", "false"], { encoding: "utf8" })
    const result = compile()
    const output = result.stdout + result.stderr
    assert.match(output, /EK4403/)
    const emitted = path.join(fixture, "js/main.js")
    if (severity === "warning") {
      assert.equal(result.status, 0, output)
      assert.ok(existsSync(emitted), `${mode}: a warning must permit emit`)
      const { f } = await import(pathToFileURL(emitted).href)
      const coercion = new TypeError("coercion")
      assert.equal(f({ [Symbol.toPrimitive]() { throw coercion } }), "", "a plain catch receives a JavaScript exception (detail 205)")
      assert.doesNotMatch(output, /EK9204/)
      if (mode === "-b") {
        // A rebuild with unchanged output must refresh its timestamp even
        // when it reports warnings (buildtask.go's noEmitOnError gate).
        const old = new Date(Date.now() - 60_000)
        utimesSync(emitted, old, old)
        const rebuilt = compile()
        assert.equal(rebuilt.status, 0, rebuilt.stdout + rebuilt.stderr)
        assert.ok(statSync(emitted).mtimeMs > old.getTime() + 1000, "warning-only build must update unchanged output timestamps")
      }
    } else {
      assert.notEqual(result.status, 0, output)
      assert.ok(!existsSync(emitted), `${mode}: an error must block all JavaScript emit`)
      if (severity === "mixed") assert.match(output, /TS2322/)
    }
    checks++
  }
}
console.log(`noEmitOnError: ${checks} project checks passed`)
