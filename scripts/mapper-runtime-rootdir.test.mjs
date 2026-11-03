import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"
import { checkProperty } from "./testing/property.mjs"

const root = fileURLToPath(new URL("../", import.meta.url))
const require = createRequire(new URL("../packages/compiler/package.json", import.meta.url))
const fc = require("fast-check")
const version = JSON.parse(readFileSync(join(root, "packages/ts-mapper/package.json"), "utf8")).devDependencies.typescript
const stock = join(root, "packages/ts-mapper/test/.cache/typescript-" + version, "node_modules/typescript/bin/tsc")

function runCases(inputs, verifyBytes = false) {
  assert.ok(existsSync(stock), "Install the pinned mapper TypeScript before this test")
  const temp = mkdtempSync(join(tmpdir(), "vibelang-parity-rootdir-"))
  try {
    const cases = inputs.map(({ rootDir = ".", value = 42, nested = false, output = "out" }, i) => {
      const dir = join(temp, "fixtures", "group", "case-" + i)
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, "package.json"), '{"type":"module"}\n')
      const dependency = nested ? "lib/value" : "value"
      mkdirSync(dirname(join(dir, dependency + ".ts")), { recursive: true })
      writeFileSync(join(dir, dependency + ".ts"), "export const value: number = " + value + "\n")
      writeFileSync(join(dir, "main.ts"), "// expect-result: " + value + '\nimport { Effect } from "effect"\nimport { value } from "./' + dependency + '.js"\nexport const main = () => Effect.succeed(value)\n')
      writeFileSync(join(dir, "tsconfig.json"), JSON.stringify({ compilerOptions: {
        target: "ESNext", module: "NodeNext", moduleResolution: "NodeNext", outDir: output,
        ...(rootDir === null ? {} : { rootDir })
      }, files: ["main.ts", dependency + ".ts"] }))
      return { id: "case-" + i, dir }
    })
    const driver = join(temp, "driver.mjs"), config = join(temp, "config.json")
    writeFileSync(driver, 'import { runtimeParity } from ' + JSON.stringify(join(root, "packages/ts-mapper/test/parity/runtime.ts")) +
      '\nconst { cases, options } = JSON.parse(await Bun.file(process.argv[2]).text())\nconsole.log(JSON.stringify([...await runtimeParity(cases, options)]))\n')
    const outDir = join(temp, "output")
    writeFileSync(config, JSON.stringify({ cases, options: {
      jobs: 2, outDir, mapper: join(temp, "unused-mapper"), stockTsc: stock,
      effectDir: realpathSync(join(root, "experiments/node_modules/effect")), runtimeDir: join(root, "packages/runtime")
    } }))
    // Run outside both the repository and the case: output layout must not depend on harness CWD.
    const child = spawnSync("bun", [driver, config], { cwd: temp, encoding: "utf8", timeout: 30_000 })
    assert.equal(child.error, undefined, child.stdout + child.stderr)
    assert.equal(child.status, 0, child.stdout + child.stderr)
    const results = new Map(JSON.parse(child.stdout))
    assert.equal(results.size, inputs.length)
    for (const [i, { rootDir = ".", value = 42, nested = false, output = "out" }] of inputs.entries()) {
      const dir = join(outDir, "work/runtime/case-" + i)
      const row = results.get("case-" + i)
      assert.equal(row.ok, true, JSON.stringify(row))
      assert.equal(row.actual, String(value))
      assert.equal(row.detail, "")
      const names = ["main.js", nested ? "lib/value.js" : "value.js"]
      const emitted = (name) => join(dir, output, relative(resolve(dir, rootDir ?? "."), join(dir, name)))
      for (const name of names) assert.ok(existsSync(emitted(name)), "real compiler emitted " + name)
      if (verifyBytes) {
        const reference = join(temp, "reference-" + i)
        const compiled = spawnSync(stock, ["-p", "tsconfig.runtime.json", "--outDir", reference, "--pretty", "false"], {
          cwd: dir, encoding: "utf8", timeout: 30_000
        })
        assert.equal(compiled.status, 0, compiled.stdout + compiled.stderr)
        for (const name of names) {
          const rel = relative(resolve(dir, rootDir ?? "."), join(dir, name))
          assert.deepEqual(readFileSync(emitted(name)), readFileSync(join(reference, rel)), "runner preserves emitted module " + rel)
        }
      }
    }
  } finally { rmSync(temp, { recursive: true, force: true }) }
}

test("runtime parity retains inferred and explicit local rootDir layouts", () => runCases([{ rootDir: null }, { rootDir: "." }], true))
test("runtime parity follows an entry emitted below its parent rootDir", () => runCases([{ rootDir: ".." }], true))
test("runtime parity follows a grandparent rootDir and nested dependency", () => runCases([{ rootDir: "../..", nested: true }], true))
test("runtime parity uses rootDir paths under a custom output directory", () => runCases([{ rootDir: "..", output: "build/js", nested: true }], true))
test("concurrent rootDir layouts retain independent emitted entries", () => runCases([
  { rootDir: ".", value: 11 }, { rootDir: "..", value: 22 }, { rootDir: "../..", nested: true, value: 33 }
]))

test("generated rootDir layouts run the actual compiler-emitted entry", async () => {
  await checkProperty(fc, {
    name: "mapper-runtime-rootdir-entry",
    rule: "Harness invariant: resolve compiler rootDir against each copied case and execute the entry at its real path relative to outDir, independently of harness CWD.",
    command: "node --test scripts/mapper-runtime-rootdir.test.mjs",
    arbitrary: fc.array(fc.record({
      rootDir: fc.constantFrom(null, ".", "..", "../..", "./lib/.."),
      value: fc.integer({ min: -100, max: 100 }), nested: fc.boolean(),
      output: fc.constantFrom("out", "build/js")
    }), { minLength: 1, maxLength: 3 }),
    numRuns: 16,
    check: runCases
  })
})
