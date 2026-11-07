// Every VibeLang rule the compiler enforces prints the EK code Appendix B
// assigns it: each printed EK code is a live Appendix B row with the row's
// category, never a retired code, and each sampled violation prints the code
// of the rule it breaks.
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { project, diagnostics } from "../_tooling-witness.mjs"

const appendix = readFileSync(new URL("../../../../docs/design/src/900-appendices.md", import.meta.url), "utf8")
const sectionB = appendix.slice(appendix.indexOf("## Appendix B. Diagnostics"))
// rows: code -> category ("warning", "suggestion" or "error") from the row's rule text.
const rows = new Map()
// Interim transitional rows read "| interim `EK92xx` | error: …".
for (const m of sectionB.matchAll(/^\| (?:interim )?`(EK\d+)` \| ([^|]*)\|/gm)) {
  const rule = m[2].trim()
  const category = /^(lint )?warning\b/i.test(rule) ? "warning" : /^suggestion\b/i.test(rule) ? "suggestion" : /^off by default\b/i.test(rule) ? "warning" : "error"
  if (!rows.has(m[1])) rows.set(m[1], category)
}
const retired = new Set([...sectionB.matchAll(/The old `(EK\d+)` is retired/g)].map(m => m[1]))
assert.ok(rows.size > 100, "Appendix B parses")

// [the code of the broken rule, its source]
const samples = [
  ["EK0101", "effect load() { return 1 }"],
  ["EK0104", "class C { effect get value() { return 1 } }"],
  ["EK0108", "interface I { effect load(): number!! }"],
  ["EK0301", "type X = string | number!Error"],
  ["EK0302", "type X = number!!string!boolean"],
  ["EK0401", 'function load(): number!! { throw new Error("bad") }'],
  ["EK0403", 'export effect function load() { return JSON.parse("1") }'],
  ["EK0404", "declare function load(): Promise<number>\nexport effect function run() { return load() }"],
  ["EK0406", "/** @throws {never} */ export effect function load() { return 1 }"],
  ["EK0503", "export effect function load() { try { return 1 } catch { return 0 } }"],
  ["EK0506", "export effect function load() { return 1 catch () => 0 }"],
  ["EK0508", 'export effect function load() { return Effect.fail("bad") catch () => Effect.succeed(0) }'],
  ["EK0801", "declare const resource: Disposable\nexport effect function load() { using r = resource; return 1 }"],
  ["EK0903", "service Users { name: string }"],
  ["EK0906", "service Users"],
  ["EK1306", "error Bad { a: number b: string }"],
  ["EK1501", "export default schema User { name: string }"],
  ["EK1604", "data Value"],
  ["EK1703", "export effect function load() { return fork 1 }"],
  ["EK1901", "export effect function load() { for concurrent (const n of 1) { void n } }"],
  ["EK2104", "export effect function load() { yield 1 }"],
  ["EK2201", "export function load() { uninterruptible {} }"],
  ["EK3003", 'service Users { static readonly key = "app/Users"; name: string }\nconst x = new Users()'],
  ["EK4834", "export effect function load() { return try Effect.succeed(1) }"],
]

const printed = new Set()
for (const [code, source] of samples) project(({ put, invoke }) => {
  put("main.vibe", source + "\n")
  put("tsconfig.json", { compilerOptions: { target: "es2022", lib: ["esnext", "dom"], module: "esnext", moduleResolution: "bundler", strict: true, skipLibCheck: true, types: [], noEmit: true }, include: ["*.vibe"] })
  const r = invoke("-p", ".", "--pretty", "false")
  const found = diagnostics(r.text).filter(d => d.includes(" EK"))
  assert.ok(found.some(d => d.endsWith(" " + code)), code + ": the broken rule prints its code\n" + r.text)
  for (const d of found) {
    const [category, printedCode] = d.split(" ")
    printed.add(printedCode)
    assert.ok(!retired.has(printedCode), printedCode + " is retired\n" + r.text)
    assert.ok(rows.has(printedCode), printedCode + " has no Appendix B row\n" + r.text)
    assert.equal(category, rows.get(printedCode), printedCode + " category differs from Appendix B\n" + r.text)
  }
})
assert.ok(printed.size >= samples.length, [...printed].join())
console.log("each sampled VibeLang rule prints its Appendix B EK code and category")
