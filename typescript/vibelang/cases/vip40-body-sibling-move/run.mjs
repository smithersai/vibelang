import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

const compiler = process.env.VIBELANG_BINARY || fileURLToPath(new URL("../../../built/local/tsc", import.meta.url))
const effect = fileURLToPath(new URL("./node_modules/effect", import.meta.url))
const jsxTypes = "declare namespace JSX { interface Element { tag: unknown } interface IntrinsicElements { b: {} } }\n" +
  "declare namespace React { function createElement(tag: unknown, props: unknown, ...children: unknown[]): JSX.Element }\n"

// Each body is an ordinary TypeScript module; `script` bodies have no import
// or export, so their sibling copy needs the empty module marker.
const corpus = [
  { name: "declarations", body: [
    "/** Reads a port. @throws {RangeError} when the text is not a port */",
    "export function port(raw: string): number {",
    "  const n = Number(raw)",
    "  if (!(n >= 1 && n <= 65535)) throw new RangeError(`bad port: ${raw}`)",
    "  return n",
    "}",
    "export enum Mode { Read, Write }",
    "export namespace Limits { export const max = 65535 }",
    "export class Box { constructor(public readonly value: number) {} }",
    "export let counter = 0",
    "export function bump(): number { return ++counter }",
    "export type Pair = readonly [string, number]",
    "export const observe = () => [port(\"80\"), Mode.Write, Limits.max, new Box(3).value, bump(), counter]",
  ] },
  { name: "type-errors", body: [
    "export const wrong: number = \"text\"",
    "export function missing(): string { return undefinedName }",
    "export const observe = () => [wrong]",
  ] },
  { name: "top-level-await", body: [
    "const settled = await Promise.resolve(42)",
    "export const observe = () => [settled]",
  ] },
  { name: "script", script: true, body: [
    "const privateBodyValue = 7",
    "const store = globalThis as unknown as { bodyRuns?: number[] }",
    "store.bodyRuns = [...(store.bodyRuns ?? []), privateBodyValue]",
  ] },
  { name: "jsx", jsx: true, body: [
    "export const element = <b />",
    "export const observe = () => [typeof element]",
  ] },
]

