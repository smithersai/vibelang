// EK1101's native-recovery boundary and the forms outside it (007-tooling.md,
// Trailing-block migration). Each .vibe source is compared with its .ts twin
// under the same compiler and under stock TypeScript.
import assert from "node:assert/strict"
import { project, baseOptions } from "../_tooling-witness.mjs"

const head = "function f(cb?: () => number) { return cb ? cb() : 0 }\nconst obj = { f }\n"
// printed(text, file) lists "line,col code message" for file's diagnostics.
const printed = (text, file) => [...text.matchAll(/^([\w.]+)\((\d+),(\d+)\): error ((?:EK|TS)\d+): (.*)$/gm)]
  .filter(m => m[1] === file).map(m => ({ at: m[2] + "," + m[3], code: m[4], message: m[5] }))
const key = d => `${d.at} ${d.code} ${d.message}`

// twins(bodies) compiles each body as v<i>.vibe and t<i>.ts, and the .ts twins
// with stock TypeScript too, and returns [vibe, native] diagnostics per body.
function twins(bodies) {
  const options = { compilerOptions: { ...baseOptions(), noEmit: true } }
  const write = (put, ext, prefix) => bodies.forEach((b, i) => put(`${prefix}${i}.${ext}`, head + b + "\n"))
  const native = project(({ put, stock }) => {
    put("tsconfig.json", { ...options, include: ["*.ts"] })
    write(put, "ts", "t")
    const text = stock("-p", ".", "--pretty", "false").text
    return bodies.map((_, i) => printed(text, `t${i}.ts`))
  })
  return project(({ put, invoke }) => {
    put("tsconfig.json", { ...options, include: ["*.vibe", "*.ts"] })
    write(put, "vibe", "v")
    write(put, "ts", "t")
    const text = invoke("-p", ".", "--pretty", "false").text
    return bodies.map((_, i) => {
      const twin = printed(text, `t${i}.ts`)
      // The compiler under test is TypeScript on the .ts twin.
      assert.deepEqual(twin.map(key), native[i].map(key), `t${i}.ts differs from stock TypeScript`)
      return [printed(text, `v${i}.vibe`), twin]
    })
  })
}

// Rule 5bd477be0df0: per rejection, one EK1101 replaces only the native
// "';' expected" or "',' expected" at its brace; every other native error,
// including another TS1005 at that brace, remains.
const rejected = [
  // [source, EK1101 count, native separator errors it replaces]
  ["export function a() { return f() { return 1 } }", 1, 1], // ';' at the brace
  ["export const b = [f() { return 1 }]", 1, 1], // ',' at the brace, ':' after it
  ["if (f() { return 1 }) {}", 1, 0], // ')' at the brace stays
  ["export function d() { return f() { return 1 } }\nconst x = ;", 1, 1], // TS1109 elsewhere stays
  ["export const o = { value: f() { return 1 } }", 1, 1],
  ["switch (f() { return 1 }) {}", 1, 0], // ')' at the brace stays
  ["export const v = f() { return 1 } + 1", 1, 1],
  ["g(f() { return 1 })", 1, 1],
  ["export function e() { return obj.f { return 1 } }", 1, 1],
  ["export function h() { return [f(1) { return 1 }, f() { return 2 }] }", 2, 2], // two rejections
]
let kept = 0
twins(rejected.map(r => r[0])).forEach(([vibe, twin], i) => {
  const [source, count, replaced] = rejected[i]
  const braces = vibe.filter(d => d.code === "EK1101").map(d => d.at)
  assert.equal(braces.length, count, source + "\n" + vibe.map(key).join("\n"))
  const redundant = d => d.code === "TS1005" && braces.includes(d.at) && /^'[;,]' expected\.$/.test(d.message)
  assert.equal(twin.filter(redundant).length, replaced, source)
  const want = twin.filter(d => !redundant(d)).map(key)
  assert.deepEqual(vibe.filter(d => d.code !== "EK1101").map(key), want, source)
  if (replaced === 0) assert.ok(want.some(d => d.startsWith(braces[0] + " TS1005 ")), source)
  kept += want.length
})
assert.equal(kept, 17, "the table keeps its independent native errors")

// Rule 7f2ad3748e95: a newline before the block, an optional chain and a
// heritage clause are not trailing blocks: no EK1101, TypeScript's own
// diagnostics, and --fix leaves the source alone.
const outside = [
  "export function n1() { let calls = 0; const g = () => { calls++ }; g()\n{ g() }; return calls }",
  "export function n2() { let calls = 0; const g = () => { calls++ }; g() // line\n{ g() }; return calls }",
  "export function n3() { return f\n{ f() } }",
  "export function o1() { return f?.() { return 1 } }",
  "export function o2() { return obj?.f() { return 1 } }",
  "export function o3() { return obj?.f { return 1 } }",
  "function base() { return class { k = 1 } }\nexport class C extends base() {}",
]
twins(outside).forEach(([vibe, twin], i) => {
  assert.ok(!vibe.some(d => d.code === "EK1101"), outside[i])
  assert.deepEqual(vibe.map(key), twin.map(key), outside[i])
})

// The newline and heritage forms are ordinary code that compiles and runs;
// so are provide headers whose last provider is a call before the block.
project(({ put, read, invoke, run }) => {
  put("tsconfig.json", { compilerOptions: baseOptions(), include: ["*.vibe"] })
  const source = [head, outside[0], outside[1], outside[6],
    "service Users { static readonly key = \"witness-Users\"; find(): number!! }",
    "function usersLive(n: number) { return Layer.succeed(Users, { find: () => Effect.succeed(n) }) }",
    "function plainLive() { return Layer.empty }",
    "effect function find() { const users = try Users; return try users.find() }",
    "export effect function p1() { provide usersLive(41) { return try find() } }",
    "export effect function p2() { provide plainLive(), usersLive(42) { return try find() } }", ""].join("\n")
  put("main.vibe", source)
  const first = invoke("-p", ".", "--pretty", "false")
  assert.equal(first.status, 0, first.text)
  put("run.mjs", `import { Effect } from "effect"\nimport * as m from "./out/main.js"\n` +
    `console.log(JSON.stringify([m.n1(), m.n2(), new m.C().k, await Effect.runPromise(m.p1()), await Effect.runPromise(m.p2())]))\n`)
  assert.equal(run(process.execPath, ["run.mjs"]).stdout.trim(), "[2,2,1,41,42]")
})

console.log("EK1101 replaces only its own separator error; boundary forms stay native")
