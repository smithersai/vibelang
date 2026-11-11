import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"
import fc from "fast-check"

const launcher = fileURLToPath(new URL("../bin/vibelang", import.meta.url))
const native = process.env.VIBELANG_BINARY || fileURLToPath(new URL("../native/vibelang", import.meta.url))
const skipNative = !existsSync(native) && "build the native compiler before running the project controls"

function fixture(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "vibelang-agents-no-project-")))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  // A repository boundary keeps the test independent of ambient parent configs.
  mkdirSync(join(root, ".jj"))
  return root
}

function put(root, name, text) {
  const path = join(root, name)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, text)
  return path
}

function run(root, command, files, binary = native) {
  return spawnSync(process.execPath, [launcher, "agents", command, ...(command === "check" ? files : [])], {
    cwd: root, encoding: "utf8", timeout: 30000,
    env: { ...process.env, VIBELANG_BINARY: binary },
    input: JSON.stringify({ cwd: root, hook_event_name: "PostToolUse", tool_input: {
      command: ["*** Begin Patch", ...files.map((file) => `*** Update File: ${file}`), "*** End Patch"].join("\n")
    } })
  })
}

function incomplete(result, command, file) {
  const text = result.stdout + result.stderr
  assert.equal(result.error, undefined)
  assert.equal(result.signal, null, text)
  assert.equal(result.status, command === "check" ? 1 : 2, text)
  assert.ok(text.includes(file), text)
  assert.match(text, /it was not checked/)
  assert.doesNotMatch(text, /vibelang: no errors\.|ENOENT|cannot run compiler/)
  if (command === "hook") assert.equal(result.stdout, "", text)
}

// Coding-agents contract: "a check after each edit that returns the errors
// to the agent". No project was compiled, so a skipped file cannot certify
// a completed check, even when the file itself exists.
for (const command of ["check", "hook"]) {
  test(`agents ${command} fails when an existing source has no project`, (t) => {
    const root = fixture(t)
    const source = "export const answer: number = \"wrong\"\n"
    put(root, "src/witness.vibe", source)
    incomplete(run(root, command, ["src/witness.vibe"], join(root, "unused-compiler")), command, "src/witness.vibe")
    assert.equal(readFileSync(join(root, "src/witness.vibe"), "utf8"), source)
    assert.equal(existsSync(join(root, "tsconfig.json")), false)
  })
}

test("agents check also fails for an unconfigured JSX source", (t) => {
  const root = fixture(t)
  put(root, "view.vibex", "export const view = <section />\n")
  incomplete(run(root, "check", ["view.vibex"], join(root, "unused-compiler")), "check", "view.vibex")
})

for (const broken of [false, true]) {
  test(`an unconfigured file fails beside a ${broken ? "broken" : "clean"} project in either order`, { skip: skipNative }, (t) => {
    const root = fixture(t)
    put(root, "app/tsconfig.json", JSON.stringify({ compilerOptions: { strict: true, noEmit: true, types: [], skipLibCheck: true }, vibe: { effectGlobals: false, effectModules: false }, files: ["selected.vibe"] }))
    put(root, "app/selected.vibe", broken ? "export const value: number = \"wrong\"\n" : "export const value: number = 1\n")
    put(root, "outside/witness.vibe", "export const value: number = \"wrong\"\n")
    const control = run(root, "check", ["app/selected.vibe"])
    assert.equal(control.status, broken ? 1 : 0, control.stdout + control.stderr)
    if (broken) assert.match(control.stdout, /TS2322/)
    else assert.match(control.stdout, /vibelang: no errors\./)
    for (const files of [["outside/witness.vibe", "app/selected.vibe"], ["app/selected.vibe", "outside/witness.vibe"]]) {
      for (const command of ["check", "hook"]) {
        const result = run(root, command, files)
        incomplete(result, command, "outside/witness.vibe")
        if (broken) assert.match(result.stdout + result.stderr, /TS2322/)
      }
    }
  })
}

test("missing-project status survives filename, nesting, ordering and boundary mutations", (t) => {
  const root = fixture(t)
  // The outer config must not be used across a nested repository boundary.
  put(root, "tsconfig.json", JSON.stringify({ files: [] }))
  fc.assert(fc.property(
    fc.array(fc.constantFrom("a", "z", " ", "é", "界", "-"), { minLength: 1, maxLength: 10 }),
    fc.integer({ min: 0, max: 3 }), fc.constantFrom(".jj", ".git"), fc.boolean(),
    (letters, depth, boundary, reverse) => {
      const isolated = join(root, "isolated")
      rmSync(isolated, { recursive: true, force: true })
      mkdirSync(join(isolated, boundary), { recursive: true })
      const nested = Array.from({ length: depth }, (_, i) => `level${i}`).join("/")
      const names = [join("isolated", nested, `${letters.join("")}.vibe`), join("isolated", "second.vibe")]
      for (const name of names) put(root, name, "export const value: number = \"wrong\"\n")
      if (reverse) names.reverse()
      for (const command of ["check", "hook"]) {
        const result = run(root, command, names, join(root, "unused-compiler"))
        for (const name of names) incomplete(result, command, name)
      }
    }
  ), { seed: 34030, numRuns: 48 })
})