const run = (cwd, args) => {
  const r = spawnSync(compiler, args, { cwd, encoding: "utf8", timeout: 60000 })
  assert.equal(r.error, undefined)
  return r
}
const diagnostics = (output, file, offset) => output.split("\n").flatMap((line) => {
  const m = /^([^(\s]+)\((\d+),(\d+)\): (error|warning) ((?:TS|EK)\d+): (.*)$/.exec(line)
  return m ? [{ file: m[1] === file ? "body" : m[1], line: Number(m[2]) - (m[1] === file ? offset : 0), column: Number(m[3]), category: m[4], code: m[5], text: m[6] }] : []
})
const strip = (text) => text.replace(/\n\/\/# sourceMappingURL=[^\n]*\n?$/, "\n")

function project(item, form) {
  const dir = mkdtempSync(join(tmpdir(), "vip40-move-" + item.name + "-"))
  mkdirSync(join(dir, "node_modules"))
  symlinkSync(effect, join(dir, "node_modules/effect"))
  writeFileSync(join(dir, "package.json"), '{"type":"module"}')
  const ext = item.jsx ? "x" : ""
  const parent = "main.vibe" + ext
  writeFileSync(join(dir, "tsconfig.json"), JSON.stringify({ compilerOptions: {
    target: "es2022", module: "nodenext", moduleResolution: "nodenext", strict: true, types: [], skipLibCheck: true,
    declaration: true, noEmitOnError: false, rewriteRelativeImportExtensions: true, outDir: "out",
    ...(item.jsx ? { jsx: "react" } : {}) }, files: [parent, ...(item.jsx ? ["jsx.d.ts"] : [])] }))
  if (item.jsx) writeFileSync(join(dir, "jsx.d.ts"), jsxTypes)
  const specifier = form === "body" ? "parse" : JSON.stringify("./parse.ts" + (item.jsx ? "x" : ""))
  const use = item.script ? `import ${specifier}\n` : `export * from ${specifier}\n`
  if (form === "body") writeFileSync(join(dir, parent), "module parse {\n" + item.body.join("\n") + "\n}\n" + use)
  else {
    writeFileSync(join(dir, "parse.ts" + ext), item.body.join("\n") + "\n" + (item.script ? "export {}\n" : ""))
    writeFileSync(join(dir, parent), use)
  }
  const compiled = run(dir, ["-p", "tsconfig.json", "--pretty", "false"])
  const bodyFile = form === "body" ? parent : "parse.ts" + ext
  const out = (name) => readFileSync(join(dir, "out", name), "utf8")
  const js = ".js"
  const bodyOut = form === "body" ? parent + ".parse" : "parse"
  const observed = spawnSync(process.execPath, ["--preserve-symlinks", "--input-type=module", "-e",
    `globalThis.React = { createElement: (tag) => ({ tag }) }; const m = await import(${JSON.stringify(join(dir, "out", "main" + js))}); const s = globalThis; console.log(JSON.stringify({ keys: Object.keys(m).sort(), observed: m.observe?.() ?? null, runs: s.bodyRuns ?? null }))`],
    { encoding: "utf8" })
  assert.equal(observed.status, 0, observed.stderr)
  const result = {
    diagnostics: diagnostics(compiled.stdout + compiled.stderr, bodyFile, form === "body" ? 1 : 0),
    js: strip(out(bodyOut + js)),
    dts: strip(out(bodyOut + ".d.ts")),
    // The one intended difference: `from parse` became the copy's string specifier.
    parent: strip(out("main.d.ts")).replace(/"\.\/(?:main\.vibex?\.parse|parse)\.(?:jsx?|tsx?)"/g, "<body>"),
    runtime: observed.stdout.trim(),
  }
  rmSync(dir, { recursive: true, force: true })
  return result
}

const summary = {}
for (const item of corpus) {
  const body = project(item, "body"), twin = project(item, "twin")
  assert.deepEqual(body, twin, item.name)
  summary[item.name] = { codes: body.diagnostics.map((d) => d.code), runtime: JSON.parse(body.runtime) }
}

// What a sibling copy cannot carry: VibeLang syntax keeps TypeScript's own
// error, an identifier specifier is EK4007, import.meta is EK4009.
const refused = {}
for (const [name, body, code] of [
  ["vibelang syntax", "export effect function load() { return 1 }", /TS\d+/],
  ["identifier specifier", "import { n } from other", /EK4007/],
  ["import.meta", "export const url = import.meta.url", /EK4009/],
]) {
  const dir = mkdtempSync(join(tmpdir(), "vip40-move-refused-"))
  writeFileSync(join(dir, "package.json"), '{"type":"module"}')
  writeFileSync(join(dir, "tsconfig.json"), JSON.stringify({ compilerOptions: { target: "es2022", module: "nodenext", strict: true, types: [], noEmit: true, skipLibCheck: true }, files: ["main.vibe"] }))
  writeFileSync(join(dir, "main.vibe"), `module other { export const n = 1 }\nmodule parse {\n${body}\n}\nimport parse\nimport other\n`)
  const r = run(dir, ["-p", "tsconfig.json", "--pretty", "false"])
  rmSync(dir, { recursive: true, force: true })
  assert.notEqual(r.status, 0, name)
  const codes = diagnostics(r.stdout, "main.vibe", 0).map((d) => d.code)
  assert.ok(codes.some((c) => code.test(c)) && !codes.some((c) => c.startsWith("EK") && !code.test(c)), name + ": " + r.stdout)
  refused[name] = codes
}
console.log(JSON.stringify({ summary, refused }, null, 1))
