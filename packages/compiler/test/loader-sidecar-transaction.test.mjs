import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"
import fc from "fast-check"
import { checkProperty } from "../../../scripts/testing/property.mjs"

const repo = fileURLToPath(new URL("../../../", import.meta.url))
const compiler = process.env.VIBELANG_BINARY || join(repo, "packages/compiler/native/vibelang")
assert.ok(existsSync(compiler), "build the native compiler before running this test")
const regression = JSON.parse(readFileSync(new URL("./corpus/opencode-loader-failed-sidecar.json", import.meta.url), "utf8"))

function check({ extension, directory, noEmit, declaration, failure, preexisting }) {
  const root = mkdtempSync(join(tmpdir(), "loader-sidecar-transaction-"))
  const source = "src/main." + extension
  const selected = (directory ? directory + "/src/" : "src/") + "main.d." + extension + ".ts"
  const stale = (directory ? "src/" : ".vibe/declarations/src/") + "main.d." + extension + ".ts"
  const good = "export declare const value: number;\n"
  const put = (name, text) => {
    mkdirSync(dirname(join(root, name)), { recursive: true })
    writeFileSync(join(root, name), text)
  }
  const run = () => spawnSync(compiler, [
    "-p", ".", "--loader-root", root, "--project-emit", "--noEmit", "false", "--declaration", "false", "--noEmitOnError", "false",
    "--pretty", "false"
  ], { cwd: root, encoding: "utf8", timeout: 60000 })
  try {
    put("package.json", '{"type":"module"}')
    put("tsconfig.json", JSON.stringify({
      compilerOptions: { target: "ES2022", module: "NodeNext", moduleResolution: "NodeNext", strict: true, skipLibCheck: true,
        types: [], rootDir: ".", outDir: "out", noEmit, declaration, ...(extension === "vibex" ? { jsx: "preserve" } : {}) },
      vibe: { effectGlobals: false, effectModules: false, ...(directory ? { sidecarDir: directory } : {}) },
      files: [source, ...(failure === "declaration" ? ["src/consumer.ts"] : [])]
    }))
    put(source, failure === "missing"
      ? 'import { missing } from "./missing.js"\nexport const value = missing\n'
      : failure === "declaration" ? "export const value = class { private field = 1 }\n"
      : 'export const value: number = "wrong"\n')
    if (failure === "declaration") put("src/consumer.ts", 'import { value } from "./main.' + extension + '"; export { value }\n')
    if (preexisting) put(selected, good)
    put(stale, good)
    const failed = run()
    assert.ifError(failed.error)
    assert.notEqual(failed.status, 0, failed.stdout + failed.stderr)
    assert.match(failed.stdout + failed.stderr, failure === "missing" ? /TS2307/ : failure === "declaration" ? /TS4094/ : /TS2322/)
    assert.equal(existsSync(join(root, selected)), preexisting, "failed loader must not create a sidecar")
    if (preexisting) assert.equal(readFileSync(join(root, selected), "utf8"), good, "failed loader must preserve the selected declaration")
    assert.equal(readFileSync(join(root, stale), "utf8"), good, "failed loader must not clean up the previous layout")

    // Ordinary compiler emission keeps its TypeScript scheduling. Loader output
    // may serve unaffected modules, but publishing compatibility types requires
    // a successful check.
    put(source, "export const value: number = 42\n")
    const fixed = run()
    assert.ifError(fixed.error)
    assert.equal(fixed.status, 0, fixed.stdout + fixed.stderr)
    assert.match(readFileSync(join(root, selected), "utf8"), /export declare const value: number;/)
    assert.equal(existsSync(join(root, stale)), false, "a successful loader replaces the old layout")
  } finally { rmSync(root, { recursive: true, force: true }) }
}

test("TestLoaderSidecarRulesQuoted", () => {
  const vip = readFileSync(new URL("../../../docs/design/vips/0027-declaration-output.md", import.meta.url), "utf8")
  assert.ok(vip.includes("Declarations are exactly what idiomatic Effect TypeScript would declare"))
})

test("opencode failed loader preserves an existing number declaration after TS2307", () => check(regression.input))
test("declaration serialization errors preserve the complete previous sidecar layout", () => check({ ...regression.input, failure: "declaration", directory: "types" }))
test("property: failed loader checks preserve sidecars across layouts, file kinds and emit settings", { timeout: 600000 }, async () => {
  await checkProperty(fc, {
    name: "loader-sidecar-transaction",
    rule: "failed loader checks do not publish compatibility declarations",
    command: "node --test packages/compiler/test/loader-sidecar-transaction.test.mjs",
    regressions: new URL("./corpus/", import.meta.url),
    numRuns: 16,
    arbitrary: fc.record({
      extension: fc.constantFrom("vibe", "vibex"),
      directory: fc.constantFrom("", ".vibe/declarations", "types"),
      noEmit: fc.boolean(), declaration: fc.boolean(),
      failure: fc.constantFrom("missing", "assignment", "declaration"), preexisting: fc.boolean()
    }),
    check
  })
})
