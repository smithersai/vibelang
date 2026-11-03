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
  assert.match(split(`import { sep } from "node:path"\nexport const a = sep + import.meta.url\nexport const k = 1\n`).refused, /EK4009/)
  assert.match(split(`import { rmSync } from "node:fs"\nrmSync("x")\nexport const k = 1\n`).refused, /runs in order/)
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

test("moduleBodies is opt-in, and serves only what the sibling split refuses", () => {
  const refused = `import { sep } from "node:path"\nexport const a = sep\nexport const k = 1\n`
  const split = `import { sep } from "node:path"\nexport function a(s: string): string { return s + sep }\nexport const k = 1\n`
  const run = (options) => {
    const files = { "package.json": '{"private":true}', "r.ts": refused, "s.ts": split }
    const result = splitBatchPlatform("/none", ["r.ts", "s.ts"], ts, { exists: (f) => f in files, read: (f) => files[f], write: (f, t) => { files[f] = t }, ...options })
    return { result, files }
  }
  const off = run({})
  assert.equal(off.files["r.ts"], refused)
  assert.equal(off.result.refused.length, 1)
  const on = run({ moduleBodies: true })
  assert.deepEqual(on.result.refused, [])
  assert.deepEqual(on.result.splits.map((s) => [s.file, s.platform, s.module ?? null]), [["r.ts", null, "platform"], ["s.ts", "s.platform.ts", null]])
  assert.match(on.files["r.ts"], /^module platform \{$/m)
  assert.equal(on.files["r.platform.ts"], undefined)
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
