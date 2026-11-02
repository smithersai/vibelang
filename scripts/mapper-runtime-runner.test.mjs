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

function runCases(inputs, verifyBytes = false) {
  assert.ok(existsSync(stock), "Install the pinned mapper TypeScript with scripts/ci.sh before this test")
  const temp = mkdtempSync(join(tmpdir(), "vibelang-parity-runner-"))
  try {
    const cases = inputs.map(({ helper = "run", actual = 42, indirect = false }, i) => {
      const dir = join(temp, "case-" + i)
      mkdirSync(dir)
      writeFileSync(join(dir, "package.json"), '{"type":"module"}\n')
      const files = ["main.ts", helper + ".mts", ...(indirect ? ["bridge.ts"] : [])]
      writeFileSync(join(dir, "tsconfig.json"), JSON.stringify({ compilerOptions: {
        target: "ESNext", module: "NodeNext", moduleResolution: "NodeNext", outDir: "out"
      }, files }))
      writeFileSync(join(dir, helper + ".mts"), "export const value: number = " + actual + "\n")
      if (indirect) writeFileSync(join(dir, "bridge.ts"), 'export { value } from "./' + helper + '.mjs"\n')
      const dependency = indirect ? "bridge.js" : helper + ".mjs"
      writeFileSync(join(dir, "main.ts"), "// expect-result: " + actual + '\nimport { Effect } from "effect"\nimport { value } from "./' + dependency + '"\nexport const main = () => Effect.succeed(value)\n')
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
    const results = new Map(JSON.parse(child.stdout))
    assert.equal(results.size, inputs.length)
    for (const [i, { helper = "run", actual = 42, indirect = false }] of inputs.entries()) {
      const dir = join(outDir, "work/runtime/case-" + i)
      const emitted = join(dir, "out", helper + ".mjs")
      assert.ok(existsSync(emitted), "stock tsc emitted the helper module")
      const row = results.get("case-" + i)
      assert.equal(row.ok, true, JSON.stringify(row))
      assert.equal(row.actual, String(actual))
      assert.equal(row.detail, "")
      if (verifyBytes) {
        const reference = join(temp, "reference-" + i)
        const compiled = spawnSync(stock, ["-p", "tsconfig.runtime.json", "--outDir", reference, "--pretty", "false"], {
          cwd: dir, encoding: "utf8", timeout: 30_000
        })
        assert.equal(compiled.status, 0, compiled.stdout + compiled.stderr)
        for (const name of ["main.js", helper + ".mjs", ...(indirect ? ["bridge.js"] : [])]) {
          assert.deepEqual(readFileSync(join(dir, "out", name)), readFileSync(join(reference, name)), "runner must preserve compiler output: " + name)
        }
      }
    }
  } finally { rmSync(temp, { recursive: true, force: true }) }
}

test("runtime parity still runs a graph with a noncolliding helper", () => runCases([{ helper: "worker" }]))
test("runtime parity preserves a dependency named run.mjs", () => runCases([{}], true))
test("runtime parity preserves run.mjs reached through a reexport", () => runCases([{ indirect: true }], true))
test("concurrent cases keep their own runner and emitted module graph", () => {
  runCases([{ actual: 11 }, { actual: 22, indirect: true }, { actual: 33, helper: "worker" }])
})

test("generated module graphs retain compiler-owned run.mjs exports", async () => {
  await checkProperty(fc, {
    name: "mapper-runtime-runner-isolation",
    rule: "Harness invariant: executing a case must preserve every compiler-emitted module; run.mjs is a valid dependency, both directly and through a reexport.",
    command: "node --test scripts/mapper-runtime-runner.test.mjs",
    arbitrary: fc.array(fc.record({
      helper: fc.constantFrom("run", "worker"),
      actual: fc.integer({ min: -100, max: 100 }),
      indirect: fc.boolean()
    }), { minLength: 1, maxLength: 3 }),
    numRuns: 12,
    check: runCases
  })
})
