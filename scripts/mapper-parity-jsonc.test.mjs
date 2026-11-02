import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"
import { parseJsonc } from "../packages/compiler/cache.mjs"
import { checkProperty } from "./testing/property.mjs"

const root = fileURLToPath(new URL("../", import.meta.url))
const require = createRequire(new URL("../packages/compiler/package.json", import.meta.url))
const fc = require("fast-check")
const version = JSON.parse(readFileSync(join(root, "packages/ts-mapper/package.json"), "utf8")).devDependencies.typescript
const stock = join(root, "packages/ts-mapper/test/.cache/typescript-" + version, "node_modules/.bin/tsc")

// Serialize the value first, then add JSONC syntax only at known token boundaries.
// Values and property names are arbitrary JSON data, including comment lookalikes.
const configText = (data) => '\uFEFF{ /* config */ "compilerOptions": ' + JSON.stringify(data) + ', // final member\n}\n'
const suspicious = [",]", ",}", ",  ]", ", \t}", 'quote: \\" ,]', "\\\\,}", "//,]", "/*,}*/", "雪😀,]"]

test("both parity columns use the compiler's string-aware JSONC reader", () => {
  for (const name of ["runtime", "parity"]) {
    const source = readFileSync(join(root, "packages/ts-mapper/test/parity", name + ".ts"), "utf8")
    assert.match(source, /import\s*\{\s*parseJsonc\s*\}\s*from\s*["']\.\.\/\.\.\/\.\.\/compiler\/cache\.mjs["']/)
    assert.doesNotMatch(source, /function parseJsonc\(/, name + " must not keep a second reader")
  }
})

test("JSONC commas and comment lookalikes inside keys and values remain data", () => {
  const data = Object.fromEntries(suspicious.map((text, i) => [text, { value: text, list: [text, i] }]))
  assert.deepEqual(parseJsonc(configText(data)), { compilerOptions: data })
  assert.deepEqual(parseJsonc('{ "list": ["x,]", "y,}", /* comment */], "value": ",}", }'), {
    list: ["x,]", "y,}"], value: ",}"
  })
})

test("comments cannot join otherwise invalid JSON tokens", () => {
  for (const source of ['{"n": 1/* separator */2}', '{"v": tr/* separator */ue}', '{"x": "a"/* separator */"b"}']) {
    assert.throws(() => parseJsonc(source), SyntaxError)
  }
})

test("generated JSON data survives JSONC comment and trailing-comma decoration", async () => {
  await checkProperty(fc, {
    name: "mapper-parity-jsonc-data",
    rule: "Harness invariant: reading tsconfig JSONC preserves every JSON string key and value; only comments and commas outside strings are syntax.",
    command: "node --test scripts/mapper-parity-jsonc.test.mjs",
    arbitrary: fc.dictionary(fc.oneof(fc.string(), fc.constantFrom(...suspicious)),
      fc.oneof(fc.jsonValue(), fc.constantFrom(...suspicious))),
    numRuns: 400,
    check: data => assert.deepEqual(parseJsonc(configText(data)), JSON.parse(JSON.stringify({ compilerOptions: data })))
  })
})

function runConfigs(outDirs, { bom = false } = {}) {
  assert.ok(existsSync(stock), "Install the pinned mapper TypeScript with scripts/ci.sh before this test")
  const temp = mkdtempSync(join(tmpdir(), "vibelang-parity-jsonc-"))
  try {
    const cases = outDirs.map((outDir, i) => {
      const dir = join(temp, "case-" + i)
      mkdirSync(dir)
      writeFileSync(join(dir, "package.json"), '{"type":"module"}\n')
      const options = { target: "ESNext", module: "NodeNext", moduleResolution: "NodeNext", outDir }
      // A trailing comma next to a real comment must be removed; the outDir is data.
      writeFileSync(join(dir, "tsconfig.json"), (bom ? "\uFEFF" : "") +
        '{ "compilerOptions": ' + JSON.stringify(options) + ', /* final comma */ "files": ["main.ts",], }\n')
      writeFileSync(join(dir, "main.ts"), '// expect-result: 42\nimport { Effect } from "effect"\nexport const main = () => Effect.succeed(42)\n')
      return { id: "case-" + i, dir }
    })
    const driver = join(temp, "driver.mjs"), config = join(temp, "config.json")
    writeFileSync(driver, 'import { runtimeParity } from ' +
      JSON.stringify(join(root, "packages/ts-mapper/test/parity/runtime.ts")) +
      '\nconst { cases, options } = JSON.parse(await Bun.file(process.argv[2]).text())\nconsole.log(JSON.stringify([...await runtimeParity(cases, options)]))\n')
    const output = join(temp, "output")
    writeFileSync(config, JSON.stringify({ cases, options: {
      jobs: 2, outDir: output, mapper: join(temp, "unused-mapper"), stockTsc: stock,
      effectDir: realpathSync(join(root, "experiments/node_modules/effect")), runtimeDir: join(root, "packages/runtime")
    } }))
    const child = spawnSync("bun", [driver, config], { encoding: "utf8", timeout: 30_000 })
    assert.equal(child.error, undefined, child.stdout + child.stderr)
    assert.equal(child.status, 0, child.stdout + child.stderr)
    const rows = new Map(JSON.parse(child.stdout))
    assert.equal(rows.size, cases.length)
    for (const [i, outDir] of outDirs.entries()) {
      const row = rows.get("case-" + i)
      assert.equal(row.ok, true, JSON.stringify(row))
      assert.equal(row.actual, "42")
      const copy = join(output, "work/runtime/case-" + i)
      const forwarded = JSON.parse(readFileSync(join(copy, "tsconfig.runtime.json"), "utf8"))
      assert.equal(forwarded.compilerOptions.outDir, resolve(copy, outDir), "stock TypeScript must receive the written path")
      assert.ok(existsSync(join(copy, outDir, "main.js")), "JavaScript must be emitted into " + outDir)
      assert.ok(existsSync(join(copy, outDir, "run.mjs")), "the actual runner must use " + outDir)
    }
  } finally { rmSync(temp, { recursive: true, force: true }) }
}

for (const outDir of ["out", "out,]", "out,}", "out,   ]", "nested/out, }", "雪😀,]"]) {
  test("runtime parity compiles and runs with literal outDir " + JSON.stringify(outDir), () => runConfigs([outDir]))
}

test("runtime parity reads a BOM-prefixed JSONC project", () => runConfigs(["out,]"], { bom: true }))

test("generated path neighbours reach the real compiler and runner unchanged", async () => {
  await checkProperty(fc, {
    name: "mapper-parity-jsonc-paths",
    rule: "Harness invariant: the runtime column passes the literal configured output path to stock TypeScript and runs that emitted JavaScript.",
    command: "node --test scripts/mapper-parity-jsonc.test.mjs",
    arbitrary: fc.array(fc.tuple(fc.constantFrom("out", "nested/build", "片😀"),
      fc.constantFrom(",]", ",}", ",  ]", ", }", "")), { minLength: 1, maxLength: 2 }),
    numRuns: 12,
    check: pairs => runConfigs(pairs.map(([prefix, suffix]) => prefix + suffix))
  })
})
