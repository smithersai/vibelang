import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"
import fc from "fast-check"
import { parseDiagnostics } from "../agents.mjs"

const cli = fileURLToPath(new URL("../bin/vibelang", import.meta.url))
const native = process.env.VIBELANG_BINARY || fileURLToPath(new URL("../native/vibelang", import.meta.url))
const effect = fileURLToPath(new URL("../../../experiments/node_modules/effect", import.meta.url))
const runtime = fileURLToPath(new URL("../../runtime", import.meta.url))

function project(t) {
  const root = mkdtempSync(join(tmpdir(), "vibelang-agents-suggestions-"))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  writeFileSync(join(root, "package.json"), '{"name":"suggestion-test","type":"module"}')
  writeFileSync(join(root, "tsconfig.json"), JSON.stringify({ files: ["witness.vibe"] }))
  writeFileSync(join(root, "witness.vibe"), "export const n = 1\n")
  return root
}

function run(root, binary, command) {
  return spawnSync(process.execPath, [cli, "agents", command, ...(command === "check" ? ["witness.vibe"] : [])], {
    cwd: root, encoding: "utf8", timeout: 10000,
    env: { ...process.env, VIBELANG_BINARY: binary },
    input: JSON.stringify({ cwd: root, tool_input: { file_path: "witness.vibe" } })
  })
}

test("chapter 7 requires included suggestions to print", () => {
  const chapter = readFileSync(new URL("../../../docs/design/src/007-tooling.md", import.meta.url), "utf8")
  assert.ok(chapter.includes("Suggestions print when " + String.fromCharCode(96) + "includeSuggestionsInTsc" + String.fromCharCode(96) + " is " + String.fromCharCode(96) + "true"))
})

test("the diagnostic parser retains suggestion codes and continuation lines", () => {
  assert.deepEqual(parseDiagnostics("witness.vibe(2,3): suggestion EK3801: Use this Effect.\n  Keep the explanation.\n", "/project"), [
    { file: "/project/witness.vibe", line: 2, column: 3, severity: "suggestion", code: "EK3801", message: "Use this Effect.\n  Keep the explanation." }
  ])
})

test("an error and suggestion retain separate continuation messages", () => {
  const parsed = parseDiagnostics("witness.vibe(1,1): error TS2322: Wrong type.\n  Error detail.\nwitness.vibe(2,1): suggestion EK3801: Run this.\n  Suggestion detail.\n", "/project")
  assert.equal(parsed.length, 2)
  assert.equal(parsed[0].message, "Wrong type.\n  Error detail.")
  assert.equal(parsed[1].message, "Run this.\n  Suggestion detail.")
  assert.deepEqual(parsed.map((d) => [d.severity, d.code]), [["error", "TS2322"], ["suggestion", "EK3801"]])
})

test("checks and hooks show suggestions without failing a completed check", (t) => {
  const root = project(t)
  const binary = join(root, "compiler.cjs")
  writeFileSync(binary, "#!" + process.execPath + '\nconsole.log("witness.vibe(1,1): suggestion EK3801: Run or return this Effect.\\n  Keep this explanation.")\n')
  chmodSync(binary, 0o755)
  for (const command of ["check", "hook"]) {
    const result = run(root, binary, command)
    assert.equal(result.status, 0, result.stdout + result.stderr)
    assert.equal(result.stderr, "")
    const text = command === "hook" ? JSON.parse(result.stdout).hookSpecificOutput.additionalContext : result.stdout
    assert.match(text, /suggestion EK3801: Run or return this Effect\./)
    assert.match(text, /Keep this explanation/)
    assert.doesNotMatch(text, /no errors|error left|errors in other/)
  }
})

test("diagnostic categories and locations survive generated suggestion messages", () => {
  fc.assert(fc.property(
    fc.integer({ min: 1, max: 500 }), fc.integer({ min: 1, max: 200 }),
    fc.constantFrom("EK3801", "EK38100", "TS6133"),
    fc.array(fc.constantFrom("a", " ", "é", ":", "'"), { minLength: 1, maxLength: 40 }),
    (line, column, code, letters) => {
      const message = letters.join("")
      const parsed = parseDiagnostics("witness.vibe(" + line + "," + column + "): suggestion " + code + ": " + message + "\n  detail\n", "/project")
      assert.deepEqual(parsed, [{ file: "/project/witness.vibe", line, column, severity: "suggestion", code, message: message + "\n  detail" }])
    }
  ), { seed: 38, numRuns: 64 })
})

test("native imported suggestions reach the agent check and hook", {
  skip: (!existsSync(native) || !existsSync(effect)) && "build the native compiler and install the pinned Effect first"
}, (t) => {
  const root = project(t)
  mkdirSync(join(root, "node_modules"))
  symlinkSync(effect, join(root, "node_modules/effect"), "dir")
  symlinkSync(runtime, join(root, "node_modules/vibelang-runtime"), "dir")
  writeFileSync(join(root, "witness.vibe"), 'import { Effect } from "effect"\nexport function witness() { Effect.succeed(1); return 0 }\n')
  for (const include of [true, false]) {
    for (const ignored of [true, false]) {
      writeFileSync(join(root, "tsconfig.json"), JSON.stringify({
        compilerOptions: {
          target: "ES2022", module: "NodeNext", moduleResolution: "NodeNext", strict: true, types: [], skipLibCheck: true,
          plugins: [{
            name: "@effect/language-service", diagnosticSeverity: { floatingEffect: "suggestion" },
            includeSuggestionsInTsc: include, ignoreEffectSuggestionsInTscExitCode: ignored
          }]
        }, files: ["witness.vibe"]
      }))
      const direct = spawnSync(native, ["-p", root, "--noEmit", "--pretty", "false"], { cwd: root, encoding: "utf8", timeout: 10000 })
      assert.equal(direct.error, undefined)
      assert.notEqual(direct.status, null)
      if (include) assert.match(direct.stdout, /suggestion EK3801:/)
      else assert.doesNotMatch(direct.stdout, /suggestion EK3801:/)
      t.diagnostic("native suggestion options include=" + include + " ignored=" + ignored + " status=" + direct.status)
      for (const command of ["check", "hook"]) {
        const result = run(root, native, command)
        assert.equal(result.status, direct.status === 0 ? 0 : command === "hook" ? 2 : 1, result.stdout + result.stderr)
        const text = command !== "hook" ? result.stdout : result.status === 2 ? result.stderr : result.stdout ? JSON.parse(result.stdout).hookSpecificOutput.additionalContext : ""
        if (include) assert.match(text, /suggestion EK3801:/)
        else assert.doesNotMatch(text, /suggestion EK3801:/)
      }
    }
  }
})
