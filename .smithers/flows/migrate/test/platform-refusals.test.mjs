// Every refusal the platform split writes, one row each: the source, the
// route and options, and the refusal it must produce. A meta-check reads the
// refusal templates out of lib/platform.mjs and fails on one no row produces,
// so a refusal that turns into a move, or a new refusal, cannot go untested.
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { test } from "node:test"
import { splitBatchPlatform, splitPlatform, splitPlatformToModule } from "../lib/platform.mjs"

const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const ts = require("typescript")
const lib = readFileSync(new URL("../lib/platform.mjs", import.meta.url), "utf8")

const file = "src/x.ts"
const docs = 'import { EOL } from "node:os"\nexport const make = () => ({\n  /** Read decoded bytes. */\n  read: () => EOL\n})\nexport const pure = 1\nexport const api = make()\n'
const sibling = 'import { sep } from "node:path"\nexport function join2(a: string, b: string): string { return a + sep + b }\nexport const k = 1\n'

// [name, route, source, options, refusal]. route is "sibling" (splitPlatform),
// "body" (splitPlatformToModule) or "batch" (splitBatchPlatform over src/x.ts
// and options.files, the batch's refusals joined by newlines).
const rows = [
  ["sibling: an exported value whose same-name type is private", "sibling",
    'import { readFileSync } from "node:fs"\nexport const V = { label: "v" as const, size: 2 }\ntype V = typeof V\ntype Row = { readonly id: string; readonly shape: V }\nexport const rows = (path: string): ReadonlyArray<Row> => { const none: ReadonlyArray<Row> = []; return readFileSync(path, "utf8") === "" ? none : none }\nexport const label = (): string => V.label\n',
    {}, /^src\/x\.ts: the value V would move to x\.platform\.ts but the type V stays, so the module's declarations would change$/],
  ["sibling: a statement that is not a declaration", "sibling",
    'import { rmSync } from "node:fs"\nrmSync("x")\nexport const k = 1\n', {}, /^src\/x\.ts: rmSync\("x"\) cannot move to x\.platform\.ts$/],
  ["sibling: a copied constant read early through a kept function", "sibling",
    'import { sep } from "node:path"\nfunction through(): number { return answer() }\nexport const early = through()\nexport const STATUS = 499\nexport function answer(): number { return sep.length + STATUS }\n',
    {}, /^src\/x\.ts: export STATUS is read by platform code that a statement above it runs while the module loads, so its copy in x\.platform\.ts would be initialized before that read$/],
  ["sibling: moved code that names the module through import.meta", "sibling",
    'import { join } from "node:path"\nimport { fileURLToPath } from "node:url"\nconst dirname = (p: string): string => p\nexport const where = (): string => join(dirname(fileURLToPath(import.meta.url)), "x")\nexport const label = "labels"\n',
    {}, /^src\/x\.ts: export const where = .* reads import\.meta, which would name x\.platform\.ts after the move$/],
  ["sibling: a re-export read before the sibling initializes it", "sibling",
    'import { sep } from "node:path"\nexport const known = [Refused]\nexport class Refused extends Error {}\nexport const check = (s: string): boolean => { if (s === sep) throw new Refused(); return true }\n',
    {}, /^src\/x\.ts: export Refused would be initialized in x\.platform\.ts before a statement above it that reads it while the module loads$/],
  ["sibling: a host read below a configuring call", "sibling",
    'import { config } from "dotenv"\n\nconfig()\n\nexport const port = Number(process.env.PORT)\nexport const label = (n: number): string => "port " + n\n',
    { globals: ["process"] }, /^src\/x\.ts: export const port = Number\(process\.env\.PORT\) runs while the module loads, after config\(\), and in x\.platform\.ts it would run first$/],
  ["sibling: a module of platform code only", "sibling",
    'import { sep } from "node:path"\nexport const s = sep\n', {}, /^src\/x\.ts is platform code only$/],
  ["sibling: a generic documented factory", "sibling",
    docs.replace("make = ()", "make = <T>(value: T)").replace("read: () => EOL", "read: () => ({ value, EOL })").replace("api = make()", "api = make(1)"),
    {}, /^src\/x\.ts: inferred member documentation for api depends on a generic, overloaded or contextually typed factory; keep the module in TypeScript$/],
  ["batch: a public package without an export map", "batch", sibling,
    { files: { "package.json": "{}" } }, /^src\/x\.ts: refusing src\/x\.platform\.ts: a new published module could be exposed by the package's wildcard exports or open subpaths; keep the platform code in TypeScript$/],
  ["batch: a manifest that does not parse", "batch", sibling,
    { files: { "package.json": "{" } }, /^src\/x\.ts: refusing src\/x\.platform\.ts: cannot establish the package's published module surface; keep the platform code in TypeScript$/],
  ["batch: the sibling and the body both refuse", "batch",
    'import { sql } from "bun"\nsql`x`\nexport const k = 1\n', { moduleBodies: true, files: { "package.json": '{ "private": true }' } },
    /^src\/x\.ts: sql`x` cannot move to x\.platform\.ts; src\/x\.ts: sql`x` runs in order among the module's statements, so it cannot move to a module body, and its host operations cannot move on their own: src\/x\.ts:2: sql tags a template$/],
  ["batch: the sibling exists", "batch", sibling,
    { files: { "package.json": '{ "private": true }', "src/x.platform.ts": "export {}\n" } }, /^src\/x\.ts: src\/x\.platform\.ts already exists$/],
  ["body: export =", "body",
    'import { sep } from "node:path"\nconst at = sep\nexport = at\n', {}, /^src\/x\.ts: export = has no place beside a module body \(EK4008\)$/],
  ["body: an import.meta reader whose host operation is a re-export", "body",
    'import { sep } from "node:path";\nconst at = sep + import.meta.url;\nexport { sep, at };\n', {},
    /^src\/x\.ts: const at = sep \+ import\.meta\.url; reads import\.meta, which a module body cannot \(EK4009\), and its host operations cannot move on their own: src\/x\.ts:3: export \{ sep \} re-exports platform code$/],
  ["body: a host operation with a comment inside", "body",
    "export const f = () => process/* c */.env.X + import.meta.url\nexport const k = 1\n", { globals: ["process"] },
    /^src\/x\.ts: export const f = .* reads import\.meta, which a module body cannot \(EK4009\), and its host operations cannot move on their own: src\/x\.ts:1: process\.env\.X has comments that cannot move unchanged$/],
  ["body: a host operation exported as default", "body",
    'import { sep } from "node:path";\nexport const at = sep + import.meta.url;\nexport default sep;\n', {},
    /, and its host operations cannot move on their own: src\/x\.ts:3: export default sep exports platform code$/],
  ["body: an optional call of a host member with arguments", "body",
    'import * as NodePath from "node:path";\nexport const p = () => NodePath.join?.(import.meta.url);\nexport const k = 1\n', {},
    /, and its host operations cannot move on their own: src\/x\.ts:2: NodePath\.join\?\.\(\) would lose its receiver$/],
  ["body: a compound write to the host", "body",
    "export const f = () => { process.exitCode += 1; return import.meta.url };\nexport const k = 1\n", { globals: ["process"] },
    /, and its host operations cannot move on their own: src\/x\.ts:1: process\.exitCode is written in place$/],
  ["body: a throwing statement that is not a declaration", "body",
    'if (Math.random() > 2) throw new Error("x")\nexport const k = 1\n', { throws: true },
    /^src\/x\.ts: if \(Math\.random\(\) > 2\) throw new Error\("x"\) runs in order among the module's statements, so it cannot move to a module body$/],
  ["body: throwing code that reads import.meta", "body",
    "export const f = (s: string) => { if (!s) throw new Error(import.meta.url); return s }\nexport const k = 1\n", { throws: true },
    /^src\/x\.ts: export const f = .* reads import\.meta, which a module body cannot \(EK4009\)$/],
  ["body: throwing code below a kept statement", "body",
    'import { decode, registry } from "./codec.js"\n\nregistry.strict = true\n\nexport const first = decode("a")\nexport const count = (): number => registry.size\n', { throws: true, throwing: ["decode"] },
    /^src\/x\.ts: export const first = decode\("a"\) runs while the module loads, after registry\.strict = true, and in a module body it would run first$/],
  ["body: a module of platform code only", "body",
    'import { sep } from "node:path"\nexport const s = sep\n', {}, /^src\/x\.ts is platform code only$/],
  ["body: every value reaches a throw", "body",
    'export const f = (s: string) => { if (!s) throw new Error("x"); return s }\n', { throws: true },
    /^src\/x\.ts: every value of the module reaches a throw, so it stays TypeScript$/],
  ["body: a throwing export without re-exports", "body",
    'export function check(s: string): string { if (!s) throw new Error("x"); return s }\nexport const k = 1\n', { throws: true, reexports: false },
    /^src\/x\.ts: check would be declared by `module throwing`, a new public declaration file; platformModuleBodies allows it$/],
  ["body: a shadowed ReturnType", "body",
    "type ReturnType<T> = string\n" + docs, {},
    /^src\/x\.ts: ReturnType is shadowed, so inferred member documentation for api cannot retain its factory type$/],
]

function refusalOf(route, source, options) {
  if (route === "sibling") return splitPlatform(source, file, ts, options)?.refused
  if (route === "body") return splitPlatformToModule(source, file, ts, options)?.refused
  const { files: extra = {}, ...rest } = options
  const files = { ...extra, [file]: source }
  const before = { ...files }
  const result = splitBatchPlatform(".", [file], ts, { exists: (f) => f in files, read: (f) => files[f], write: (f, t) => { files[f] = t }, ...rest })
  assert.deepEqual(files, before, "a refused batch writes nothing")
  assert.deepEqual(result.splits, [])
  return result.refused.join("\n")
}

for (const [name, route, source, options, refusal] of rows) {
  test(`refusal: ${name}`, () => {
    assert.match(refusalOf(route, source, options) ?? "(no refusal)", refusal)
  })
}

// The refusal texts lib/platform.mjs writes, as anchored patterns: each
// template literal and each string concatenation on a line that builds a
// refusal, with every interpolated part matching any text.
const literal = (c) => c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
function refusalTemplates() {
  const out = []
  for (const line of lib.split("\n")) {
    if (!/refus/.test(line) || /^\s*(\/\/|\*)/.test(line)) continue
    for (let i = 0; i < line.length; i++) {
      if (line[i] !== "`") continue
      let pattern = "", j = i + 1
      for (; j < line.length && line[j] !== "`"; j++) {
        if (line[j] === "\\") pattern += literal(line[++j])
        else if (line[j] === "$" && line[j + 1] === "{") {
          for (let depth = 0; j < line.length; j++) if (line[j] === "{") depth++; else if (line[j] === "}" && --depth === 0) break
          pattern += "[\\s\\S]*?"
        } else pattern += literal(line[j])
      }
      out.push(pattern)
      i = j
    }
    for (const chain of line.match(/(?:[\w.]+|"[^"]*")(?: \+ (?:[\w.]+|"[^"]*"))+/g) ?? []) {
      if (!chain.includes('"')) continue
      out.push(chain.split(" + ").map((part) => part.startsWith('"') ? literal(part.slice(1, -1)) : "[\\s\\S]*?").join(""))
    }
  }
  return out.map((pattern) => new RegExp(`^${pattern}$`))
}

test("every refusal template in lib/platform.mjs has a row that produces it", () => {
  const templates = refusalTemplates()
  const sources = templates.map(String)
  // The reader finds a template literal, an escaped backtick in one, and a concatenation.
  assert.ok(sources.includes(String(/^[\s\S]*? is platform code only$/)), sources.join("\n"))
  assert.ok(sources.some((s) => s.includes("would be declared by `module ")), sources.join("\n"))
  assert.ok(sources.some((s) => s.includes(": refusing ")), sources.join("\n"))
  const produced = rows.map(([, route, source, options]) => refusalOf(route, source, options) ?? "")
  const missing = templates.filter((t) => !produced.some((text) => t.test(text)))
  assert.deepEqual(missing.map(String), [], "a refusal of lib/platform.mjs with no row: add one to rows")
})
