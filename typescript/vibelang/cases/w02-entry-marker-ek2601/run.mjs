// run-seconds: 120
// rule-evidence: docs/design/src/007-tooling.md#legacy-entry-dispatch-migration | `EK2601` rejects the retired side-effect markers `vibelang/platform/node`, `vibelang/platform/bun` and `vibelang/platform/browser`, even without `main`: `legacy platform entry marker: run vibelang --fix and write an explicit runner`.
// rule-evidence: docs/design/src/007-tooling.md#legacy-entry-dispatch-migration | A remaining marker keeps `EK2601`; `main` alone is ordinary source, gets no entry diagnostic and causes no implicit startup ([VIP-26](../vips/0026-top-level-and-main.md#decision), [VIP-34](../vips/0034-compiler-and-tooling.md#decision)).
// Each marker module reports one EK2601, with the rule's message, on the
// marker's line; the module with an unmarked exported main reports nothing.
import assert from "node:assert/strict"
import { mkdtempSync, readFileSync, writeFileSync, symlinkSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { spawnSync } from "node:child_process"

const binary = process.env.VIBELANG_BINARY
assert.ok(binary, "the harness supplies its built compiler")
const message = "legacy platform entry marker: run vibelang --fix and write an explicit runner"
const files = ["node", "bun", "browser", "ordinary"]
const root = mkdtempSync(join(tmpdir(), "entry-marker-"))
try {
  symlinkSync(fileURLToPath(new URL("./node_modules", import.meta.url)), join(root, "node_modules"), "dir")
  writeFileSync(join(root, "package.json"), '{"type":"module"}\n')
  for (const name of files) writeFileSync(join(root, `${name}.vibe`), readFileSync(new URL(`./inputs/${name}.txt`, import.meta.url)))
  writeFileSync(join(root, "tsconfig.json"), JSON.stringify({
    compilerOptions: { target: "es2022", lib: ["esnext", "dom"], module: "nodenext", moduleResolution: "nodenext", strict: true, types: [], skipLibCheck: true, outDir: "out" },
    files: files.map((name) => `${name}.vibe`)
  }))
  const compiled = spawnSync(binary, ["-p", "tsconfig.json", "--pretty", "false", "--singleThreaded"], { cwd: root, encoding: "utf8", timeout: 120000 })
  const output = compiled.stdout + compiled.stderr
  const diagnostics = output.split("\n").map((line) => /^(\S+?)\((\d+),(\d+)\): (error|warning) (\w+): (.*)$/.exec(line)).filter(Boolean)
  for (const name of ["node", "bun", "browser"]) {
    const own = diagnostics.filter((d) => d[1] === `${name}.vibe`)
    assert.deepEqual(own.map((d) => [d[2], d[4], d[5], d[6]]), [["1", "error", "EK2601", message]], `${name}.vibe: one EK2601 at the marker\n${output}`)
  }
  assert.deepEqual(diagnostics.filter((d) => d[1] === "ordinary.vibe").map((d) => d[0]), [], `an unmarked main gets no entry diagnostic\n${output}`)
  assert.notEqual(compiled.status, 0, "an EK2601 error fails the compilation")
  console.log("each marker reports EK2601; an unmarked main reports nothing")
} finally {
  rmSync(root, { recursive: true, force: true })
}
