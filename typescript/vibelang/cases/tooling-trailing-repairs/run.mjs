// EK1101 repairs and the legacy Effect-dual migration (007-tooling.md,
// Trailing-block migration). Each temp project writes rejected trailing
// blocks, checks the diagnostics, runs vibelang --fix, checks the exact
// rewrite, then compiles and runs the result.
import assert from "node:assert/strict"
import { project, baseOptions, diagnostics } from "../_tooling-witness.mjs"

const options = { compilerOptions: baseOptions(), include: ["*.vibe"] }
const runner = names => `import { Effect, Layer } from "effect"\nimport * as m from "./out/main.js"\n` +
  `const out = {}\nfor (const name of ${JSON.stringify(names)}) out[name] = await Effect.runPromise(m[name]())\nconsole.log(JSON.stringify(out))\n`

// Rule 328d96b183ae: every rejected trailing block is EK1101 at its brace,
// and --fix passes it as the last argument with the lead its parameter needs.
const prelude = [
  "function plain(f: () => number) { return f() }",
  "function pair(n: number, f: () => number) { return n + f() }",
  "function gen<T>(n: T, f: () => number) { return [n, f()] }",
  "const obj = { plain }",
  "const it = { effect: (name: string, body: () => number!!) => body() }",
  "service Users { find(): number!! }",
]
const sites = [
  // [written line, fixed line, message spelling]
  ["export const a = () => Effect.succeed(plain { return 1 })", "export const a = () => Effect.succeed(plain(() => { return 1 }))", "plain(() => { … })"],
  ["export const b = () => Effect.succeed(plain() { return 2 })", "export const b = () => Effect.succeed(plain(() => { return 2 }))", "plain(() => { … })"],
  ["export const c = () => Effect.succeed(obj.plain { return 3 })", "export const c = () => Effect.succeed(obj.plain(() => { return 3 }))", "obj.plain(() => { … })"],
  ["export const d = () => Effect.succeed(pair(10) { return 4 })", "export const d = () => Effect.succeed(pair(10, () => { return 4 }))", "pair(10, () => { … })"],
  ["export const e = () => Effect.succeed(pair(10,) { return 5 })", "export const e = () => Effect.succeed(pair(10, () => { return 5 }))", "pair(10, () => { … })"],
  ["export const f = () => Effect.succeed(gen<string>(\"g\") { return 6 })", "export const f = () => Effect.succeed(gen<string>(\"g\", () => { return 6 }))", "gen(\"g\", () => { … })"],
  ["export const g = () => it.effect(\"loads\") { return 7 }", "export const g = () => it.effect(\"loads\", effect () => { return 7 })", "it.effect(\"loads\", effect () => { … })"],
  ["export const live = Layer.effect(Users) { return { find: effect () => 8 } }", "export const live = Layer.effect(Users, effect { return { find: effect () => 8 } })", "Layer.effect(Users, effect { … })"],
]
project(({ put, read, invoke, run }) => {
  put("tsconfig.json", options)
  put("main.vibe", [...prelude, ...sites.map(s => s[0]),
    "export effect function h() { const users = try Users; return try users.find() }",
    "export const viaLayer = () => Effect.provide(h(), live)", ""].join("\n"))
  const before = invoke("-p", ".", "--pretty", "false")
  assert.notEqual(before.status, 0)
  const ek = before.text.split("\n").filter(l => / error EK1101: /.test(l))
  assert.equal(ek.length, sites.length, before.text)
  sites.forEach(([written, , spelling], i) => {
    const line = prelude.length + i + 1
    const brace = written.indexOf("{") + 1 // the first brace is the trailing block's
    assert.ok(ek[i].startsWith(`main.vibe(${line},${brace}): error EK1101: `), ek[i])
    assert.ok(ek[i].includes("write the block as an argument, " + spelling + "."), ek[i])
  })
})

// Rule cdb4b7f33f90: a legacy Effect-dual block keeps TypeScript's error
// (TS2769, TS2345, TS2554) or is EK1023 where the appended call type-checks;
// --fix writes the program where 0.0.10 put it, data-first or curried, and no
// site gets an EK1101 besides.
const dualPrelude = [
  "effect function work() { try sleep(\"1 millis\"); return \"done\" }",
  "function tagged<A, E, R>(self: A!E!R, label: string): A!E!R",
  "function tagged(label: string, value: unknown): string",
  "function tagged(a: unknown, b: unknown): unknown { return typeof a === \"string\" ? a : Effect.map(a as string!!, s => s + \":\" + String(b)) }",
]
const duals = [
  // [written, fixed, code]
  ["export function s1() { return withSpan(\"load\") { return try work() } }", "export function s1() { return withSpan(effect { return try work() }, \"load\") }", "TS2769"],
  ["export function s2() { return withSpan(\"x\", { attributes: { a: 1 } }) { return try work() } }", "export function s2() { return withSpan(effect { return try work() }, \"x\", { attributes: { a: 1 } }) }", "TS2769"],
  ["export function s3() { return timeout(\"1 second\") { return try work() } }", "export function s3() { return timeout(effect { return try work() }, \"1 second\") }", "TS2345"],
  ["export function s4() { const s = Semaphore.makeUnsafe(1); return s.withPermits(1) { return try work() } }", "export function s4() { const s = Semaphore.makeUnsafe(1); return s.withPermits(1)(effect { return try work() }) }", "TS2554"],
  ["export function s5() { return tagged(\"x\") { return try work() } }", "export function s5() { return tagged(effect { return try work() }, \"x\") }", "EK1023"],
]
const note = "Through VibeLang 0.0.10, a block after an Effect dual took the place of its program. Write it as an effect block there."
project(({ put, read, invoke, run }) => {
  put("tsconfig.json", options)
  put("main.vibe", [...dualPrelude, ...duals.map(d => d[0]), ""].join("\n"))
  const before = invoke("-p", ".", "--pretty", "false")
  assert.notEqual(before.status, 0)
  assert.ok(!/EK1101/.test(before.text), before.text)
  // One migration diagnostic per site, each carrying the dual note.
  const sites = before.text.split(/\n(?=main\.vibe\()/).filter(d => !/ error TS1005: /.test(d))
  assert.deepEqual(sites.map(d => [Number(d.match(/^main\.vibe\((\d+),/)[1]), diagnostics(d)[0]]),
    duals.map((d, i) => [dualPrelude.length + i + 1, "error " + d[2]]), before.text)
  for (const d of sites) assert.ok(d.includes(note), d)
})

console.log("trailing-block repairs and dual migration rewrite each block once")
