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

function runCases(inputs) {
  assert.ok(existsSync(stock), "Install the pinned mapper TypeScript with scripts/ci.sh before this test")
  const temp = mkdtempSync(join(tmpdir(), "vibelang-parity-result-"))
  try {
    const cases = inputs.map(({ expected = 42, actual = 42, exitCode = 0, signal }, index) => {
      const dir = join(temp, "case-" + index)
      mkdirSync(dir)
      writeFileSync(join(dir, "package.json"), '{"type":"module"}\n')
      writeFileSync(join(dir, "tsconfig.json"), JSON.stringify({ compilerOptions: { target: "ESNext", module: "NodeNext", moduleResolution: "NodeNext", outDir: "out" }, files: ["main.ts"] }))
      const hook = signal
        ? 'process.on("exit", () => { console.error("fixture teardown failed"); process.kill(process.pid, ' + JSON.stringify(signal) + ') })'
        : 'process.on("exit", () => { console.error("fixture teardown failed"); process.exitCode = ' + exitCode + ' })'
      writeFileSync(join(dir, "main.ts"), "// expect-result: " + JSON.stringify(expected) + '\nimport { Effect } from "effect"\n' + hook + "\nexport const main = () => Effect.succeed(" + JSON.stringify(actual) + ")\n")
      return { id: "case-" + index, dir }
    })
    const driver = join(temp, "driver.mjs"), config = join(temp, "config.json")
    writeFileSync(driver, 'import { runtimeParity } from ' + JSON.stringify(join(root, "packages/ts-mapper/test/parity/runtime.ts")) + '\nconst { cases, options } = JSON.parse(await Bun.file(process.argv[2]).text())\nconsole.log(JSON.stringify([...await runtimeParity(cases, options)]))\n')
    writeFileSync(config, JSON.stringify({ cases, options: { jobs: 2, outDir: join(temp, "out"),
      mapper: join(temp, "unused-mapper"), stockTsc: stock,
      effectDir: realpathSync(join(root, "experiments/node_modules/effect")), runtimeDir: join(root, "packages/runtime") } }))
    const result = spawnSync("bun", [driver, config], { encoding: "utf8", timeout: 30_000 })
    assert.equal(result.error, undefined, result.stdout + result.stderr)
    assert.equal(result.status, 0, result.stdout + result.stderr)
    const rows = new Map(JSON.parse(result.stdout))
    assert.equal(rows.size, inputs.length)
    for (const [index, { expected = 42, actual = 42, exitCode = 0, signal }] of inputs.entries()) {
      const row = rows.get("case-" + index)
      const success = !signal && exitCode === 0 && expected === actual
      assert.equal(row.actual, JSON.stringify(actual), JSON.stringify(row))
      assert.equal(row.ok, success, JSON.stringify(row))
      if (signal || exitCode !== 0) {
        assert.match(row.detail, /runtime.*exit/i)
        assert.ok(row.detail.includes(signal || String(exitCode)), row.detail)
        assert.match(row.detail, /fixture teardown failed/)
      } else if (success) assert.equal(row.detail, "")
      else assert.equal(row.detail, JSON.stringify(actual))
    }
  } finally { rmSync(temp, { recursive: true, force: true }) }
}

test("mapper runtime parity retains healthy success and value mismatch controls", () => {
  runCases([{}, { expected: 42, actual: 43 }])
})

for (const exitCode of [1, 2, 7, 42, 127, 255]) test("mapper runtime parity rejects a matching value followed by exit " + exitCode, () => {
  runCases([{ exitCode }])
})

test("mapper runtime parity rejects a matching value followed by a signal", { skip: process.platform === "win32" }, () => {
  runCases([{ signal: "SIGTERM" }])
})

test("mapper runtime parity checks exit status independently for generated mixed batches", async () => {
  await checkProperty(fc, {
    name: "mapper-runtime-result-exit",
    rule: "Runner invariant: a runtime case passes only when its process exits zero and its result matches; expected output cannot hide a teardown failure or signal.",
    command: "node --test scripts/mapper-runtime-result.test.mjs",
    arbitrary: fc.array(fc.record({ actual: fc.integer({ min: -10, max: 10 }), mismatch: fc.boolean(), exitCode: fc.oneof(fc.constant(0), fc.integer({ min: 1, max: 255 })) }), { minLength: 1, maxLength: 3 }),
    numRuns: 24,
    check: inputs => runCases(inputs.map(({ actual, mismatch, exitCode }) => ({ actual, expected: actual + (mismatch ? 1 : 0), exitCode })))
  })
})
