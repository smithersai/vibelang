import assert from "node:assert/strict"
import { mkdtempSync, readFileSync, writeFileSync, symlinkSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { spawnSync } from "node:child_process"
const binary = process.env.VIBELANG_BINARY
assert.ok(binary, "the harness supplies its built compiler")
const root = mkdtempSync(join(tmpdir(), "w02-prelude-native-"))
try {
  symlinkSync(fileURLToPath(new URL("./node_modules", import.meta.url)), join(root, "node_modules"), "dir")
  writeFileSync(join(root, "package.json"), '{"type":"module"}\n')
  writeFileSync(join(root, "written.vibe"), readFileSync(new URL("./written.txt", import.meta.url)))
  writeFileSync(join(root, "twin.ts"), readFileSync(new URL("./twin.txt", import.meta.url)))
  writeFileSync(join(root, "tsconfig.json"), JSON.stringify({
    compilerOptions: { target: "es2022", lib: ["esnext"], module: "nodenext", moduleResolution: "nodenext", strict: true, types: [], skipLibCheck: true, noEmit: true },
    files: ["written.vibe", "twin.ts"]
  }))
  const run = spawnSync(binary, ["-p", "tsconfig.json", "--pretty", "false"], { cwd: root, encoding: "utf8", timeout: 120000 })
  const diagnostics = run.stdout.split("\n").filter(line => /\): (error|warning) /.test(line))
  const sites = diagnostics.map(line => line.replace(/^(\S+\(\d+,\d+\): \w+ \w+): .*$/, "$1")).sort()
  assert.deepEqual(sites, [
    "twin.ts(3,27): error TS2709",
    "twin.ts(4,21): error TS2709",
    "twin.ts(5,32): error TS2339",
    "written.vibe(2,28): error TS2709",
  ], run.stdout + run.stderr)
  assert.ok(!/\bEK\d{4}\b/.test(run.stdout), "no EK code: " + run.stdout)
  assert.match(run.stdout, /twin\.ts\(4,21\): error TS2709: Cannot use namespace 'Option' as a type\./)
  assert.match(run.stdout, /written\.vibe\(2,28\): error TS2709: Cannot use namespace 'Scope' as a type\./)
  assert.match(run.stdout, /twin\.ts\(5,32\): error TS2339: Property 'of' does not exist on type/)
  assert.notEqual(run.status, 0)
  console.log("explicit namespace imports report native TS2709 and TS2339")
} finally {
  rmSync(root, { recursive: true, force: true })
}
