// rule-evidence: docs/design/src/007-tooling.md#transitional-diagnostics | The remaining migrations below rewrite retired forms to their VIP form or equivalent Effect TypeScript under the same preservation rule.
// rule-evidence: docs/design/src/007-tooling.md#transitional-diagnostics | The legacy `fork(program, options)` call becomes `try Effect.forkChild(program, options)`.
// Every --fix scope rewrites the legacy two-argument fork call to a run of
// Effect.forkChild with the same program and options; the result compiles
// cleanly and its fiber joins with the program's value.
// run-seconds: 400
import assert from "node:assert/strict"
import { mkdtempSync, readFileSync, writeFileSync, symlinkSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { spawnSync } from "node:child_process"
import * as Effect from "effect/Effect"

const binary = process.env.VIBELANG_BINARY
assert.ok(binary, "the harness supplies its built compiler")
const roots = []
// A fresh project holding files, with the case's effect and vibelang-runtime.
function project(prefix, files) {
  const root = mkdtempSync(join(tmpdir(), prefix))
  roots.push(root)
  symlinkSync(fileURLToPath(new URL("./node_modules", import.meta.url)), join(root, "node_modules"), "dir")
  writeFileSync(join(root, "package.json"), '{"type":"module"}\n')
  writeFileSync(join(root, "tsconfig.json"), JSON.stringify({
    compilerOptions: { target: "es2022", lib: ["esnext"], module: "nodenext", moduleResolution: "nodenext", strict: true, types: [], skipLibCheck: true, declaration: true, outDir: "out" },
    include: ["*.vibe"]
  }))
  for (const [name, text] of Object.entries(files)) writeFileSync(join(root, name), text)
  return root
}
function tsc(root, flags) {
  const r = spawnSync(binary, [...flags, "-p", "tsconfig.json", "--pretty", "false", "--singleThreaded"], { cwd: root, encoding: "utf8", timeout: 60000 })
  assert.equal(r.error, undefined, String(r.error))
  return { status: r.status, output: r.stdout + r.stderr }
}
const read = (root, name) => readFileSync(join(root, name), "utf8")

const source = [
  "const call = effect (n: number): number!! => n + 1",
  "export effect function main(): number!! {",
  "  const pending = fork(call(41), { startImmediately: true })",
  "  return join pending",
  "}",
  ""
].join("\n")
try {
  for (const flags of [["--fix"], ["--fix", "--fix-migration-only"], ["--fix-vip-only", "--fix"]]) {
    const root = project("w02-fork-call-", { "main.vibe": source })
    const before = tsc(root, ["--noEmit"])
    assert.notEqual(before.status, 0, "the legacy call is a retired form\n" + before.output)
    const fixed = tsc(root, flags)
    assert.equal(fixed.status, 0, flags.join(" ") + "\n" + fixed.output)
    const main = read(root, "main.vibe")
    assert.match(main, /^  const pending = try Effect\.forkChild\(call\(41\), \{ startImmediately: true \}\)$/m, flags.join(" ") + "\n" + main)
    assert.doesNotMatch(main, /\bfork\(/, main)
    const after = tsc(root, [])
    assert.equal(after.status, 0, after.output)
    assert.equal(after.output, "", "the rewrite compiles without diagnostics")
    const actual = await import(pathToFileURL(join(root, "out", "main.js")).href)
    assert.equal(await Effect.runPromise(actual.main()), 42)
  }
  console.log("legacy fork call migrated")
} finally {
  for (const root of roots) rmSync(root, { recursive: true, force: true })
}
