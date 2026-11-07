// The retired trustedPackages key is ignored with warning EK3010 in the vibe
// section and in the legacy root vibelang and compilerOptions.vibelang
// sections, whatever its value and wherever extends puts it. An npm
// function's calls are checked as a local TypeScript function's are: no
// @throws means unknown failures (EK0403 in effect code, an unknown catch
// variable in plain code); @throws {SyntaxError} names the failure;
// @throws {never} is a signature contract that needs no wrapper; an explicit
// Effect.try bridge is clean.
import assert from "node:assert/strict"
import { project, baseOptions } from "../_tooling-witness.mjs"

const line = /^(\S+?)\((\d+),(\d+)\): (error|warning|suggestion) ((?:EK|TS)\d+): (.*)$/gm
const parse = text => [...text.matchAll(line)].map(m => ({ file: m[1], at: m[2] + "," + m[3], text: m[4] + " " + m[5] + ": " + m[6] }))
const ek3010 = "warning EK3010: trustedPackages is deprecated and ignored; remove this retired option. Use a signature contract or an explicit Effect.try boundary for foreign calls."
const contract = "/** @throws {SyntaxError} */\nexport declare function annotated(text: string): number\nexport declare function plain(text: string): number\n/** @throws {never} */\nexport declare function safe(text: string): number\n"
const implementation = contract.replace(/declare /g, "").replace(/: number\n/g, ": number { return JSON.parse(text) }\n")
const js = "export function annotated(t) { return JSON.parse(t) }\nexport function plain(t) { return JSON.parse(t) }\nexport function safe(t) { return t.length }\n"
// Only line 1 names the module, so every other diagnostic position is
// independent of the import.
const body = from => `import { annotated, plain, safe } from "${from}"
export effect function useAnnotated() { return annotated("1") }
export effect function usePlain() { return plain("1") }
export effect function useSafe() { return safe("1") }
export effect function bridged() { return try orDie(Effect.try({ try: () => plain("1"), catch: e => e })) }
export function typed() { try { return annotated("1") } catch (e) { const m: string = e.message; return m } }
export function untyped() { try { return plain("1") } catch (e) { const m: string = e.message; return m } }
export function direct() { return plain("1") }
`
const compile = (from, extra = {}, base) => project(({ put, invoke }) => {
  put("node_modules/pkg/package.json", { name: "pkg", type: "module", exports: { ".": { types: "./index.d.ts", default: "./index.js" } } })
  put("node_modules/pkg/index.d.ts", contract)
  put("node_modules/pkg/index.js", js)
  put("lib.ts", implementation)
  put("decl.d.ts", contract)
  put("decl.js", js)
  put("main.vibe", body(from))
  if (base) put("base.json", base)
  put("tsconfig.json", { ...(base ? { extends: "./base.json" } : {}), ...extra, compilerOptions: { ...baseOptions(), ...(extra.compilerOptions ?? {}) }, files: ["main.vibe", "lib.ts"] })
  const r = invoke("-p", ".", "--pretty", "false")
  const all = parse(r.text)
  return { status: r.status, main: all.filter(d => d.file === "main.vibe").map(d => d.at + " " + d.text), config: all.filter(d => d.file !== "main.vibe").map(d => d.file + " " + d.text), text: r.text }
})

// The npm package, a local TypeScript source and a local declaration agree
// diagnostic for diagnostic.
const npm = compile("pkg")
assert.deepEqual(npm.config, [], npm.text)
const at = npm.main.map(d => d.split(" ").slice(0, 3).join(" "))
assert.deepEqual(at, ["2,48 error EK0403:", "3,44 error EK0403:", "7,85 error TS18046:"], npm.text)
assert.match(npm.main[0], /'annotated' may throw 'SyntaxError'/)
assert.match(npm.main[1], /An unwrapped call, new expression, tagged template or class evaluation that may throw, in effect code\./)
assert.match(npm.main[2], /'e' is of type 'unknown'/)
for (const from of ["./lib.js", "./decl.js"]) {
  const local = compile(from)
  assert.deepEqual(local.main, npm.main, from + "\n" + local.text)
  assert.equal(local.status, npm.status)
}

// trustedPackages, in each section and extended, with any value: one EK3010
// at the key, and the npm calls are still checked exactly as without it.
const sections = [
  ["vibe", value => ({ vibe: { trustedPackages: value } })],
  ["root vibelang", value => ({ vibelang: { trustedPackages: value } })],
  ["compilerOptions.vibelang", value => ({ compilerOptions: { vibelang: { trustedPackages: value } } })],
]
for (const [name, section] of sections) for (const value of [["pkg"], [], "pkg", 1, null]) {
  const r = compile("pkg", section(value))
  assert.deepEqual(r.config, ["tsconfig.json " + ek3010], name + " " + JSON.stringify(value) + "\n" + r.text)
  assert.deepEqual(r.main, npm.main, name + "\n" + r.text)
  assert.equal(r.status, npm.status)
  const inherited = compile("pkg", {}, section(value))
  assert.deepEqual(inherited.config, ["base.json " + ek3010], name + " extended\n" + inherited.text)
  assert.deepEqual(inherited.main, npm.main, name + " extended\n" + inherited.text)
}
// EK3010 is a warning: alone it leaves the exit status 0; it is an own
// warning, so severities can raise or silence it.
project(({ put, invoke }) => {
  for (const [vibe, status, want] of [[{ trustedPackages: ["pkg"] }, 0, ["warning EK3010"]], [{ trustedPackages: ["pkg"], severities: { EK3010: "off" } }, 0, []], [{ trustedPackages: ["pkg"], severities: { EK3010: "error" } }, 2, ["error EK3010"]]]) {
    put("main.vibe", "export const a = 1\n")
    put("tsconfig.json", { compilerOptions: baseOptions(), files: ["main.vibe"], vibe })
    const r = invoke("-p", ".", "--pretty", "false")
    assert.equal(r.status, status, r.text)
    assert.deepEqual(parse(r.text).map(d => d.text.split(":")[0]), want, r.text)
  }
})
console.log("trustedPackages is ignored with EK3010; npm functions follow the local TypeScript foreign-callable contract")
