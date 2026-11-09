import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import fc from "fast-check"

const compiler = fileURLToPath(new URL("..", import.meta.url))
const require = createRequire(new URL("../../runtime/package.json", import.meta.url))
const ts = require("typescript")
const npm = process.platform === "win32" ? "npm.cmd" : "npm"
const witness = JSON.parse(readFileSync(new URL("./property-regressions/lang-site-register.json", import.meta.url), "utf8"))

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, encoding: "utf8", timeout: 120_000 })
  assert.equal(result.error, undefined, result.error?.message)
  assert.equal(result.status, 0, result.stdout + result.stderr)
  return result.stdout
}

test("packed register supports strict static and dynamic imports without inventing exports", { timeout: 240_000 }, async t => {
  const root = mkdtempSync(join(tmpdir(), "vibelang-register-package-"))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const consumer = join(root, "consumer")
  mkdirSync(consumer)
  writeFileSync(join(consumer, "package.json"), '{"private":true,"type":"module"}')
  const [packed] = JSON.parse(run(npm, ["pack", "--ignore-scripts", "--json", "--pack-destination", root], compiler))
  run(npm, ["install", "--ignore-scripts", "--omit=optional", "--legacy-peer-deps", "--no-audit", "--no-fund", join(root, packed.filename)], consumer)
  const file = join(consumer, "config.mts")
  const check = ({ source, resolution }) => {
    writeFileSync(file, source + '\ntype Registered = typeof import("vibelang/register")\nconst empty: keyof Registered extends never ? true : false = true\n')
    const options = {
      strict: true, noEmit: true, target: ts.ScriptTarget.ES2022,
      module: resolution === "Bundler" ? ts.ModuleKind.ESNext : ts.ModuleKind.NodeNext,
      moduleResolution: ts.ModuleResolutionKind[resolution]
    }
    const diagnostics = ts.getPreEmitDiagnostics(ts.createProgram([file], options))
    assert.deepEqual(diagnostics.map(d => ts.flattenDiagnosticMessageText(d.messageText, "\n")), [], resolution + ": " + source)
  }
  check(witness.input)
  await fc.assert(fc.asyncProperty(
    fc.record({
      source: fc.constantFrom('await import("vibelang/register")', 'import "vibelang/register"', 'import * as registration from "vibelang/register"; void registration'),
      resolution: fc.constantFrom("Bundler", "NodeNext")
    }),
    async input => check(input)
  ), { numRuns: 12 })
  assert.equal(run(process.execPath, ["--input-type=module", "-e", 'const module = await import("vibelang/register"); console.log(JSON.stringify(Object.keys(module)))'], consumer).trim(), "[]")
})
