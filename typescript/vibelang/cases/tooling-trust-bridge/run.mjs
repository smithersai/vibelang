// Chapter 7, Empty legacy trust wrappers: vibelang --fix rewrites each
// private direct synchronous call of a trusted(f, []) wrapper in an explicit
// Effect body to Effect.orDie(Effect.try({ try, catch: (e) => e })) over f,
// reads f once where the wrapper was declared, and keeps results, the exact
// thrown value as the defect, and the declarations. It refuses wrappers it
// cannot prove: exported, escaping, or called from plain code.
import assert from "node:assert/strict"
import { project, baseOptions } from "../_tooling-witness.mjs"

const plain = `export const thrown = { marker: "exact" }
let captures = 0
const integer = (n: number): number => {
  if (n < 0) throw thrown
  return n * 2
}
export const Dialect = { get integer() { captures++; return integer } }
export const captureCount = () => captures
`
const lib = `import { trusted } from "vibelang-runtime"
import { Dialect } from "./plain.ts"

const doubled = trusted(Dialect.integer, [])
export effect function value(n: number): number!! {
  return doubled(n)
}
export effect function twice(n: number): number!! {
  return doubled(n) + doubled(n)
}
export effect function local(n: number): number!! {
  const tripled = trusted(Dialect.integer, [])
  return tripled(n) + n
}
`
// Wrappers whose preservation the migration cannot prove stay as written.
const refused = {
  "exported.vibe": `import { trusted } from "vibelang-runtime"\nexport const safe = trusted(Math.max, [])\n`,
  "escaped.vibe": `import { trusted } from "vibelang-runtime"\nconst safe = trusted(Math.max, [])\nexport const escaped = [safe]\n`,
  "plaincall.vibe": `import { trusted } from "vibelang-runtime"\nconst safe = trusted(Math.max, [])\nexport function f() { return safe(1, 2) }\n`,
}
const runner = `import { Effect, Exit } from "effect"
import { value, twice, local } from "./lib.js"
import { thrown, captureCount } from "./plain.js"
const loaded = captureCount()
const exit = async e => {
  const x = await Effect.runPromiseExit(e)
  return Exit.isSuccess(x) ? { value: x.value } : { reasons: x.cause.reasons.map(r => r._tag + (r._tag === "Die" ? ":" + (r.defect === thrown) : "")) }
}
const results = { loaded, value: await exit(value(4)), twice: await exit(twice(3)), local: await exit(local(5)), failed: await exit(value(-1)), localFailed: await exit(local(-1)), captures: captureCount() }
console.log(JSON.stringify(results))
`
const expected = { loaded: 1, value: { value: 8 }, twice: { value: 12 }, local: { value: 15 }, failed: { reasons: ["Die:true"] }, localFailed: { reasons: ["Die:true"] }, captures: 3 }
const errors = text => [...text.matchAll(/^(\S+)\(\d+,\d+\): error ((?:EK|TS)\d+)/gm)].map(m => m[1] + " " + m[2])

project(({ put, read, invoke, run }) => {
  put("tsconfig.json", { compilerOptions: { ...baseOptions(), declaration: true, rewriteRelativeImportExtensions: true }, include: ["*.vibe", "*.ts"] })
  put("plain.ts", plain)
  put("lib.vibe", lib)
  for (const [file, text] of Object.entries(refused)) put(file, text)
  invoke("-p", ".", "--pretty", "false") // the legacy wrapper still emits
  const declarations = read("out/lib.d.ts")
  put("out/run.mjs", runner)
  const before = run(process.execPath, ["out/run.mjs"])
  assert.equal(before.status, 0, before.text)
  assert.deepEqual(JSON.parse(before.stdout), expected, "legacy behavior")

  const fix = invoke("--fix", "-p", ".", "--pretty", "false")
  assert.equal(fix.status, 0, fix.text)
  const fixed = read("lib.vibe")
  assert.ok(!/trusted\(Dialect\.integer, \[\]\)/.test(fixed), "the empty wrapper is retired:\n" + fixed)
  // Each call becomes the identity-mapped bridge over the captured f.
  const bridge = name => new RegExp(String.raw`try (?:Effect\.)?orDie\(Effect\.try\(\{ try: \(\) => ${name}\(n\), catch: \(e\) => e \}\)\)`, "g")
  assert.equal(fixed.match(bridge("doubled"))?.length, 3, "three doubled calls bridged:\n" + fixed)
  assert.equal(fixed.match(bridge("tripled"))?.length, 1, "the local call bridged:\n" + fixed)
  // f is read where the wrapper was declared, once per declaration.
  assert.match(fixed, /^const doubled_impl = \(void trusted, Dialect\.integer\), doubled: typeof doubled_impl = /m)
  assert.match(fixed, /^  const tripled_impl = \(void trusted, Dialect\.integer\), tripled: typeof tripled_impl = /m)
  for (const [file, text] of Object.entries(refused)) assert.equal(read(file), text, file + " is refused")

  assert.deepEqual(errors(invoke("-p", ".", "--pretty", "false").text).filter(e => e.startsWith("lib.vibe")), [], "the bridge compiles")
  assert.equal(read("out/lib.d.ts"), declarations, "declarations unchanged")
  const after = run(process.execPath, ["out/run.mjs"])
  assert.equal(after.status, 0, after.text)
  assert.deepEqual(JSON.parse(after.stdout), expected, "migrated behavior")
})
console.log("empty legacy trust wrappers: bridge preserves results, defects, captures and declarations")
