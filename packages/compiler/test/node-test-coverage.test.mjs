import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"
import fc from "fast-check"
import { checkProperty } from "../../../scripts/testing/property.mjs"

const repo = fileURLToPath(new URL("../../../", import.meta.url))
const compilerPackage = fileURLToPath(new URL("../", import.meta.url))
const native = process.env.VIBELANG_BINARY || join(repo, "packages/compiler/native/vibelang")
const modules = process.env.EFFECT_NODE_MODULES || join(repo, "experiments/node_modules")
const guide = readFileSync(join(repo, "docs/user/src/setup/vite.md"), "utf8")
// Exercise the guide's real command: enabling maps only in the test child
// leaves the controller interpreting emitted offsets as source offsets.
const recipe = guide.match(/^VIBELANG_PROJECT=tsconfig\.test\.json node (.+) --test src\/greet\.test\.ts$/m)
assert.ok(recipe, "the guide provides a Node source-test command")

function coverage({ effects, covered, padding, crlf }) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "vibelang-node-coverage-")))
  try {
    mkdirSync(join(root, "src"))
    mkdirSync(join(root, "node_modules"))
    symlinkSync(compilerPackage, join(root, "node_modules/vibelang"))
    symlinkSync(join(repo, "packages/runtime"), join(root, "node_modules/vibelang-runtime"))
    symlinkSync(realpathSync(join(modules, "effect")), join(root, "node_modules/effect"))
    writeFileSync(join(root, "package.json"), '{"type":"module"}')
    writeFileSync(join(root, "tsconfig.test.json"), JSON.stringify({
      compilerOptions: { target: "ES2022", module: "NodeNext", moduleResolution: "NodeNext", strict: true, skipLibCheck: true, types: [], noEmit: true },
      include: ["src/*.vibe"]
    }))
    let source = "\n".repeat(padding)
    for (const [index, effect] of effects.entries()) {
      source += `export ${effect ? "effect " : ""}function value${index}(): ${effect ? "number!!" : "number"} {\n  return ${index}\n}\n\n`
    }
    if (crlf) source = source.replaceAll("\n", "\r\n")
    writeFileSync(join(root, "src/values.vibe"), source)
    const checks = effects.slice(0, covered).map((effect, index) =>
      `assert.equal(${effect ? "Effect.runSync(" : ""}values.value${index}()${effect ? ")" : ""}, ${index})`
    ).join("\n")
    writeFileSync(join(root, "src/greet.test.ts"), `import { test } from "node:test"
import assert from "node:assert/strict"
import { Effect } from "effect"
import * as values from "./values.vibe"
test("calls the selected source functions", () => { ${checks} })
`)
    writeFileSync(join(root, "reporter.mjs"), `export default async function* report(events) {
  for await (const event of events) if (event.type === "test:coverage") yield JSON.stringify(event.data.summary)
}`)
    const env = { ...process.env, VIBELANG_BINARY: native, VIBELANG_PROJECT: "tsconfig.test.json", VIBELANG_CACHE_DIR: join(root, ".cache"), NO_COLOR: "1" }
    delete env.NODE_TEST_CONTEXT
    const result = spawnSync(process.execPath, [
      ...recipe[1].trim().split(/\s+/), "--test",
      "--experimental-test-coverage", "--test-coverage-functions=100",
      "--test-coverage-include=src/**", "--test-reporter=./reporter.mjs",
      "src/greet.test.ts"
    ], {
      cwd: root, encoding: "utf8", timeout: 30000,
      env
    })
    assert.ifError(result.error)
    let summary
    try { summary = JSON.parse(result.stdout) } catch {
      assert.fail(`Node did not return coverage: ${result.stdout}\n${result.stderr}`)
    }
    const file = summary.files.find((file) => file.path.endsWith("/src/values.vibe"))
    assert.ok(file, JSON.stringify(summary))
    assert.equal(file.totalFunctionCount, effects.length, "one coverage function per written function")
    assert.equal(file.coveredFunctionCount, covered, "uncalled functions remain uncovered")
    assert.equal(result.status, 1, "a 100% function threshold rejects uncalled source functions")
    assert.deepEqual(file.functions.map(({ name, count }) => [name, count > 0]).sort(),
      effects.map((_, index) => [`value${index}`, index < covered]).sort())
  } finally { rmSync(root, { recursive: true, force: true }) }
}

test("the documented Node test command measures source functions and enforces its coverage threshold", () => {
  coverage({ effects: [true, false, true], covered: 2, padding: 3, crlf: false })
})

test("Node coverage preserves source function counts across generated programs", async () => {
  await checkProperty(fc, {
    name: "node-source-coverage",
    rule: "docs/user/src/setup/vite.md: Node test coverage uses source locations and excludes generated functions",
    command: "node --test packages/compiler/test/node-test-coverage.test.mjs",
    arbitrary: fc.record({
      middle: fc.array(fc.boolean(), { minLength: 0, maxLength: 4 }),
      padding: fc.integer({ min: 0, max: 6 }),
      crlf: fc.boolean()
    }),
    numRuns: 12,
    check: ({ middle, padding, crlf }) => coverage({
      effects: [true, ...middle, true], covered: middle.length + 1, padding, crlf
    })
  })
})
