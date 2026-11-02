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
const emittedExtension = { ts: "js", mts: "mjs", cts: "cjs" }

function runCases(inputs) {
  assert.ok(existsSync(stock), "Install the pinned mapper TypeScript with scripts/ci.sh before this test")
  const temp = mkdtempSync(join(tmpdir(), "vibelang-parity-entry-"))
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

for (const extension of Object.keys(emittedExtension)) {
  test("runtime parity executes the real emitted ." + extension + " entry", () => {
    runCases([{ extension, actual: 42 }])
  })
}

test("entry selection keeps alphabetical order and ignores declaration sidecars", () => {
  const temp = mkdtempSync(join(tmpdir(), "vibelang-parity-header-"))
  try {
    writeFileSync(join(temp, "a.d.ts"), "// expect-result: 0\n")
    writeFileSync(join(temp, "b.mts"), "// expect-result: 1\n")
    writeFileSync(join(temp, "c.cts"), "// expect-result: 2\n")
    const driver = join(temp, "driver.mjs")
    writeFileSync(driver, 'import { expectedResult } from ' + JSON.stringify(join(root, "packages/ts-mapper/test/parity/runtime.ts")) +
      '; console.log(JSON.stringify(expectedResult(' + JSON.stringify(temp) + ')))')
    const child = spawnSync("bun", [driver], { encoding: "utf8", timeout: 10_000 })
    assert.equal(child.status, 0, child.stderr)
    assert.deepEqual(JSON.parse(child.stdout), { result: "1", entry: "b.mjs" })
  } finally { rmSync(temp, { recursive: true, force: true }) }
})

test("generated native entry batches run the modules stock tsc actually emitted", async () => {
  await checkProperty(fc, {
    name: "mapper-runtime-entry-extension",
    rule: "Harness invariant: .ts entries run their .js output, .mts their .mjs output, and .cts their .cjs output; each compiled main returns the source's expected value.",
    command: "node --test scripts/mapper-runtime-entry.test.mjs",
    arbitrary: fc.array(fc.record({
      extension: fc.constantFrom(...Object.keys(emittedExtension)),
      actual: fc.integer({ min: -100, max: 100 }),
      stem: fc.stringMatching(/^[a-z][a-z0-9_-]{0,10}$/)
    }), { minLength: 1, maxLength: 3 }),
    numRuns: 16,
    check: runCases
  })
})
