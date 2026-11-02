import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
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

function runJobs(value, valid = false) {
  assert.ok(existsSync(stock), "Install the pinned mapper TypeScript before this test")
  const temp = mkdtempSync(join(tmpdir(), "vibelang-parity-jobs-"))
  try {
    const harness = join(temp, "harness")
    cpSync(join(root, "packages/ts-mapper/test/parity"), harness, {
      recursive: true, filter: (src) => !src.split("/").includes("out")
    })
    // Only relocate imports of the production snippet checker; every harness source stays real.
    for (const name of ["parity.ts", "docs.ts"]) {
      const file = join(harness, name)
      writeFileSync(file, readFileSync(file, "utf8").replace(
        '"../../../../docs/tools/check-snippets.ts"', JSON.stringify(join(root, "docs/tools/check-snippets.ts"))
      ))
    }
    const fixture = join(temp, "fixture"), scope = join(temp, "scope")
    for (const dir of ["docs/user", "templates", "examples"]) mkdirSync(join(fixture, dir), { recursive: true })
    // Option validation is independent of compiler semantics. The nonempty real-doc witness is retained separately.
    writeFileSync(join(fixture, "docs/user/page.md"), "# Native parity fixture\n")
    mkdirSync(join(scope, "node_modules"), { recursive: true })
    for (const name of ["package.json", "prelude.d.ts"]) {
      cpSync(join(root, "packages/ts-mapper", name), join(scope, name))
    }
    const effect = realpathSync(join(root, "experiments/node_modules/effect"))
    symlinkSync(effect, join(scope, "node_modules/effect"))
    symlinkSync(join(root, "packages/runtime"), join(scope, "node_modules/vibelang-runtime"))
    const docs = join(scope, "docs")
    mkdirSync(docs)
    writeFileSync(join(docs, "keep"), "prior documentation receipt\n")
    const child = spawnSync("bun", [join(harness, "parity.ts"), "--docs", ...(value === null ? [] : ["--jobs", ...value])], {
      cwd: temp, encoding: "utf8", timeout: 30_000,
      env: { ...process.env, PARITY_ROOT: fixture, PARITY_FORK_TSC: join(root, "packages/compiler/native/vibelang"),
        PARITY_STOCK_TSC: stock, PARITY_MAPPER: join(temp, "unused-mapper"), PARITY_EFFECT_DIR: effect,
        PARITY_RUNTIME_DIR: join(root, "packages/runtime"), PARITY_MAPPER_PACKAGE: scope }
    })
    assert.equal(child.error, undefined, child.stdout + child.stderr)
    if (valid) {
      assert.equal(child.status, 0, child.stdout + child.stderr)
      assert.match(child.stdout, /docs: 0 modules/)
      assert.ok(existsSync(join(harness, "out/summary.json")), "valid count enters the real docs pipeline")
    } else {
      assert.equal(child.status, 2, child.stdout + child.stderr)
      assert.match(child.stderr, /--jobs.*positive.*safe integer/)
      assert.equal(readFileSync(join(docs, "keep"), "utf8"), "prior documentation receipt\n")
      assert.equal(existsSync(join(harness, "out")), false, "invalid count must fail before staging output")
    }
  } finally { rmSync(temp, { recursive: true, force: true }) }
}

test("parity keeps its default and positive integer worker counts", () => {
  for (const value of [null, ["1"], ["2"], ["8"]]) runJobs(value, true)
})
for (const [label, value] of [
  ["zero", ["0"]], ["negative", ["-1"]], ["fraction below one", ["0.5"]], ["fraction above one", ["1.5"]],
  ["NaN", ["NaN"]], ["infinity", ["Infinity"]], ["negative infinity", ["-Infinity"]],
  ["nonnumeric", ["workers"]], ["empty", [""]], ["whitespace", [" "]],
  ["unsafe integer", ["9007199254740992"]], ["overflow", ["1e309"]], ["missing", []], ["flag as value", ["--gate"]]
]) test("parity rejects " + label + " worker counts before changing output", () => runJobs(value))

test("generated invalid parity worker counts preserve prior docs receipts", async () => {
  await checkProperty(fc, {
    name: "mapper-parity-invalid-jobs",
    rule: "Harness invariant: --jobs is a positive safe integer; invalid counts exit2 before setting up modules or replacing documentation receipts.",
    command: "node --test scripts/mapper-parity-jobs.test.mjs",
    arbitrary: fc.oneof(
      fc.integer({ min: -1000, max: 0 }).map(String),
      fc.integer({ min: 0, max: 1000 }).map((n) => String(n + 0.25)),
      fc.constantFrom("", " ", "NaN", "Infinity", "-Infinity", "workers", "9007199254740992", "1e309")
    ).map((value) => [value]),
    numRuns: 48,
    check: runJobs
  })
})
