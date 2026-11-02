import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"
import { checkProperty } from "./testing/property.mjs"

const root = fileURLToPath(new URL("../", import.meta.url))
const require = createRequire(new URL("../packages/compiler/package.json", import.meta.url))
const fc = require("fast-check")
const version = JSON.parse(readFileSync(join(root, "packages/ts-mapper/package.json"), "utf8")).devDependencies.typescript
const stock = join(root, "packages/ts-mapper/test/.cache/typescript-" + version, "node_modules/.bin/tsc")
const emittedExtension = { ts: "js" }

function runCases(inputs) {
  assert.ok(existsSync(stock), "Install the pinned mapper TypeScript with scripts/ci.sh before this test")
  const temp = mkdtempSync(join(tmpdir(), "vibelang-parity-entry-url-"))
  try {
    const cases = inputs.map(({ extension, actual, stem = "main" }, i) => {
      const dir = join(temp, "case-" + i)
      mkdirSync(dir)
      const name = stem + "." + extension
      writeFileSync(join(dir, "package.json"), '{"type":"module"}\n')
      writeFileSync(join(dir, "tsconfig.json"), JSON.stringify({ compilerOptions: {
        target: "ESNext", module: "NodeNext", moduleResolution: "NodeNext", outDir: "out"
      }, files: [name] }))
      writeFileSync(join(dir, name), "// expect-result: " + actual + '\nimport { Effect } from "effect"\nexport const main = () => Effect.succeed(' + actual + ')\n')
      return { id: "case-" + i, dir }
    })
    const driver = join(temp, "driver.mjs"), config = join(temp, "config.json")
    writeFileSync(driver, 'import { expectedResult, runtimeParity } from ' + JSON.stringify(join(root, "packages/ts-mapper/test/parity/runtime.ts")) +
      '\nconst { cases, options } = JSON.parse(await Bun.file(process.argv[2]).text())\nconsole.log(JSON.stringify({ headers: cases.map(c => expectedResult(c.dir)), rows: [...await runtimeParity(cases, options)] }))\n')
    const outDir = join(temp, "output")
    writeFileSync(config, JSON.stringify({ cases, options: { jobs: 2, outDir,
      mapper: join(temp, "unused-mapper"), stockTsc: stock,
      effectDir: realpathSync(join(root, "experiments/node_modules/effect")), runtimeDir: join(root, "packages/runtime") } }))
    const child = spawnSync("bun", [driver, config], { encoding: "utf8", timeout: 30_000 })
    assert.equal(child.error, undefined, child.stdout + child.stderr)
    assert.equal(child.status, 0, child.stdout + child.stderr)
    const { headers, rows } = JSON.parse(child.stdout)
    const results = new Map(rows)
    assert.equal(results.size, inputs.length)
    for (const [i, { extension, actual, stem = "main" }] of inputs.entries()) {
      const emitted = stem + "." + emittedExtension[extension]
      assert.ok(existsSync(join(outDir, "work/runtime/case-" + i, "out", emitted)), "stock tsc emitted " + emitted)
      const row = results.get("case-" + i)
      assert.equal(row.ok, true, JSON.stringify(row))
      assert.equal(row.actual, String(actual))
      assert.equal(row.detail, "")
      assert.deepEqual(headers[i], { result: String(actual), entry: emitted })
    }
  } finally { rmSync(temp, { recursive: true, force: true }) }
}

const names = ["main", "with space", "unicode-λ", "hash#tag", "query?tag", 'double"quote', "literal%20space", "encoded%2Fslash"]
for (const stem of names) {
  test("runtime parity imports a literal entry filename: " + JSON.stringify(stem), () => {
    runCases([{ extension: "ts", actual: 42, stem }])
  })
}

test("generated filename batches preserve literal URL metacharacters", async () => {
  await checkProperty(fc, {
    name: "mapper-runtime-entry-url",
    rule: "Harness invariant: a generated import names the literal emitted filename, including URL metacharacters and JavaScript quotes; every real compiled main returns its expected value.",
    command: "node --test scripts/mapper-runtime-entry-url.test.mjs",
    arbitrary: fc.array(fc.record({
      extension: fc.constantFrom(...Object.keys(emittedExtension)),
      actual: fc.integer({ min: -100, max: 100 }),
      stem: fc.tuple(fc.constantFrom("#", "?", "%20", "%2F", '"', " ", "λ"), fc.stringMatching(/^[a-z]{1,4}$/)).map(([mark, suffix]) => "entry" + mark + suffix)
    }), { minLength: 1, maxLength: 3 }),
    numRuns: 12,
    check: runCases
  })
})
