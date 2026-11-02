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
const brokenTypes = [
  "const invalid: = 1",
  "function unused(value:) { return value }",
  "class Unused { field: = 1 }",
  "type Unused = ;",
  "interface Unused { value: }"
]

function runCases(inputs) {
  assert.ok(existsSync(stock), "Install the pinned mapper TypeScript with scripts/ci.sh before this test")
  const temp = mkdtempSync(join(tmpdir(), "vibelang-parity-compile-"))
  try {
    const cases = inputs.map(({ broken = null, actual = 42, unchecked = false }, i) => {
      const dir = join(temp, "case-" + i)
      mkdirSync(dir)
      writeFileSync(join(dir, "package.json"), '{"type":"module"}\n')
      writeFileSync(join(dir, "tsconfig.json"), JSON.stringify({ compilerOptions: {
        target: "ESNext", module: "NodeNext", moduleResolution: "NodeNext", outDir: "out"
      }, files: ["main.ts"] }))
      const source = "// expect-result: " + actual + '\nimport { Effect } from "effect"\nimport { writeFileSync } from "node:fs"\n' +
        (broken ?? (unchecked ? "const unchecked: MissingType = 1" : "const healthy: number = 1")) +
        '\nwriteFileSync(' + JSON.stringify(join(temp, "ran-" + i)) + ', "executed")\n' +
        'export const main = () => Effect.succeed(' + actual + ')\n'
      writeFileSync(join(dir, "main.ts"), source)
      return { id: "case-" + i, dir }
    })
    const driver = join(temp, "driver.mjs"), config = join(temp, "config.json")
    writeFileSync(driver, 'import { runtimeParity } from ' + JSON.stringify(join(root, "packages/ts-mapper/test/parity/runtime.ts")) +
      '\nconst { cases, options } = JSON.parse(await Bun.file(process.argv[2]).text())\nconsole.log(JSON.stringify([...await runtimeParity(cases, options)]))\n')
    const outDir = join(temp, "output")
    writeFileSync(config, JSON.stringify({ cases, options: { jobs: 2, outDir,
      mapper: join(temp, "unused-mapper"), stockTsc: stock,
      effectDir: realpathSync(join(root, "experiments/node_modules/effect")), runtimeDir: join(root, "packages/runtime") } }))
    const child = spawnSync("bun", [driver, config], { encoding: "utf8", timeout: 30_000 })
    assert.equal(child.error, undefined, child.stdout + child.stderr)
    assert.equal(child.status, 0, child.stdout + child.stderr)
    const rows = new Map(JSON.parse(child.stdout))
    assert.equal(rows.size, inputs.length)
    for (const [i, { broken = null, actual = 42 }] of inputs.entries()) {
      const row = rows.get("case-" + i)
      assert.ok(existsSync(join(outDir, "work/runtime/case-" + i, "out/main.js")), "stock tsc emitted JavaScript")
      if (broken !== null) {
        assert.equal(row.ok, false, JSON.stringify(row))
        assert.equal(row.actual, null, "a failed compile must stop before execution")
        assert.match(row.detail, /stock tsc exited 2: .*error TS\d+:/)
        assert.ok(row.detail.length <= 300)
        assert.equal(existsSync(join(temp, "ran-" + i)), false, "no top-level code may execute after a compiler failure")
      } else {
        assert.equal(row.ok, true, JSON.stringify(row))
        assert.equal(row.actual, String(actual))
        assert.equal(row.detail, "")
        assert.equal(readFileSync(join(temp, "ran-" + i), "utf8"), "executed")
      }
    }
  } finally { rmSync(temp, { recursive: true, force: true }) }
}

test("runtime parity still executes healthy and deliberately unchecked TypeScript", () => {
  runCases([{}, { unchecked: true, actual: 43 }])
})

for (const broken of brokenTypes) test("runtime parity stops after a real compiler failure: " + broken, () => {
  runCases([{ broken }])
})

test("generated mixed batches distinguish syntax failures from emitted output", async () => {
  await checkProperty(fc, {
    name: "mapper-runtime-compile-status",
    rule: "Runner invariant: stock TypeScript must exit zero before emitted JavaScript executes; noCheck skips type checking but does not admit syntax errors.",
    command: "node --test scripts/mapper-runtime-compile.test.mjs",
    arbitrary: fc.array(fc.record({ broken: fc.oneof(fc.constant(null), fc.constantFrom(...brokenTypes)),
      actual: fc.integer({ min: -100, max: 100 }), unchecked: fc.boolean() }), { minLength: 1, maxLength: 3 }),
    numRuns: 16,
    check: runCases
  })
})
