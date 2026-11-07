// rule-evidence: docs/design/src/007-tooling.md#legacy-entry-dispatch-migration | An eligible legacy startup is an exported, non-default, zero-parameter function declaration `main` with a body and no checker-resolved top-level runner call under the pinned legacy compiler and options.
// rule-evidence: docs/design/src/007-tooling.md#legacy-entry-dispatch-migration | Without eligible startup, remove only the inert marker and keep any explicit runner.
// vibelang --fix on marked modules without an eligible startup removes the
// marker line and changes nothing else: no runner is added, an existing
// runner is kept, and starting the module does what the remaining source
// says. A method of the program's own named runMain is not a runner, so its
// module's main is still eligible and gets a runner.
import assert from "node:assert/strict"
import { mkdtempSync, readFileSync, writeFileSync, symlinkSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { spawnSync } from "node:child_process"

const binary = process.env.VIBELANG_BINARY
assert.ok(binary, "the harness supplies its built compiler")
const here = fileURLToPath(new URL(".", import.meta.url))
const input = (name) => readFileSync(join(here, "inputs", `${name}.txt`), "utf8")
const tsc = (root, args) => spawnSync(binary, [...args, "-p", "tsconfig.json", "--pretty", "false", "--singleThreaded"], { cwd: root, encoding: "utf8", timeout: 120000 })
const marker = /^import\s*["']vibelang\/platform\/\w+["']\s*$/
const content = (text) => text.split("\n").filter((line) => line.trim() !== "")
// The inert modules, and what starting each prints after the migration.
const inert = {
  "runner-only": "runner-only program ran\n",
  "main-with-runner": "main-with-runner ran\n",
  unexported: "",
  default: "",
  parameter: "",
  arrow: "",
}
const names = [...Object.keys(inert), "local-runner"]
const root = mkdtempSync(join(tmpdir(), "entry-fix-inert-"))
try {
  symlinkSync(join(here, "node_modules"), join(root, "node_modules"), "dir")
  writeFileSync(join(root, "package.json"), '{"type":"module"}\n')
  for (const name of names) writeFileSync(join(root, `${name}.vibe`), input(name))
  writeFileSync(join(root, "tsconfig.json"), JSON.stringify({
    compilerOptions: { target: "es2022", lib: ["esnext"], module: "nodenext", moduleResolution: "nodenext", strict: true, types: [], skipLibCheck: true, outDir: "out" },
    files: names.map((name) => `${name}.vibe`)
  }))
  const fixed = tsc(root, ["--fix"])
  assert.equal(fixed.status, 0, `--fix removes inert markers\n${fixed.stdout}${fixed.stderr}`)
  const compiled = tsc(root, [])
  assert.equal(compiled.status, 0, `the migrated project compiles cleanly\n${compiled.stdout}${compiled.stderr}`)
  const start = (name) => {
    const started = spawnSync(process.execPath, [join(root, "out", `${name}.js`)], { cwd: root, encoding: "utf8", timeout: 60000 })
    assert.equal(started.status, 0, `${name}.js\n${started.stdout}${started.stderr}`)
    return started.stdout
  }
  for (const [name, stdout] of Object.entries(inert)) {
    const text = readFileSync(join(root, `${name}.vibe`), "utf8")
    assert.deepEqual(content(text), content(input(name)).filter((line) => !marker.test(line)), `${name}: only the inert marker is removed:\n${text}`)
    assert.equal(start(name), stdout, `${name}: starting the module`)
  }
  const text = readFileSync(join(root, "local-runner.vibe"), "utf8")
  assert.doesNotMatch(text, /vibelang\/platform/, text)
  assert.match(text, /NodeRuntime\.runMain\(main\(\)\)/, `a local runMain method is not a runner, so main is eligible:\n${text}`)
  assert.match(text, /helper\.runMain\(1\)/, text)
  assert.equal(start("local-runner"), "local-runner main ran\n")
  console.log("inert markers are removed alone; explicit runners are kept")
} finally {
  rmSync(root, { recursive: true, force: true })
}
