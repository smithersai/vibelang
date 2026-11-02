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
const manifest = JSON.parse(readFileSync(join(root, "packages/ts-mapper/package.json"), "utf8"))
const stock = join(root, "packages/ts-mapper/test/.cache/typescript-" + manifest.devDependencies.typescript, "node_modules/.bin/tsc")

function runCases(values, { missingCompiler = false } = {}) {
  assert.ok(existsSync(stock), "Install the pinned mapper TypeScript with scripts/ci.sh before this test")
  const temp = mkdtempSync(join(tmpdir(), "vibelang-parity-cli-"))
  try {
    for (const [index, { expected, actual }] of values.entries()) {
      const directory = join(temp, "root/typescript/vibelang/cases/case-" + index)
      mkdirSync(directory, { recursive: true })
      writeFileSync(join(directory, "package.json"), '{"type":"module"}\n')
      writeFileSync(join(directory, "tsconfig.json"), JSON.stringify({ compilerOptions: { target: "ESNext", module: "NodeNext", moduleResolution: "NodeNext", outDir: "out" }, files: ["main.ts"] }))
      writeFileSync(join(directory, "main.ts"), "// expect-result: " + JSON.stringify(expected) + '\nimport { Effect } from "effect"\nexport const main = () => Effect.succeed(' + JSON.stringify(actual) + ")\n")
    }
    const result = spawnSync("bun", [join(root, "packages/ts-mapper/test/parity/runtime.ts")], {
      encoding: "utf8", timeout: 30_000,
      env: { ...process.env, PARITY_ROOT: join(temp, "root"), PARITY_OUT: join(temp, "out"),
        PARITY_MAPPER: join(temp, "unused-mapper"),
        PARITY_STOCK_TSC: missingCompiler ? join(temp, "missing-compiler") : stock,
        PARITY_EFFECT_DIR: realpathSync(join(root, "experiments/node_modules/effect")),
        PARITY_RUNTIME_DIR: join(root, "packages/runtime") }
    })
    assert.equal(result.error, undefined, result.stdout + result.stderr)
    const passed = missingCompiler ? 0 : values.filter(({ expected, actual }) => expected === actual).length
    assert.match(result.stdout, new RegExp("runtime parity: " + passed + "/" + values.length))
    assert.equal(result.status, passed === values.length ? 0 : 1, result.stdout + result.stderr)
    for (const [index, { expected, actual }] of values.entries()) {
      assert.match(result.stdout, new RegExp((!missingCompiler && expected === actual ? "ok  " : "FAIL") + " case-" + index))
    }
    if (missingCompiler) assert.match(result.stdout, /harness error:.*(ENOENT|not found)/)
  } finally { rmSync(temp, { recursive: true, force: true }) }
}

test("mapper runtime parity exits zero when every real compiled fixture passes", () => {
  runCases([{ expected: 42, actual: 42 }, { expected: -7, actual: -7 }])
})

test("mapper runtime parity exits one after a real result mismatch", () => {
  runCases([{ expected: 42, actual: 43 }])
})

test("mapper runtime parity keeps successful rows and fails a mixed batch", () => {
  runCases([{ expected: 1, actual: 1 }, { expected: 2, actual: 3 }, { expected: 4, actual: 4 }])
})

test("mapper runtime parity reports compiler launch failure to its caller", () => {
  runCases([{ expected: 1, actual: 1 }], { missingCompiler: true })
})

test("mapper runtime parity status matches the aggregate real fixture results", async () => {
  await checkProperty(fc, {
    name: "mapper-runtime-parity-status",
    rule: "Runner invariant: the runtime-parity CLI returns success exactly when every selected runtime case passes, including mixed batches and harness failures.",
    command: "node --test scripts/mapper-runtime-parity.test.mjs",
    arbitrary: fc.array(fc.record({ expected: fc.integer({ min: -10, max: 10 }), mismatch: fc.boolean() }), { minLength: 1, maxLength: 3 }),
    numRuns: 24,
    check: values => runCases(values.map(({ expected, mismatch }) => ({ expected, actual: expected + (mismatch ? 1 : 0) })))
  })
})
