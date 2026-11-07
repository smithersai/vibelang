import assert from "node:assert/strict"
import { test } from "node:test"
import { spawnSync } from "node:child_process"
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import fc from "fast-check"

const runner = readFileSync(new URL("../../typescript/vibelang/cases/retirement-fixes-manifest-witnesses/run.mjs", import.meta.url), "utf8")
const input = "typescript/vibelang/cases/retirement-example.fail"
const output = "typescript/vibelang/cases/retirement-example-fixed"
function probe(extension, moduleName, subdirectory = "") {
  const root = mkdtempSync(join(tmpdir(), "retirement-sources-"))
  const put = (name, text = "") => {
    mkdirSync(dirname(join(root, name)), { recursive: true })
    writeFileSync(join(root, name), text)
  }
  try {
    const expected = []
    for (const directory of [input, output]) {
      for (const name of ["tsconfig.json", subdirectory + "main." + extension, subdirectory + "ambient.d.ts", "expected/main.d.ts"]) {
        const path = directory + "/" + name
        put(path, name.endsWith(".json") ? "{}" : "authored source or reference output")
        expected.push(path)
      }
      put(directory + "/" + subdirectory + "main.d." + extension + ".ts", "generated source sidecar")
      put(directory + "/" + subdirectory + "main." + extension + "." + moduleName + ".d.ts", "generated module sidecar")
      for (const name of ["out/generated.ts", "node_modules/pkg/index.ts", ".cache-build/generated.ts"])
        put(directory + "/" + name)
    }
    put("docs/design/retirement-fixes.json", JSON.stringify([{ code: "EK7777", cases: [{ input, output }] }]))
    put("docs/tools/retirement-gate.mjs",
      'import assert from "node:assert/strict"; export function verifyWitness(code, witness, snapshot) {' +
      "assert.deepEqual(snapshot.paths, " + JSON.stringify(expected.sort()) + ', "fixture source inventory " + JSON.stringify(snapshot.paths)) }')
    const entry = "typescript/vibelang/cases/retirement-fixes-manifest-witnesses/run.mjs"
    put(entry, runner)
    mkdirSync(join(root, "modules"), { recursive: true })
    mkdirSync(join(root, "runtime"), { recursive: true })
    const result = spawnSync(process.execPath, [join(root, entry)], {
      cwd: root, encoding: "utf8",
      env: { ...process.env, VIBELANG_BINARY: process.execPath,
        EFFECT_NODE_MODULES: join(root, "modules"), VIBELANG_RUNTIME: join(root, "runtime") }
    })
    assert.equal(result.status, 0, result.stdout + result.stderr)
  } finally { rmSync(root, { recursive: true, force: true }) }
}
test("retirement examples ignore generated module sidecars and retain authored declarations", () => {
  probe("vibe", "-24-platform-42-indings")
})
test("retirement source inventories remain stable across generated declaration companions", () => {
  fc.assert(fc.property(
    fc.constantFrom("vibe", "vibex"),
    fc.constantFrom("Local", "-24-platform-45-xport55", "Nested.Types", "résultat", "module name"),
    fc.constantFrom("", "src/", "nested/sources/"),
    (extension, moduleName, subdirectory) => probe(extension, moduleName, subdirectory)
  ), { seed: 7441002, numRuns: 30 })
})
