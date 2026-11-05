import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs"
import { createRequire } from "node:module"
import { fileURLToPath } from "node:url"

const require = createRequire(new URL("../../../../docs/tools/package.json", import.meta.url))
const fc = require("fast-check")
const compiler = fileURLToPath(new URL("../../../../packages/compiler/bin/vibelang", import.meta.url))
const root = new URL("out/migration/", import.meta.url)
rmSync(root, { recursive: true, force: true })
const variants = [
  { startImmediately: true, uninterruptible: "inherit", value: 1 },
  ...[false, true].flatMap(startImmediately => [false, true, "inherit"].map(uninterruptible => ({ startImmediately, uninterruptible, value: 2 }))),
  ...fc.sample(fc.record({
    startImmediately: fc.boolean(),
    uninterruptible: fc.oneof(fc.boolean(), fc.constant("inherit")),
    value: fc.integer({ min: -1000, max: 1000 })
  }), { numRuns: 12, seed: 6 })
]
const source = 'import {Effect} from "effect"\nconst call = effect (n:number):number!! => n+1\n' +
  variants.map(({ startImmediately, uninterruptible, value }, index) =>
    'export const start' + index + ' = ():number!! => {\n const pending = fork(call(' + value + '),{startImmediately:' + startImmediately + ',uninterruptible:' + JSON.stringify(uninterruptible) + '})\n return join pending\n}\n'
  ).join("")
const mode = "vip"
const flags = ["--fix", "--fix-vip-only"]
const work = new URL(mode + "/", root)
mkdirSync(work, { recursive: true })
writeFileSync(new URL("package.json", work), '{"type":"module"}')
writeFileSync(new URL("tsconfig.json", work), JSON.stringify({
  compilerOptions: { target: "ES2022", module: "NodeNext", strict: true, types: [], skipLibCheck: true, noEmit: true },
  files: ["main.vibe"]
}))
const file = new URL("main.vibe", work)
writeFileSync(file, source)
function fix(stage, selected) {
  const started = performance.now()
  const result = spawnSync(process.execPath, [
    compiler, "-p", fileURLToPath(new URL("tsconfig.json", work)), ...selected, "--noEmit"
  ], { encoding: "utf8", timeout: 30000 })
  process.stderr.write("fork-codemod: " + mode + "/" + stage + " " + Math.round(performance.now() - started) + "ms status=" + result.status + "\n")
  assert.equal(result.status, 0, mode + "/" + stage + "\n" + result.stdout + result.stderr)
  return readFileSync(file, "utf8")
}
const text = fix("first", flags)
// VIP-6 requires native forkChild to retain the legacy options and program.
fc.assert(fc.property(fc.integer({ min: 0, max: variants.length - 1 }), index => {
  const value = variants[index]
  const start = text.search(new RegExp("export const start" + index + "\\b"))
  assert.ok(start >= 0, "missing start" + index)
  const next = text.indexOf("export const start", start + 1)
  const declaration = text.slice(start, next < 0 ? undefined : next)
  assert.match(declaration, new RegExp("start" + index + "\\s*=\\s*effect\\b"))
  assert.match(declaration, /try Effect\.forkChild\s*\(/)
  assert.match(declaration, new RegExp("call\\(" + value.value + "\\)"))
  assert.match(declaration, new RegExp("startImmediately\\s*:\\s*" + value.startImmediately + "\\b"))
  const option = typeof value.uninterruptible === "string" ? '["\x27]inherit["\x27]' : String(value.uninterruptible) + "\\b"
  assert.match(declaration, new RegExp("uninterruptible\\s*:\\s*" + option))
}), { numRuns: 128, seed: 6, examples: variants.map((_, index) => [index]) })
assert.equal(fix("repeat", flags), text, "repeating " + mode + " repairs changed source")

// Widening repair selection can also remove an unused explicit Effect
// import. Check the ordinary result's own fixed point separately.
const ordinary = fix("ordinary", ["--fix"])
assert.equal(fix("ordinary-repeat", ["--fix"]), ordinary, "ordinary cleanup is not idempotent")
console.log("legacy fork options preserved")
