import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { chmodSync, existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"
import fc from "fast-check"
import { parseDiagnostics } from "../agents.mjs"

const launcher = fileURLToPath(new URL("../bin/vibelang", import.meta.url))
const native = process.env.VIBELANG_BINARY || fileURLToPath(new URL("../native/vibelang", import.meta.url))
const skipNative = !existsSync(native) && "build the native compiler before running the project diagnostic controls"

function fixture(t, config = { files: ["witness.vibe"] }) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "vibelang-agents-project-diagnostics-")))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  writeFileSync(join(root, "tsconfig.json"), JSON.stringify(config))
  writeFileSync(join(root, "witness.vibe"), "export const value = 1\n")
  return root
}

function run(root, binary, command) {
  return spawnSync(process.execPath, [launcher, "agents", command, ...(command === "check" ? ["witness.vibe"] : [])], {
    cwd: root, encoding: "utf8", timeout: 30000,
    env: { ...process.env, VIBELANG_BINARY: binary },
    input: JSON.stringify({ cwd: root, hook_event_name: "PostToolUse", tool_input: { file_path: "witness.vibe" } })
  })
}

function compiler(root, output, status) {
  const binary = join(root, "compiler.cjs")
  writeFileSync(binary, "#!" + process.execPath + "\nprocess.stdout.write(" + JSON.stringify(output) + "); process.exit(" + status + ")\n")
  chmodSync(binary, 0o755)
  return binary
}

function text(result, command, failure) {
  assert.equal(result.error, undefined)
  assert.equal(result.signal, null)
  assert.equal(result.status, failure ? command === "hook" ? 2 : 1 : 0, result.stdout + result.stderr)
  if (command === "hook" && !failure) {
    assert.equal(result.stderr, "")
    return JSON.parse(result.stdout).hookSpecificOutput.additionalContext
  }
  if (command === "hook") assert.equal(result.stdout, "")
  return result.stdout + result.stderr
}

test("project diagnostic oracle follows the actionable-message requirement", () => {
  const vip = readFileSync(new URL("../../../docs/design/vips/0034-compiler-and-tooling.md", import.meta.url), "utf8")
  assert.ok(vip.includes("a message in the user's words that says what is wrong and how to fix it"))
})

test("diagnostic parsing retains locationless messages and their continuation lines", () => {
  const diagnostics = parseDiagnostics("error TS18003: No inputs were found.\n  Check the include paths.\nwitness.vibe(2,3): error TS2322: Wrong type.\nwarning EK0801: Resource warning.\n", ".")
  assert.equal(diagnostics.length, 3)
  assert.equal(diagnostics[0].file, undefined)
  assert.deepEqual([diagnostics[0].severity, diagnostics[0].code, diagnostics[0].message], ["error", "TS18003", "No inputs were found.\n  Check the include paths."])
  assert.equal(diagnostics[1].line, 2)
  assert.equal(diagnostics[1].column, 3)
  assert.equal(diagnostics[1].code, "TS2322")
  assert.equal(diagnostics[2].severity, "warning")
})

for (const command of ["check", "hook"]) {
  test("agents " + command + " prints the native no-input project diagnostic", { skip: skipNative }, (t) => {
    const root = fixture(t, { include: ["absent/**/*.vibe"] })
    const direct = spawnSync(native, ["-p", "tsconfig.json", "--noEmit", "--pretty", "false"], { cwd: root, encoding: "utf8", timeout: 30000 })
    assert.notEqual(direct.status, 0, direct.stdout + direct.stderr)
    assert.match(direct.stdout, /^error TS18003: No inputs were found/m)
    const report = text(run(root, native, command), command, true)
    assert.match(report, /error TS18003: No inputs were found/)
    assert.match(report, /absent/)
    assert.match(report, /compiler exited with status/)
  })
}

test("project diagnostics preserve selected-source diagnostics and error counts", (t) => {
  const root = fixture(t)
  const binary = compiler(root, "error TS5074: Incremental needs an output path.\n  Set tsBuildInfoFile.\nwitness.vibe(1,14): error TS2322: Wrong type.\n", 2)
  for (const command of ["check", "hook"]) {
    const report = text(run(root, binary, command), command, true)
    assert.match(report, /error TS5074: Incremental needs an output path\.\n  Set tsBuildInfoFile\./)
    assert.match(report, /witness\.vibe\(1,14\): error TS2322: Wrong type\./)
    assert.match(report, /1 error left in the files you edited/)
    assert.doesNotMatch(report, /error in other files|2 errors left/)
  }
})

test("locationless diagnostic codes, severities and multiline messages survive child output", (t) => {
  const root = fixture(t)
  fc.assert(fc.property(
    fc.constantFrom("error", "warning", "message"), fc.constantFrom("TS18003", "TS5074", "EK0801"),
    fc.array(fc.constantFrom("a", "z", " ", "é", "界", ":", "."), { minLength: 1, maxLength: 30 }), fc.boolean(),
    (severity, code, letters, continued) => {
      const message = "Project diagnostic: " + letters.join("") + (continued ? "\n  Action: select the project inputs." : "")
      const diagnostic = severity + " " + code + ": " + message
      const failure = severity === "error"
      const binary = compiler(root, diagnostic + "\n", failure ? 2 : 0)
      for (const command of ["check", "hook"]) {
        const report = text(run(root, binary, command), command, failure)
        assert.ok(report.includes(diagnostic), report)
        assert.doesNotMatch(report, /vibelang: no errors\./)
      }
    }
  ), { seed: 3418003, numRuns: 48 })
})
