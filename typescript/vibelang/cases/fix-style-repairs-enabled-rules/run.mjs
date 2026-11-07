// run-seconds: 120
// Chapter 7: ordinary --fix applies the style repairs wherever the program
// reports them, at any severity, and nowhere else; the migration scopes never
// apply them; a repair keeps the declaration and every comment.
// rule-evidence: docs/design/src/007-tooling.md#effects-type-aware-lint | Ordinary `--fix` applies the repairs of `unnecessaryArrowBlock`, `unnecessaryPipe` and `unnecessaryPipeChain` (`EK4823`, `EK4824` and `EK4825`, reported as `EK38123`, `EK38126` and `EK38127` when `vibe.severities` names those codes) wherever the program reports them, so only where the project or a diagnostics comment turns the rule on, at any severity.
// rule-evidence: docs/design/src/007-tooling.md#effects-type-aware-lint | Where the rule is off, these repairs do not run.
// rule-evidence: docs/design/src/007-tooling.md#effects-type-aware-lint | They change only how the code is written, never what it does or its declaration, and a repair that would drop a comment is not offered.
// rule-evidence: docs/design/src/007-tooling.md#effects-type-aware-lint | `--fix-migration-only` and `--fix-vip-only` do not apply them.
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

const binary = process.env.VIBELANG_BINARY
assert.ok(binary, "VIBELANG_BINARY must name the tested compiler")
const local = fileURLToPath(new URL(".", import.meta.url))
const root = realpathSync(mkdtempSync(join(tmpdir(), "fix-style-repairs-")))
const source = [
  "export const make = effect (value: number) => { return { value }; }",
  "export const inc = (n: number) => { return n + 1 }",
  "export const empty = Effect.succeed(1).pipe()",
  "export const bare = pipe(Effect.succeed(1))",
  "export const chain = pipe(pipe(Effect.succeed(1), Effect.map((n: number) => n + 1)), Effect.map((n: number) => n * 2))",
  "export const noted = pipe(pipe(Effect.succeed(1), /* first */ Effect.map((n: number) => n + 1)), Effect.map((n: number) => n * 2))",
  "",
].join("\n")
const repaired = [
  "export const make = effect (value: number) => ({ value })",
  "export const inc = (n: number) => n + 1",
  "export const empty = Effect.succeed(1)",
  "export const bare = Effect.succeed(1)",
  "export const chain = pipe(Effect.succeed(1), Effect.map((n: number) => n + 1), Effect.map((n: number) => n * 2))",
  "export const noted = pipe(pipe(Effect.succeed(1), /* first */ Effect.map((n: number) => n + 1)), Effect.map((n: number) => n * 2))",
  "",
].join("\n")
const codes = { EK38123: "unnecessaryArrowBlock", EK38126: "unnecessaryPipe", EK38127: "unnecessaryPipeChain" }
let checks = 0
try {
  mkdirSync(join(root, "node_modules"))
  for (const name of ["effect", "vibelang-runtime"]) {
    if (existsSync(join(local, "node_modules", name))) symlinkSync(realpathSync(join(local, "node_modules", name)), join(root, "node_modules", name))
  }
  writeFileSync(join(root, "package.json"), '{"type":"module"}')
  const read = name => readFileSync(join(root, name), "utf8")
  const run = args => {
    const r = spawnSync(binary, [...args, "-p", ".", "--pretty", "false"], { cwd: root, encoding: "utf8", timeout: 60000 })
    assert.ifError(r.error)
    assert.equal(r.signal, null, r.stdout + r.stderr)
    checks++
    return { status: r.status, output: r.stdout + r.stderr }
  }
  const project = (severity, byComment) => {
    rmSync(join(root, "out"), { recursive: true, force: true })
    const severities = byComment ? "" : ', "vibe": { "severities": { ' + Object.keys(codes).map(code => '"' + code + '": "' + severity + '"').join(", ") + " } }"
    writeFileSync(join(root, "tsconfig.json"), '{ "compilerOptions": { "target": "ES2022", "module": "NodeNext", "strict": true, "skipLibCheck": true, "types": [], ' +
      '"declaration": true, "outDir": "out", "plugins": [{ "name": "@effect/language-service" }] }' + severities + ', "files": ["main.vibe"] }\n')
    const header = byComment ? "// @vibelang-diagnostics EK4823:" + severity + " EK4824:" + severity + " EK4825:" + severity + "\n" : ""
    writeFileSync(join(root, "main.vibe"), header + source)
    return header
  }
  const declaration = () => {
    rmSync(join(root, "out"), { recursive: true, force: true })
    const r = run([])
    return { status: r.status, output: r.output, text: existsSync(join(root, "out/main.d.ts")) ? read("out/main.d.ts") : null }
  }
  for (const severity of ["error", "warning", "suggestion", "off"]) {
    // A diagnostics comment sets EK48xx to error, warning or off only.
    for (const byComment of severity === "suggestion" ? [false] : [false, true]) {
      const label = JSON.stringify({ severity, byComment })
      const header = project(severity, byComment)
      const before = declaration()
      assert.notEqual(before.text, null, label + "\n" + before.output)
      const reports = (before.output.match(/(EK4823|EK4824|EK4825|EK38123|EK38126|EK38127):/g) ?? []).length
      assert.equal(reports > 0, severity !== "off", label + "\n" + before.output)
      run(["--fix"])
      if (severity === "off") {
        assert.equal(read("main.vibe"), header + source, label)
        continue
      }
      assert.equal(read("main.vibe"), header + repaired, label)
      const after = declaration()
      // Only the commented chain, whose repair would drop /* first */, still
      // reports, and the repairs add no other diagnostic.
      const lines = after.output.split("\n").filter(line => /\b(?:EK|TS)\d+:/.test(line))
      const noted = header === "" ? 6 : 7
      assert.deepEqual(lines.map(line => /^main\.vibe\((\d+),\d+\): \w+ (EK48\d\d|EK381\d\d):/.exec(line)?.[1]), [String(noted)], label + "\n" + after.output)
      assert.equal(after.text, before.text, label)
    }
  }
  for (const scope of ["--fix-migration-only", "--fix-vip-only"]) {
    const header = project("error", false)
    run(["--fix", scope])
    const text = read("main.vibe")
    for (const kept of ["{ return { value }; }", "{ return n + 1 }", ".pipe()", "pipe(Effect.succeed(1))\n", "pipe(pipe(Effect.succeed(1), Effect.map("]) {
      assert.ok(text.includes(kept), scope + " rewrote " + kept + "\n" + text)
    }
    assert.equal(header, "")
  }
} finally { rmSync(root, { recursive: true, force: true }) }
assert.equal(checks, 21)
console.log("Style repairs under --fix: 21 checks passed")
