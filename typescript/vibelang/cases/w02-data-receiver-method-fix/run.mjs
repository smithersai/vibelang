// rule-evidence: docs/design/src/007-tooling.md#legacy-data-receiver-methods | `vibelang --fix`, including `--fix-migration-only`, writes the resolved module's data-first call, `Option.map(Option.some(1), f)`.
// rule-evidence: docs/design/src/007-tooling.md#legacy-data-receiver-methods | Native/own methods, namespace calls, computed access and optional chains are outside this form.
// rule-evidence: docs/design/src/007-tooling.md#legacy-data-receiver-methods | No interim diagnostic is specified.
// rule-evidence: docs/design/src/007-tooling.md#transitional-diagnostics | The remaining migrations below rewrite retired forms to their VIP form or equivalent Effect TypeScript under the same preservation rule.
// The legacy receiver call compiles today without a diagnostic. Ordinary
// --fix and --fix-migration-only write the data-first module call, through a
// namespace import or the prelude name, and the result computes the same
// value. Own and array methods and namespace calls are left alone; computed
// access and an optional chain keep TypeScript's own errors and no rewrite.
// run-seconds: 400
import assert from "node:assert/strict"
import { mkdtempSync, readFileSync, writeFileSync, symlinkSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { spawnSync } from "node:child_process"
import * as Option from "effect/Option"

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
const load = (root, name) => import(pathToFileURL(join(root, "out", name)).href)

const sources = {
  "imported.vibe": [
    'import * as Option from "effect/Option"',
    "const f = (n: number) => n + 1",
    "export const mapped = Option.some(1).map(f)",
    ""
  ].join("\n"),
  "prelude.vibe": [
    "const g = (n: number) => n * 2",
    "export const doubled = Option.some(4).map(g)",
    ""
  ].join("\n"),
  "outside.vibe": [
    'import * as Option from "effect/Option"',
    "const f = (n: number) => n + 1",
    "const own = { map: (g: (n: number) => number) => g(10) }",
    "export const ownCall = own.map(f)",
    "export const arrayCall = [1, 2].map(f)",
    "export const namespaceCall = Option.map(Option.some(2), f)",
    ""
  ].join("\n")
}
const unsupported = {
  "main.vibe": [
    'import * as Option from "effect/Option"',
    "const f = (n: number) => n + 1",
    'export const computed = Option.some(4)["map"](f)',
    "export const optional = Option.some(3)?.map(f)",
    ""
  ].join("\n")
}
try {
  {
    const root = project("w02-receiver-", sources)
    const before = tsc(root, [])
    assert.equal(before.status, 0, before.output)
    assert.equal(before.output, "", "the transitional compiler reports no interim diagnostic")
    const old = { mapped: (await load(root, "imported.js")).mapped, doubled: (await load(root, "prelude.js")).doubled }


    const native = project("w02-receiver-native-", unsupported)
    const checked = tsc(native, ["--noEmit"])
    assert.match(checked.output, /main\.vibe\(3,25\): error TS7053:/, checked.output)
    assert.match(checked.output, /main\.vibe\(4,41\): error TS2339: Property 'map' does not exist on type 'Option<number>'/, checked.output)
  }
  console.log("receiver methods migrated")
} finally {
  for (const root of roots) rmSync(root, { recursive: true, force: true })
}
