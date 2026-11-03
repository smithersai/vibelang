// run-seconds: 180
import assert from "node:assert/strict"
import { mkdtempSync, writeFileSync, readFileSync, symlinkSync, rmSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { spawnSync } from "node:child_process"
const here = dirname(fileURLToPath(import.meta.url))
const compiler = resolve(here, "../../../built/local/tsc")
const dir = mkdtempSync(join(here, ".pattern-fix-"))
try {
  symlinkSync(join(here, "node_modules"), join(dir, "node_modules"), "dir")
  writeFileSync(join(dir, "package.json"), '{"type":"module"}')
  writeFileSync(join(dir, "tsconfig.json"), JSON.stringify({ compilerOptions: { target: "ES2022", module: "NodeNext", strict: true, skipLibCheck: true, types: [], outDir: "out" }, include: ["*.vibe", "*.ts"] }))
  // Native values make getter order, predicate hints and matcher identity observable.
  writeFileSync(join(dir, "native.ts"), `import { customMatcher } from "vibelang-runtime"
export const trace: unknown[] = []
export const token: object = {}
export const holder = { get p(): Function { trace.push("read"); return (s:unknown,hint:{matchType:string}) => {trace.push([s,hint.matchType]); return s===7} } }
export const extraction: object = { [customMatcher](s:unknown,hint:{matchType:string}) { trace.push(["extract",s,hint.matchType]); return s===9 ? [s,10] : false } }
export const reset = () => {trace.length=0}
`)
  const source = `import { token, holder, extraction, trace } from "./native.js"
export function bare(s:unknown) { return match(s){ when holder["p"]:1; default:0; } }
export function identity(s:unknown) { return s is token }
export function extract(s:unknown) { return match(s){when extraction(let x,...let xs):[x,xs];default:false;} }
export function snapshot(){return trace.slice()}
`
  writeFileSync(join(dir, "main.vibe"), source)
  const run = (...args) => spawnSync(compiler, ["-p", dir, "--pretty", "false", ...args], { encoding: "utf8", timeout: 120000 })
  const before = run("--noEmit")
  assert.equal(before.status, 2, before.stdout + before.stderr)
  assert.equal((before.stdout.match(/error EK0702:/g) || []).length, 3, before.stdout)
  const fixed = run("--fix")
  assert.equal(fixed.status, 0, fixed.stdout + fixed.stderr)
  const text = readFileSync(join(dir, "main.vibe"), "utf8")
  assert.match(text, /\$patternIs/)
  assert.match(text, /\$patternExtract/)
  const again = run("--fix")
  assert.equal(again.status, 0, again.stdout + again.stderr)
  assert.equal(readFileSync(join(dir, "main.vibe"), "utf8"), text)
  const native = await import(pathToFileURL(join(dir, "out/native.js")))
  const main = await import(pathToFileURL(join(dir, "out/main.js")))
  assert.equal(main.bare(7), 1)
  assert.equal(main.bare(8), 0)
  assert.equal(main.identity(native.token), true)
  assert.equal(main.identity({}), false)
  assert.deepEqual(main.extract(9), [9, [10]])
  assert.equal(main.extract(8), false)
  assert.deepEqual(main.snapshot(), ["read",[7,"boolean"],"read",[8,"boolean"],["extract",9,"extractor"],["extract",8,"extractor"]])
  console.log("dynamic matching and extraction preserved")
} finally { rmSync(dir, { recursive: true, force: true }) }
