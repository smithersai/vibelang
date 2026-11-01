import { strict as assert } from "node:assert"
import { spawnSync } from "node:child_process"
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import fc from "fast-check"

const launcher = fileURLToPath(new URL("../bin/vibelang", import.meta.url))
const corpus = JSON.parse(readFileSync(new URL("./corpus/foldkit-agents-child-status.json", import.meta.url), "utf8"))

function project(t) {
  const root = mkdtempSync(join(tmpdir(), "vibelang-agents-outcomes-"))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  writeFileSync(join(root, "tsconfig.json"), JSON.stringify({ files: ["witness.vibe", "other.vibe"] }))
  writeFileSync(join(root, "witness.vibe"), "export const value = 1\n")
  writeFileSync(join(root, "other.vibe"), 'export const other: number = "bad"\n')
  return root
}

function run(root, outcome, command) {
  const binary = join(root, "compiler.cjs")
  writeFileSync(binary, `#!${process.execPath}
const o = ${JSON.stringify(outcome)}
if (o.diagnostic) (o.diagnosticStream === "stderr" ? console.error : console.log)(o.diagnostic)
process.stderr.write(o.stderr)
if (o.kind === "signal") process.kill(process.pid, o.signal)
else process.exit(o.status)
`)
  chmodSync(binary, outcome.kind === "denied" ? 0o644 : 0o755)
  return spawnSync(process.execPath, [launcher, "agents", command, ...(command === "check" ? ["witness.vibe"] : [])], {
    cwd: root, encoding: "utf8",
    env: { ...process.env, VIBELANG_BINARY: outcome.kind === "missing" ? join(root, "absent-compiler") : binary },
    input: JSON.stringify({ cwd: root, hook_event_name: "PostToolUse", tool_input: { file_path: join(root, "witness.vibe") } })
  })
}

function verify(root, outcome, command) {
  const result = run(root, outcome, command)
  const childFailed = outcome.kind !== "exit" || outcome.status !== 0
  const failed = outcome.kind !== "exit" || outcome.status !== 0 || /: error /.test(outcome.diagnostic ?? "")
  const text = result.stdout + result.stderr
  assert.equal(result.error, undefined)
  assert.equal(result.signal, null, text)
  assert.equal(result.status, failed ? (command === "hook" ? 2 : 1) : 0, text)
  if (failed) assert.doesNotMatch(text, /vibelang: no errors\./)
  if (outcome.kind === "exit" && outcome.status !== 0) assert.match(text, new RegExp(`compiler exited with status ${outcome.status}`))
  if (outcome.kind === "signal") assert.ok(text.includes(`compiler terminated by ${outcome.signal}`), text)
  if (outcome.kind === "missing") assert.match(text, /ENOENT/)
  if (outcome.kind === "denied") assert.match(text, /EACCES/)
  if (childFailed && outcome.kind !== "missing" && outcome.kind !== "denied" && outcome.stderr) assert.ok(text.includes(outcome.stderr), text)
  if (outcome.diagnostic && !["missing", "denied"].includes(outcome.kind)) {
    assert.match(text, outcome.diagnostic.startsWith("other.vibe") ? /1 error in other files/ : /TS2322|TS6133/)
  }
  if (!failed && !outcome.stderr && !outcome.diagnostic && command === "check") assert.match(text, /vibelang: no errors\./)
}

for (const outcome of corpus) {
  test(`agents child outcome: ${outcome.name}`, (t) => {
    const root = project(t)
    for (const command of ["check", "hook"]) verify(root, outcome, command)
  })
}

// foldkit-110's independent oracle: an unsuccessful child cannot certify a
// completed check, regardless of whether its output contains a diagnostic.
// Vary the actual child process, not a mock of the result classifier.
test("agents child outcomes property (foldkit-110)", (t) => {
  const root = project(t)
  const child = fc.oneof(
    fc.record({ kind: fc.constant("exit"), status: fc.oneof(fc.constantFrom(0, 1, 2, 255), fc.integer({ min: 0, max: 255 })) }),
    fc.record({ kind: fc.constant("signal"), signal: fc.constantFrom("SIGTERM", "SIGKILL", "SIGINT") }),
    fc.record({ kind: fc.constantFrom("missing", "denied") })
  )
  fc.assert(fc.property(child, fc.string({ maxLength: 60 }), fc.constantFrom("", "selected-error", "other-error", "warning"), fc.constantFrom("stdout", "stderr"), (child, stderr, diagnostic, diagnosticStream) => {
    const line = diagnostic === "" ? "" : `${diagnostic === "other-error" ? "other" : "witness"}.vibe(1,14): ${diagnostic === "warning" ? "warning TS6133" : "error TS2322"}: outcome diagnostic`
    const outcome = { ...child, diagnosticStream, stderr: `compiler stderr: ${stderr}\n`, diagnostic: line }
    for (const command of ["check", "hook"]) verify(root, outcome, command)
  }), { seed: 110, numRuns: 100 })
})

test("a successful project cannot mask another project's failed compiler", (t) => {
  const root = project(t)
  const other = project(t)
  const binary = join(root, "multi-compiler.cjs")
  writeFileSync(binary, `#!${process.execPath}
if (process.argv.includes(${JSON.stringify(join(root, "tsconfig.json"))})) {
  console.error("first project did not complete")
  process.exit(2)
}
`)
  chmodSync(binary, 0o755)
  for (const files of [
    [join(root, "witness.vibe"), join(other, "witness.vibe")],
    [join(other, "witness.vibe"), join(root, "witness.vibe")]
  ]) {
    const result = spawnSync(process.execPath, [launcher, "agents", "check", ...files], {
      cwd: root, encoding: "utf8", env: { ...process.env, VIBELANG_BINARY: binary }
    })
    assert.equal(result.status, 1, result.stdout + result.stderr)
    assert.match(result.stdout, /compiler exited with status 2/)
    assert.match(result.stdout, /first project did not complete/)
    assert.doesNotMatch(result.stdout, /vibelang: no errors\./)
  }
})
