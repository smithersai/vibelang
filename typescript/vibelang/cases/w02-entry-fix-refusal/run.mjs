// rule-evidence: docs/design/src/007-tooling.md#legacy-entry-dispatch-migration | Refuse an unavailable runner or layer, an entry test not expressible in admitted source, or any other loss of types, behavior or declarations: keep the marker and report its file, line and reason as not fixed, with a nonzero exit.
// rule-evidence: docs/design/src/007-tooling.md#legacy-entry-dispatch-migration | No retired dispatcher or fallback runner is a migration target.
// rule-evidence: docs/design/src/007-tooling.md#legacy-entry-dispatch-migration | A remaining marker keeps `EK2601`; `main` alone is ordinary source, gets no entry diagnostic and causes no implicit startup ([VIP-26](../vips/0026-top-level-and-main.md#decision), [VIP-34](../vips/0034-compiler-and-tooling.md#decision)).
// In a project where neither platform package is installed, vibelang --fix
// refuses both eligible startups: it exits nonzero, names each file and the
// marker's line as not fixed, leaves each source byte for byte, and the
// remaining markers still report EK2601.
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
const message = "legacy platform entry marker: run vibelang --fix and write an explicit runner"
const names = ["node", "browser"]
const root = mkdtempSync(join(tmpdir(), "entry-fix-refusal-"))
try {
  symlinkSync(join(here, "node_modules"), join(root, "node_modules"), "dir")
  writeFileSync(join(root, "package.json"), '{"type":"module"}\n')
  for (const name of names) writeFileSync(join(root, `${name}.vibe`), input(name))
  writeFileSync(join(root, "tsconfig.json"), JSON.stringify({
    compilerOptions: { target: "es2022", lib: ["esnext", "dom"], module: "nodenext", moduleResolution: "nodenext", strict: true, types: [], skipLibCheck: true, outDir: "out" },
    files: names.map((name) => `${name}.vibe`)
  }))
  const fixed = tsc(root, ["--fix"])
  const report = fixed.stdout + fixed.stderr
  assert.notEqual(fixed.status, 0, `a refused migration exits nonzero\n${report}`)
  for (const name of names) {
    assert.match(report, new RegExp(`\\b${name}\\.vibe:1:.*not fixed: \\S`), `${name}.vibe: the refusal names the file, the marker's line and a reason\n${report}`)
    assert.equal(readFileSync(join(root, `${name}.vibe`), "utf8"), input(name), `${name}.vibe: a refused migration keeps the source`)
  }
  const compiled = tsc(root, [])
  const output = compiled.stdout + compiled.stderr
  for (const name of names) {
    assert.ok(output.split("\n").some((line) => line.startsWith(`${name}.vibe(1,`) && line.endsWith(`: error EK2601: ${message}`)), `${name}.vibe: the remaining marker reports EK2601\n${output}`)
  }
  assert.notEqual(compiled.status, 0, output)
  console.log("unavailable runners refuse the migration; the markers still report EK2601")
} finally {
  rmSync(root, { recursive: true, force: true })
}
