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

function runCli(selectors, { ids = ["alpha", "beta"], runnable = true } = {}) {
  assert.ok(existsSync(stock), "Install the pinned mapper TypeScript before this test")
  const temp = mkdtempSync(join(tmpdir(), "vibelang-parity-selection-"))
  try {
    const cases = join(temp, "typescript/vibelang/cases")
    mkdirSync(cases, { recursive: true })
    for (const id of ids) {
      const dir = join(cases, id)
      mkdirSync(dir)
      writeFileSync(join(dir, "package.json"), '{"type":"module"}\n')
      writeFileSync(join(dir, "tsconfig.json"), JSON.stringify({ compilerOptions: {
        target: "ESNext", module: "NodeNext", moduleResolution: "NodeNext", outDir: "out"
      }, files: ["main.ts"] }))
      writeFileSync(join(dir, "main.ts"), (runnable ? "// expect-result: 42\n" : "") +
        'import { Effect } from "effect"\nexport const main = () => Effect.succeed(42)\n')
    }
    const child = spawnSync("bun", [join(root, "packages/ts-mapper/test/parity/runtime.ts"), ...selectors], {
      cwd: temp, encoding: "utf8", timeout: 30_000,
      env: { ...process.env, PARITY_ROOT: temp, PARITY_OUT: join(temp, "output"),
        PARITY_MAPPER: join(temp, "unused-mapper"), PARITY_STOCK_TSC: stock,
        PARITY_EFFECT_DIR: realpathSync(join(root, "experiments/node_modules/effect")),
        PARITY_RUNTIME_DIR: join(root, "packages/runtime") }
    })
    assert.equal(child.error, undefined, child.stdout + child.stderr)
    const selected = runnable ? ids.filter((id) => selectors.length === 0 || selectors.some((s) => id.includes(s))) : []
    if (selected.length === 0) {
      assert.equal(child.status, 2, child.stdout + child.stderr)
      assert.match(child.stderr, /no runnable cases/i)
      for (const selector of selectors) assert.ok(child.stderr.includes(JSON.stringify(selector)), "diagnostic names selector " + selector)
      assert.doesNotMatch(child.stdout, /runtime parity: 0\/0/)
      assert.equal(existsSync(join(temp, "output")), false, "empty selection creates no runtime workspace")
    } else {
      assert.equal(child.status, 0, child.stdout + child.stderr)
      for (const id of selected) assert.match(child.stdout, new RegExp("ok  " + " " + id + "(?:\\n|$)"))
      assert.ok(child.stdout.includes("runtime parity: " + selected.length + "/" + selected.length))
    }
  } finally { rmSync(temp, { recursive: true, force: true }) }
}

test("runtime parity runs all runnable cases without selectors", () => runCli([]))
test("runtime parity keeps exact and substring selector matches", () => {
  runCli(["alpha"]); runCli(["alp"]); runCli(["alpha", "absent"])
})
test("runtime parity rejects a selector that matches no case", () => runCli(["absent"]))
test("runtime parity rejects an empty case corpus", () => runCli([], { ids: [] }))
test("runtime parity rejects a corpus containing only compile-only cases", () => runCli([], { runnable: false }))
test("runtime parity names every unmatched selector in an empty selection", () => runCli(["absent-a", "absent-b", 'quote"tag']))

test("generated unmatched selectors cannot certify an empty runtime run", async () => {
  await checkProperty(fc, {
    name: "mapper-runtime-empty-selection",
    rule: "Harness invariant: runtime-parity CLI succeeds only after selecting runnable cases; an empty selection exits2, names its selectors and creates no runtime output.",
    command: "node --test scripts/mapper-runtime-selection.test.mjs",
    arbitrary: fc.uniqueArray(fc.array(fc.constantFrom("a", "z", "0", "-", "_", '"', " ", "雪"), {
      minLength: 1, maxLength: 12
    }).map((chars) => "absent-" + chars.join("")), { minLength: 1, maxLength: 4 }),
    numRuns: 32,
    check: runCli
  })
})
