import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { test } from "node:test"
import { loadTypeScript, publishedEntrypoints } from "./api-identity.mjs"
import { checkProperty } from "./testing/property.mjs"

const cli = fileURLToPath(new URL("./api-identity.mjs", import.meta.url))
const require = createRequire(new URL("../docs/tools/package.json", import.meta.url))
const fc = require("fast-check")
const compiler = require.resolve("typescript")

function put(root, file, text) {
  const path = join(root, file)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, text)
}

function fixture(run) {
  const root = mkdtempSync(join(tmpdir(), "api-compiler-selection-"))
  try {
    for (const side of ["before", "after"]) {
      put(root, side + "/m.d.ts", "export declare const x: 1;\n")
      put(root, side + "/tsconfig.json", JSON.stringify({
        compilerOptions: { lib: ["lib.es5.d.ts"], types: [], strict: true },
      }))
    }
    return run(root)
  } finally { rmSync(root, { recursive: true, force: true }) }
}

function poison(root, placement, kind) {
  const directory = placement === "ancestor" ? root : join(root, placement)
  const marker = join(directory, "compiler-executed")
  const prefix = 'require("node:fs").appendFileSync(' + JSON.stringify(marker) + ', "loaded\\n");\n'
  const body = kind === "throw" ? 'throw new Error("untrusted compiler executed")'
    : kind === "redirect" ? 'module.exports = { ...require(' + JSON.stringify(compiler) + '), sys: { getExecutingFilePath: () => __filename } }'
    : 'module.exports = { createProgram() { throw new Error("untrusted compiler used") }, sys: { getExecutingFilePath: () => __filename } }'
  put(directory, "node_modules/typescript/package.json", JSON.stringify({ name: "typescript", main: "index.cjs" }))
  put(directory, "node_modules/typescript/index.cjs", prefix + body + "\n")
  return marker
}

function compare(root, { file = false, flags = [] } = {}) {
  return spawnSync(process.execPath, [cli, "--before", join(root, "before", ...(file ? ["m.d.ts"] : [])),
    "--after", join(root, "after", ...(file ? ["m.d.ts"] : [])), "--json", ...flags], {
    cwd: root, encoding: "utf8", timeout: 60_000,
  })
}

function receipt(child, expected) {
  assert.equal(child.error, undefined, child.error?.message)
  assert.equal(child.signal, null)
  assert.equal(child.status, expected, child.stdout + child.stderr)
  const result = JSON.parse(child.stdout)
  assert.equal(result.comparisonComplete, true, JSON.stringify(result))
  assert.equal(result.identical, expected === 0, JSON.stringify(result))
  if (expected === 1) assert.ok(result.typeDifferences.length > 0, JSON.stringify(result))
}

test("CLI ignores a compiler installed above identical declaration trees", () => fixture(root => {
  const marker = poison(root, "ancestor", "stand-in")
  receipt(compare(root), 0)
  assert.equal(existsSync(marker), false, "comparison inputs must not select executable compiler code")
}))

test("entrypoint discovery defaults to the pinned compiler", () => fixture(root => {
  const marker = poison(root, "before", "stand-in")
  put(root, "before/package.json", JSON.stringify({ name: "fixture", exports: { ".": "./m.d.ts" } }))
  assert.deepEqual(publishedEntrypoints(join(root, "before")), { ".": join(root, "before/m.d.ts") })
  assert.equal(existsSync(marker), false)
}))

test("CLI explicitly selects one compiler path for parent and worker", () => fixture(root => {
  const directory = join(root, "selected")
  const marker = join(directory, "loaded")
  put(directory, "node_modules/typescript/package.json", JSON.stringify({ name: "typescript", main: "index.cjs" }))
  put(directory, "node_modules/typescript/index.cjs",
    'require("node:fs").appendFileSync(' + JSON.stringify(marker) + ', "loaded\\n");\n' +
    'const ts = require(' + JSON.stringify(compiler) + ');\n' +
    'module.exports = { ...ts, sys: { ...ts.sys, getExecutingFilePath: () => { throw new Error("use the resolved compiler path") } } };\n')
  receipt(compare(root, { flags: ["--typescript", directory] }), 0)
  assert.equal(loadTypeScript().version, require("typescript").version)
  assert.equal(readFileSync(marker, "utf8"), "loaded\nloaded\n")
}))

for (const kind of ["missing", "without-api", "broken"]) {
  test("CLI rejects an explicitly requested " + kind + " compiler without falling back", () => fixture(root => {
    const directory = join(root, "selected")
    mkdirSync(directory)
    if (kind !== "missing") {
      put(directory, "node_modules/typescript/package.json", JSON.stringify({ name: "typescript", main: "index.cjs" }))
      put(directory, "node_modules/typescript/index.cjs", kind === "without-api"
        ? "module.exports = null\n" : 'throw new Error("compiler cannot load")\n')
    }
    const child = compare(root, { flags: ["--typescript", directory] })
    assert.equal(child.error, undefined)
    assert.equal(child.status, 2, child.stdout + child.stderr)
    assert.match(child.stderr, /Requested TypeScript compiler API unavailable/)
    assert.equal(child.stdout, "")
  }))
}

test("property: compiler installations in either input or their ancestor cannot affect the verdict", async () => {
  await checkProperty(fc, {
    name: "api-identity-input-compiler-isolation",
    rule: "The CLI uses the pinned compiler API and never selects compiler code from either comparison input.",
    command: "node --test scripts/api-identity-compiler-selection.test.mjs",
    arbitrary: fc.record({
      placement: fc.constantFrom("ancestor", "before", "after"),
      kind: fc.constantFrom("throw", "stand-in", "redirect"),
      file: fc.boolean(),
      changed: fc.boolean(),
      literal: fc.integer({ min: -100, max: 100 }),
    }),
    numRuns: 12,
    check: input => fixture(root => {
      put(root, "before/m.d.ts", "export declare const x: " + input.literal + ";\n")
      put(root, "after/m.d.ts", "export declare const x: " + (input.literal + Number(input.changed)) + ";\n")
      const marker = poison(root, input.placement, input.kind)
      receipt(compare(root, input), input.changed ? 1 : 0)
      assert.equal(existsSync(marker), false, "input compiler must never execute, even if it throws on load")
    }),
  })
})
