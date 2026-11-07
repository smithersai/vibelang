import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { checkProperty } from "../../../../scripts/testing/property.mjs"
import { splitBatchPlatform, splitPlatform, splitPlatformToModule } from "../lib/platform.mjs"

// migrate:opencode:vip40-platform-conversion: the sibling split refuses a module
// whose moved export is no function with written types, and a value and a type of
// one name, since a sibling would change its declarations. 220 of opencode's 271
// platform holds met such a refusal. A VIP-40 body holds them and the module
// re-exports them.

const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const fc = require("fast-check")
const ts = require("typescript")
const compiler = process.env.VIBELANG_BINARY

const split = (text, options) => splitPlatformToModule(text, "src/x.ts", ts, options)

test("what the sibling split refuses, the module split holds", () => {
  const text = `import { Schema } from "effect"
import { EOL } from "node:os"
export const line = (a: string) => a + EOL
export const Shape = Schema.Struct({ eol: Schema.Literal(EOL) })
export type Shape = typeof Shape.Type
export default EOL
export const kept = 1
`
  assert.ok(splitPlatform(text, "src/x.ts", ts).refused)
  const { module } = split(text)
  assert.match(module, /^module platform \{$/m)
  assert.match(module, /^export \{ Shape, line \} from platform$/m)
  assert.match(module, /^export \{ default \} from platform$/m)
  assert.match(module, /^export const kept = 1$/m)
  assert.doesNotMatch(module.slice(module.indexOf("}\n")), /node:os/)
})

test("the moved code keeps its bytes, and the file's first comment stays the file's", () => {
  const moved = "/** Docs. */\nexport const a = (s: string) => `  ${s}\n    ${EOL}`"
  const { module } = split(`/** Header. */\nimport { EOL } from "node:os"\n${moved}\nexport const kept = 1\n`)
  assert.ok(module.includes(moved))
  assert.ok(module.startsWith("/** Header. */\n"))
  assert.equal(module.split("/** Header. */").length, 2)
})

test("a body's closure takes what the moved code reads, and exports what the module reads", () => {
  const { module, moved, kept } = split(`import { sep } from "node:path"
const shared = 1
type Private = { a: number }
export const a = (p: Private) => sep + shared + p.a
export const b = shared + 1
`, {})
  assert.deepEqual(moved.sort(), ["Private", "a", "shared"])
  assert.deepEqual(kept, ["b"])
  assert.match(module, /^export const shared = 1$/m)
  assert.match(module, /^import \{ shared \} from platform$/m)
  assert.doesNotMatch(module, /^import .*Private/m)
})

test("a type-only name re-exports as a type, and a kept type that reads a moved value moves", () => {
  const { module } = split(`import { sep } from "node:path"
export const a = sep
export type A = typeof a
export interface I { x: number }
export const uses = (i: I): string => String(i.x)
`, {})
  assert.match(module, /^export \{ a \} from platform$/m)
  assert.match(module, /^export type \{ A \} from platform$/m)
  assert.match(module, /^export interface I/m)
})

test("a module the split cannot serve keeps its platform code, with the reason", () => {
  assert.match(split(`import { sep } from "node:path"\nexport const a = sep\n`).refused, /platform code only/)
  // A body cannot hold import.meta (EK4009): the declaration stays and only
  // its host operation moves. Throwing code still moves whole, so it refuses.
  const kept = split(`import { sep } from "node:path"\nexport const a = sep + import.meta.url\nexport const k = 1\n`)
  assert.match(kept.module, /^export const a = \$sep\(\) \+ import\.meta\.url$/m)
  assert.match(kept.module, /^module platform \{\nimport \{ sep \} from "node:path"/m)
  assert.doesNotMatch(kept.module.replace(/^module platform \{[^]*?^\}$/m, ""), /node:path/)
  assert.match(split(`export const a = () => { if (!import.meta.url) throw new Error("x") }\nexport const k = 1\n`, { throws: true }).refused, /EK4009/)
  // A statement that runs in order stays where it stands; only its host operation moves (alchemy-platform-module-order).
  assert.match(split(`import { rmSync } from "node:fs"\nrmSync("x")\nexport const k = 1\n`).module, /^\$rmSync\("x"\)$/m)
  assert.match(split(`import { Worker } from "node:worker_threads"\nnew Worker("x")\nexport const k = 1\n`).refused, /runs in order among the module's statements, so it cannot move to a module body, and its host operations cannot move on their own/)
  assert.match(split(`import { sep } from "node:path"\nconst a = sep\nexport = a\n`).refused, /EK4008/)
  assert.equal(split(`export const k = 1\n`), null)
  assert.equal(split(`import type { Stats } from "node:fs"\nexport const k = (s: Stats) => s\n`), null)
})

test("host globals move only when named, and a local of the name is not the global", () => {
  const text = `export const a = () => process.pid\nexport const k = 1\n`
  assert.equal(split(text), null)
  assert.match(split(text, { globals: ["process"] }).module, /^export \{ a \} from platform$/m)
  assert.equal(split(`const process = { pid: 1 }\nexport const a = () => process.pid\n`, { globals: ["process"] }), null)
})

test("a parameter or local of a moved name is no read of it", () => {
  // opencode google-vertex-shared: `export const host = (location: string) => ...` beside a moved `location`
  // imported an unused binding (TS6133).
  const { module } = split(`import { sep } from "node:path"
export const location = sep
export const host = (location: string) => location.length
export const local = () => { const location = 1; return location }
export const shadowType = <location>(a: location) => a
export const kept = 1
`)
  assert.doesNotMatch(module, /^import \{.*location.*\} from platform$/m)
  assert.match(module, /^export \{ location \} from platform$/m)
  const param = split(`import { sep } from "node:path"\nexport const a = (path: string, sep2 = sep) => path + sep2\nexport const b = (sep: string) => sep\n`)
  assert.match(param.module, /^export const b = /m)
})

test("a dynamic import of a builtin moves like a static one", () => {
  // opencode ai/src/index: EK4402 on `await import("node:fs/promises")` in kept code.
  const { module } = split(`export const read = async (p: string) => (await import("node:fs/promises")).readFile(p)\nexport const kept = 1\n`)
  assert.match(module, /^export \{ read \} from platform$/m)
  assert.equal(split(`export const a = () => import("./local.ts")\n`), null)
})

test("a re-export reads no import of its name", () => {
  // opencode core/pty/ticket: `export * as PtyTicket from "./ticket.js"` beside an imported PtyTicket the body takes (TS6133).
  const { module } = split(`import { PtyTicket } from "./schema.ts"
import { action } from "./action.ts"
import { sep } from "node:path"
export const a = sep + PtyTicket + action
export const b = 1
export * as PtyTicket from "./ticket.ts"
export { action } from "./action.ts"
`)
  assert.equal(module.slice(0, module.indexOf("module platform")).trim(), "")
  const local = split(`import { sep } from "node:path"\nimport { x } from "./x.ts"\nexport const a = sep\nexport const k = 1\nexport { x as y }\n`)
  assert.match(local.module, /^import \{ x \} from "\.\/x\.ts"$/m)
})

test("whatever writes a moved binding moves with it", () => {
  // opencode core/shell/select: TS2632, `defaultConfigured = ...` on a name imported from the body.
  const { module } = split(`import { sep } from "node:path"
let state = sep
export const read = () => state
export const reset = () => { state = "" }
export const kept = 1
`)
  assert.match(module, /^export \{ reset \} from platform$/m)
  assert.match(module, /^import \{ state \} from platform$/m)
  assert.match(module, /^export const read = \(\) => state$/m)
})

test("a comment on an import stays with it, in the body as in the module", () => {
  // opencode core/filesystem/watcher: `// @ts-expect-error` above an untyped import, TS7016 when lost.
  const { module } = split(`import { sep } from "node:path"
// @ts-expect-error no types
import w from "untyped"
export const a = sep + w
export const k = 1
`)
  assert.match(module, /\/\/ @ts-expect-error no types\nimport w from "untyped"/)
})

test("every name in a body is exported, for what a kept declaration's type may name", () => {
  // opencode openai-images: TS4023, `protocol` has or is using name `State` from the body.
  const { module } = split(`import { sep } from "node:path"
interface State { a: string }
const make = (): State => ({ a: sep })
export const kept = () => make()
`)
  assert.match(module, /^export interface State/m)
  assert.match(module, /^export const make/m)
  assert.match(module, /^import \{ make \} from platform$/m)
  assert.doesNotMatch(module, /^export .*State.* from platform$/m)
})

test("the name avoids every binding and read of the file", () => {
  const { module, name } = split(`import { sep } from "node:path"\nconst platform = 1\nexport const a = sep\nexport const k = platform\n`)
  assert.equal(name, "platform2")
  assert.match(module, /^module platform2 \{$/m)
})

test("moduleBodies is opt-in; a sibling serves an exported package, a body a private one", () => {
  const refused = `import { sep } from "node:path"\nexport const a = sep\nexport const k = 1\n`
  const split = `import { sep } from "node:path"\nexport function a(s: string): string { return s + sep }\nexport const k = 1\n`
  const run = (manifest, options) => {
    const files = { "package.json": manifest, "r.ts": refused, "s.ts": split }
    const result = splitBatchPlatform("/none", ["r.ts", "s.ts"], ts, { exists: (f) => f in files, read: (f) => files[f], write: (f, t) => { files[f] = t }, ...options })
    return { result, files }
  }
  const exported = '{"name":"p","exports":{".":"./s.js"}}'
  // Without bodies the sibling serves both: the value export is re-exported from it.
  const off = run('{"private":true}', {})
  assert.equal(off.files["r.ts"], 'export { a } from "./r.platform.ts"\nexport const k = 1\n')
  assert.deepEqual(off.result.refused, [])
  assert.deepEqual(off.result.splits.map((s) => [s.file, s.platform]), [["r.ts", "r.platform.ts"], ["s.ts", "s.platform.ts"]])
  // An explicit export map hides the sibling, so a body serves what the
  // sibling refuses, and a module whose sibling would re-export a moved
  // value: the body keeps r.ts's value export in the module.
  const on = run(exported, { moduleBodies: true })
  assert.deepEqual(on.result.refused, [])
  assert.deepEqual(on.result.splits.map((s) => [s.file, s.platform, s.module ?? null]), [["r.ts", null, "platform"], ["s.ts", "s.platform.ts", null]])
  assert.equal(on.files["r.platform.ts"], undefined)
  // Every module of a private package is an API entry (t3code Desktop
  // DesktopObservability.ts): a body adds none, a sibling adds one.
  const priv = run('{"private":true,"type":"module","main":"./dist/index.js"}', { moduleBodies: true })
  assert.deepEqual(priv.result.refused, [])
  assert.deepEqual(priv.result.splits.map((s) => [s.file, s.platform, s.module ?? null]), [["r.ts", null, "platform"], ["s.ts", null, "platform"]])
  assert.equal(priv.files["s.platform.ts"], undefined)
  assert.match(priv.files["s.ts"], /^module platform \{$/m)
})

test("a private package keeps the sibling when a body refuses", () => {
  // export = has no place beside a module body (EK4008); the sibling split still serves it.
  const text = `import { sep } from "node:path"\nfunction a(s: string): string { return s + sep }\nexport = a\n`
  const files = { "package.json": '{"private":true}', "e.ts": text }
  const result = splitBatchPlatform("/none", ["e.ts"], ts, { moduleBodies: true, exists: (f) => f in files, read: (f) => files[f], write: (f, t) => { files[f] = t } })
  const plain = { "package.json": '{"private":true}', "e.ts": text }
  const control = splitBatchPlatform("/none", ["e.ts"], ts, { exists: (f) => f in plain, read: (f) => plain[f], write: (f, t) => { plain[f] = t } })
  assert.deepEqual(result.splits.map((s) => [s.file, s.platform]), [["e.ts", "e.platform.ts"]])
  assert.deepEqual(result.splits, control.splits)
  assert.deepEqual(files, plain)
})

test("a private package's all-platform function module takes a body and keeps its wrappers", () => {
  // t3code Web waitForAtomValue.ts, discardComposerDraft.ts, threadContextAttachment.ts
  // (dp-t3code-01 2026-11-07T04:45Z): every value is platform code, so the body
  // refused, and the sibling's x.platform.d.ts became a new API entry.
  const text = `import type { Stats } from "node:fs"\nimport { sep } from "node:path"\n/** Joins. */\nexport async function a<T>(s: string, t: T, st?: Stats): Promise<string> { return s + sep + String(t) + String(st) }\nexport const b = (n: number): string => sep.repeat(n)\nexport type K = string\n`
  const run = (manifest, options) => {
    const files = { "package.json": manifest, "w.ts": text }
    const result = splitBatchPlatform("/none", ["w.ts"], ts, { exists: (f) => f in files, read: (f) => files[f], write: (f, t) => { files[f] = t }, ...options })
    return { result, files }
  }
  const priv = run('{"private":true}', { moduleBodies: true })
  assert.deepEqual(priv.result.refused, [])
  assert.deepEqual(priv.result.splits.map((s) => [s.file, s.platform, s.module ?? null, s.wrapped]), [["w.ts", null, "platform", ["a", "b"]]])
  assert.equal(priv.files["w.platform.ts"], undefined)
  const module = priv.files["w.ts"]
  assert.match(module, /^module platform \{$/m)
  assert.match(module, /^import \{ a as a\$platform, b as b\$platform \} from platform$/m)
  assert.match(module, /^export async function a<T>\(s: string, t: T, st\?: Stats\): Promise<string> \{\n  return a\$platform\(s, t, st\)\n\}$/m)
  assert.match(module, /^export const b = \(n: number\): string => b\$platform\(n\)$/m)
  assert.match(module, /^import type \{ Stats \} from "node:fs"$/m)
  assert.doesNotMatch(module, /^export \{ [ab]/m)
  // Without the private preference nothing changes: the sibling serves an
  // exported package, and the body alone still refuses.
  const exported = run('{"name":"p","exports":{".":"./w.js"}}', { moduleBodies: true })
  assert.deepEqual(exported.result.splits.map((s) => [s.file, s.platform]), [["w.ts", "w.platform.ts"]])
  assert.match(splitPlatformToModule(text, "w.ts", ts).refused, /platform code only/)
  // A module with an export no wrapper can keep still takes the sibling's refusal path.
  const untyped = `import { sep } from "node:path"\nexport function a(s: string): string { return s + sep }\nexport const c = sep\n`
  assert.match(splitPlatformToModule(untyped, "w.ts", ts, { wrap: true }).refused, /platform code only/)
  const twin = `import { sep } from "node:path"\nexport function a(s: string): string { return s + sep }\nexport type a = string\n`
  assert.match(splitPlatformToModule(twin, "w.ts", ts, { wrap: true }).refused, /platform code only/)
})

// A generated module, compiled by the real compiler as a .vibe file against the
// original as .ts: same exports at run time, and the declarations name the same API.
const ambient = `declare module "node:path" { export const sep: string }\ndeclare const process: { pid: number }\n`
const nativeName = fc.constantFrom("alpha", "beta", "gamma", "delta")
const shapes = fc.record({
  fn: nativeName, value: fc.boolean(), twin: fc.boolean(), defaulted: fc.boolean(), helper: fc.boolean(), global: fc.boolean(), comment: fc.boolean()
})
const moduleOf = (s) => [
  s.comment ? "/** The file. */" : "",
  `import { sep } from "node:path"`,
  s.helper ? `const helper = (n: number) => n + 1` : "",
  `/** Doc of ${s.fn}. */`,
  `export const ${s.fn} = (a: string): string => a + sep${s.helper ? " + helper(1)" : ""}${s.global ? " + String(process.pid > 0)" : ""}`,
  s.value ? `export const tag = ${JSON.stringify("  keep\n  bytes")} + sep` : "",
  s.twin ? `export const Twin = { sep }\nexport type Twin = typeof Twin` : "",
  s.defaulted ? `export default { sep }` : "",
  `export const kept = 41 + 1`,
  `export const callsMoved = () => ${s.fn}("q").length`
].filter(Boolean).join("\n") + "\n"

const exportsOf = (dir, file) => {
  const r = spawnSync(process.execPath, ["--input-type=module", "-e", `const m = await import(${JSON.stringify(join(dir, file))}); console.log(JSON.stringify(Object.keys(m).sort().map((k) => [k, typeof m[k] === "function" ? "fn" : m[k]])))`], { encoding: "utf8" })
  assert.equal(r.status, 0, r.stderr)
  return r.stdout
}

const rule = "A body is a TypeScript file stored inside a `.vibe` file."
test("a split module compiles, and exports what the TypeScript module exports", { skip: !compiler && "set VIBELANG_BINARY" }, () => checkProperty(fc, {
  name: "platform-module-body", rule, command: "node --test .smithers/flows/migrate/test/platform-module.property.test.mjs", regressions: new URL("./corpus/", import.meta.url), numRuns: 12,
  arbitrary: shapes,
  check: (shape) => {
    const text = moduleOf(shape)
    const dir = mkdtempSync(join(tmpdir(), "platform-module-"))
    try {
      for (const side of ["ts", "vibe"]) {
        const root = join(dir, side)
        mkdirSync(join(root, "src"), { recursive: true })
        writeFileSync(join(root, "src/ambient.d.ts"), ambient)
        writeFileSync(join(root, "package.json"), '{"type":"module"}')
        writeFileSync(join(root, "tsconfig.json"), JSON.stringify({ compilerOptions: { target: "esnext", module: "esnext", moduleResolution: "bundler", strict: true, declaration: true, skipLibCheck: true, types: [], outDir: "out", rootDir: "src" }, include: ["src"] }))
      }
      writeFileSync(join(dir, "ts/src/x.ts"), text)
      const result = splitPlatformToModule(text, "src/x.ts", ts, { globals: shape.global ? ["process"] : [] })
      assert.ok(result.module, JSON.stringify(result))
      writeFileSync(join(dir, "vibe/src/x.vibe"), result.module)
      for (const side of ["ts", "vibe"]) {
        const r = spawnSync(compiler, ["-p", "tsconfig.json"], { cwd: join(dir, side), encoding: "utf8" })
        assert.equal(r.status, 0, `${side}: ${r.stdout}\n${result.module}`)
      }
      assert.equal(exportsOf(join(dir, "vibe/out"), "x.js"), exportsOf(join(dir, "ts/out"), "x.js"))
      assert.ok(readFileSync(join(dir, "vibe/out/x.vibe.platform.d.ts"), "utf8").includes(`/** Doc of ${shape.fn}. */`))
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
    return true
  }
}))

// The all-platform wrapper route, compiled by the real compiler against the
// original: same exports at run time, the wrapper's written signature, and the
// body's declaration beside the source (t3code Web waitForAtomValue.ts).
test("an all-platform module's body and wrappers compile and keep the module's exports", { skip: !compiler && "set VIBELANG_BINARY" }, () => {
  const text = `import { sep } from "node:path"\n/** Doc of join. */\nexport async function join<T>(a: string, t: T): Promise<string> { return a + sep + String(t) }\nexport const line = (n: number): string => sep.repeat(n)\nexport type K = string\n`
  const dir = mkdtempSync(join(tmpdir(), "platform-module-wrap-"))
  try {
    for (const side of ["ts", "vibe"]) {
      const root = join(dir, side)
      mkdirSync(join(root, "src"), { recursive: true })
      writeFileSync(join(root, "src/ambient.d.ts"), ambient)
      writeFileSync(join(root, "package.json"), '{"type":"module","private":true}')
      writeFileSync(join(root, "tsconfig.json"), JSON.stringify({ compilerOptions: { target: "esnext", module: "esnext", moduleResolution: "bundler", strict: true, declaration: true, skipLibCheck: true, types: [], outDir: "out", rootDir: "src" }, include: ["src"] }))
    }
    writeFileSync(join(dir, "ts/src/x.ts"), text)
    const result = splitPlatformToModule(text, "src/x.ts", ts, { wrap: true })
    assert.deepEqual(result.wrapped, ["join", "line"])
    writeFileSync(join(dir, "vibe/src/x.vibe"), result.module)
    for (const side of ["ts", "vibe"]) {
      const r = spawnSync(compiler, ["-p", "tsconfig.json"], { cwd: join(dir, side), encoding: "utf8" })
      assert.equal(r.status, 0, `${side}: ${r.stdout}\n${result.module}`)
    }
    assert.equal(exportsOf(join(dir, "vibe/out"), "x.js"), exportsOf(join(dir, "ts/out"), "x.js"))
    const declaration = readFileSync(join(dir, "vibe/out/x.d.ts"), "utf8")
    assert.match(declaration, /export declare function join<T>\(a: string, t: T\): Promise<string>;/)
    assert.match(declaration, /export declare const line: \(n: number\) => string;/)
    assert.ok(readFileSync(join(dir, "vibe/out/x.vibe.platform.d.ts"), "utf8").includes("/** Doc of join. */"))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

// t3code Web previewBridge.ts (dp-t3code-01 2026-11-07T04:40Z): TS18047, the
// imported nativePreviewBridge is possibly null inside the async closures. An
// import is not narrowed in a closure the way a local const is.
const narrowed = `const native = host\nexport const wrapped = native ? { go: async () => native.go() } : null\n`
test("a moved const the module reads stays a local const of its name, so closures keep its narrowing", () => {
  const { module } = split(narrowed, { globals: ["host"] })
  assert.match(module, /^import \{ native as native\$platform \} from platform$/m)
  assert.match(module, /^const native: typeof native\$platform = native\$platform$/m)
  assert.match(module, /^export const wrapped = native \?/m)
  // An exported const is re-exported, as the sibling split leaves it.
  const exported = split(`export const native = host\nexport const wrapped = native ? 1 : 0\n`, { globals: ["host"] }).module
  assert.match(exported, /^export \{ native \} from platform$/m)
  assert.doesNotMatch(exported, /\$platform/)
})

test("a moved const's narrowing compiles in a closure", { skip: !compiler && "set VIBELANG_BINARY" }, () => {
  const dir = mkdtempSync(join(tmpdir(), "platform-module-narrow-"))
  try {
    mkdirSync(join(dir, "src"), { recursive: true })
    writeFileSync(join(dir, "src/ambient.d.ts"), `declare const host: { go(): Promise<number> } | null\n`)
    writeFileSync(join(dir, "package.json"), '{"type":"module","private":true}')
    writeFileSync(join(dir, "tsconfig.json"), JSON.stringify({ compilerOptions: { target: "esnext", module: "esnext", moduleResolution: "bundler", strict: true, declaration: true, skipLibCheck: true, types: [], outDir: "out", rootDir: "src" }, include: ["src"] }))
    const { module } = split(narrowed, { globals: ["host"] })
    writeFileSync(join(dir, "src/x.vibe"), module)
    const r = spawnSync(compiler, ["-p", "tsconfig.json"], { cwd: dir, encoding: "utf8" })
    assert.equal(r.status, 0, `${r.stdout}\n${module}`)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
// alchemy-platform-module-order (8 partition sources: alchemy-test Core and
// cli, neon PackageRunner and TraceRunner among them): a top-level statement
// that reads the host runs in order among the module's statements, and a body
// evaluates when imported, so the split refused. The statement now stays where
// it stands and only its host operations move, called in place.
test("corpus: an ordered statement that reads the host stays in place, its host operations called where they ran", () => {
  const corpus = JSON.parse(readFileSync(new URL("./corpus/alchemy-platform-module-order.json", import.meta.url), "utf8"))
  for (const sample of corpus.samples) {
    const { module, refused } = split(sample.before, { globals: sample.globals })
    assert.equal(refused, undefined, sample.key)
    assert.equal(module, sample.after, sample.key)
  }
})

test("property: the module's own statements keep their order, with only host operations replaced", () => {
  const statements = {
    value: (i) => `export const v${i} = "m${i}"`,
    env: (i) => `if (process.env.F${i}) { process.env.G${i} = "m${i}" }`,
    argv: (i) => `export const a${i} = [process.argv, "m${i}"]`,
    fn: (i) => `export const f${i} = (n: number) => n + "m${i}".length`,
  }
  fc.assert(fc.property(fc.array(fc.constantFrom(...Object.keys(statements)), { minLength: 1, maxLength: 6 }), (keys) => {
    if (!keys.includes("env") || !keys.some((k) => k === "value" || k === "fn")) return
    const lines = keys.map((k, i) => statements[k](i))
    const result = split(lines.join("\n") + "\n", { globals: ["process"] })
    assert.equal(result.refused, undefined, lines.join("\n"))
    const out = result.module
    const bodyEnd = out.indexOf("\n}\n")
    const at = lines.map((_, i) => out.indexOf(`"m${i}"`))
    for (let i = 0; i < at.length; i++) assert.ok(at[i] > bodyEnd, out)
    for (let i = 1; i < at.length; i++) assert.ok(at[i - 1] < at[i], out)
  }), { seed: 4009, numRuns: 120 })
})
