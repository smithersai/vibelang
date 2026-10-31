import { strict as assert } from "node:assert"
import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import fc from "fast-check"
import { checkProperty } from "../../../scripts/testing/property.mjs"

const preload = process.env.VIBELANG_TEST_PRELOAD || fileURLToPath(new URL("../bun.mjs", import.meta.url))
const hasBun = spawnSync("bun", ["--version"]).status === 0
// Chapter 7: "Existing tools work." Loading a TypeScript-only graph must keep
// Bun's results. opencode-18 adds a work bound: dependency graph size must not
// cause the preload to scan dependency sources when no .vibe module loads.
// Count parser work instead of asserting elapsed time on a shared build host.
const rule = "docs/design/src/007-tooling.md: Existing tools work; opencode-18: dependency discovery is bounded"
const regressions = new URL("./property-regressions/", import.meta.url)
const graph = fc.record({
  depth: fc.integer({ min: 1, max: 8 }),
  width: fc.integer({ min: 1, max: 5 }),
  format: fc.constantFrom("esm", "cjs"),
  extension: fc.constantFrom("js", "ts"),
  nested: fc.boolean(),
  dynamic: fc.boolean(),
  value: fc.integer({ min: -20, max: 20 })
})
let diagnostics = ""

function filesOf(input) {
  const { depth, width, format, extension, nested, dynamic, value } = input
  const base = "node_modules/dep/"
  const inner = nested ? base + "node_modules/inner/" : base
  const files = {
    "package.json": '{"type":"module"}\n',
    // A migrated module can be present without being reached by this test.
    "unused.vibe": "export const migrated = 42\n",
    [base + "package.json"]: JSON.stringify({ name: "dep", type: format === "esm" ? "module" : "commonjs", main: "index." + extension }) + "\n"
  }
  for (let level = depth - 1; level >= 0; level--) {
    for (let branch = 0; branch < width; branch++) {
      const path = inner + "part" + level + "-" + branch + "." + extension
      const next = "./part" + (level + 1) + "-" + branch + "." + extension
      files[path] = "// opencode-dependency-source\n" + (format === "esm"
        ? level === depth - 1 ? "export const value = " + value + "\n" : "export { value } from " + JSON.stringify(next) + "\n"
        : level === depth - 1 ? "module.exports = { value: " + value + " }\n" : "module.exports = require(" + JSON.stringify(next) + ")\n")
    }
  }
  const imports = Array.from({ length: width }, (_, branch) => "./part0-" + branch + "." + extension)
  const entry = "// opencode-dependency-source\n" + (format === "esm"
    ? imports.map((path, i) => "import { value as v" + i + " } from " + JSON.stringify(path)).join("\n") + "\nexport const value = " + imports.map((_, i) => "v" + i).join(" + ") + "\n"
    : "module.exports = { value: " + imports.map(path => "require(" + JSON.stringify(path) + ").value").join(" + ") + " }\n")
  if (nested) {
    files[inner + "package.json"] = JSON.stringify({ name: "inner", type: format === "esm" ? "module" : "commonjs", main: "index." + extension }) + "\n"
    files[inner + "index." + extension] = entry
    files[base + "index." + extension] = "// opencode-dependency-source\n" + (format === "esm"
      ? 'export { value } from "inner"\n' : 'module.exports = require("inner")\n')
  } else files[base + "index." + extension] = entry
  files["main.ts"] = (dynamic ? 'const dep = await import("dep")' : 'import * as dep from "dep"') + '\nconsole.log(dep.value)\n'
  files["scan.mjs"] = [
    "const Original = Bun.Transpiler",
    "let scanned = 0",
    "Bun.Transpiler = function(options) {",
    "  const transpiler = new Original(options)",
    "  const scan = transpiler.scanImports.bind(transpiler)",
    "  transpiler.scanImports = (code, ...rest) => {",
    '    if (code.includes("opencode-dependency-source")) scanned++',
    "    return scan(code, ...rest)",
    "  }",
    "  return transpiler",
    "}",
    "await import(process.env.VIBELANG_TEST_PRELOAD)",
    'process.on("exit", () => console.error("dependency scans: " + scanned))',
    ""
  ].join("\n")
  return files
}

function check(input) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "vibelang-bun-property-")))
  try {
    for (const [file, contents] of Object.entries(filesOf(input))) {
      mkdirSync(dirname(join(root, file)), { recursive: true })
      writeFileSync(join(root, file), contents)
    }
    const run = (args) => spawnSync("bun", args, {
      cwd: root, encoding: "utf8", timeout: 20000, maxBuffer: 1 << 20,
      env: { ...process.env, VIBELANG_TEST_PRELOAD: preload, NO_COLOR: "1" }
    })
    const native = run(["main.ts"])
    const loaded = run(["--preload", "./scan.mjs", "main.ts"])
    diagnostics = JSON.stringify({ input, native, loaded }).replaceAll(root, "<project>")
    for (const result of [native, loaded]) {
      assert.ifError(result.error)
      assert.equal(result.status, 0, diagnostics)
    }
    assert.equal(native.stdout, String(input.width * input.value) + "\n", diagnostics)
    assert.equal(loaded.stdout, native.stdout, diagnostics)
    assert.match(loaded.stderr, /dependency scans: 0\n/, diagnostics)
  } finally { rmSync(root, { recursive: true, force: true }) }
}

test("Bun preload preserves generated dependency graphs without scanning them (opencode-18)", {
  skip: !hasBun && "bun is not on PATH"
}, async t => {
  await checkProperty(fc, {
    name: "bun-dependency-discovery", rule,
    command: "node --test test/bun.property.test.mjs",
    arbitrary: graph, numRuns: 50, regressions, artifacts: filesOf,
    diagnostics: () => diagnostics, check
  })
  t.diagnostic("ESM/CommonJS, JS/TS, nested packages, static/dynamic imports, depth and fan-out; no timing oracle")
})
