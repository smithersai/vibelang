import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { checkProperty } from "../../../../scripts/testing/property.mjs"
import { canonicalize } from "../lib/declarations.mjs"
import { splitBatchPlatform, splitPlatformToModule } from "../lib/platform.mjs"

// codemod-gap:throwing-plain-helper-boundaries (drive-t3code 2026-11-03T05:50Z):
// t3code packages/contracts baseSchemas.ts and orchestrationV2.ts went back to
// TypeScript because a private schema helper throws on an invariant at module
// load. Will's 2026-10-31 ruling bars `throw` from sync VibeLang code (spec 003,
// "Plain code never throws", EK0401) and sends it to "a ts module using module
// syntax"; VIP-40 is that module. The codemod moves each declaration that
// throws in plain code, with what it reads, into `module throwing { }`, and the
// rest of the file migrates.

const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const fc = require("fast-check")
const ts = require("typescript")
const compiler = process.env.VIBELANG_BINARY

const split = (text) => splitPlatformToModule(text, "src/x.ts", ts, { throws: true })

// Minimized from t3code packages/contracts/src/baseSchemas.ts (knownTags) and
// orchestrationV2.ts (encodedKind), both private and both run at module load.
const baseSchemas = `import * as Schema from "effect/Schema"

const knownTags = (members: ReadonlyArray<{ readonly fields: object }>, tag: string): ReadonlySet<string> => {
  const tags = new Set<string>()
  for (const member of members) {
    const literal = (member.fields as Record<string, unknown>)[tag]
    if (typeof literal !== "string") {
      throw new Error(\`Every ForwardCompatibleUnion member needs a string literal \${tag}.\`)
    }
    tags.add(literal)
  }
  return tags
}

export const ForwardCompatibleTags = (members: ReadonlyArray<{ readonly fields: object }>, tag: string) => knownTags(members, tag)

const makeEntityId = (brand: string) => Schema.String.pipe(Schema.brand(brand))
export const ThreadId = makeEntityId("ThreadId")
`

const orchestration = `function encodedKind(member: { readonly kind?: unknown }): string {
  if (typeof member.kind === "string") return member.kind
  throw new Error("Each member of a kind union needs a literal string \`kind\`.")
}

export const kinds: ReadonlySet<string> = new Set([{ kind: "a" }, { kind: "b" }].map(encodedKind))
`

test("a private helper that throws moves into a module body, and the rest of the file stays", () => {
  const { module, name, moved, throwing } = split(baseSchemas)
  assert.equal(name, "throwing")
  assert.deepEqual(moved, ["knownTags"])
  assert.deepEqual(throwing, ["knownTags"])
  assert.match(module, /^module throwing \{$/m)
  assert.match(module, /^import \{ knownTags \} from throwing$/m)
  assert.match(module, /^export const knownTags = /m)
  assert.match(module, /^export const ForwardCompatibleTags = /m)
  assert.match(module, /^const makeEntityId = /m)
  // The body takes no import its code does not read; the file keeps its own.
  const start = module.indexOf("module throwing {"), end = module.indexOf("\n}\n\n", start) + 3
  const [head, body, rest] = [module.slice(0, start), module.slice(start, end), module.slice(end)]
  assert.doesNotMatch(body, /effect\/Schema/)
  assert.match(head, /^import \* as Schema from "effect\/Schema"$/m)
  assert.match(body, /throw new Error/)
  assert.doesNotMatch(head + rest, /throw /)
})

test("a function declaration that throws moves the same way", () => {
  const { module, moved } = split(orchestration)
  assert.deepEqual(moved, ["encodedKind"])
  assert.match(module, /^import \{ encodedKind \} from throwing$/m)
  assert.match(module, /^export function encodedKind\(/m)
  assert.match(module, /^export const kinds: ReadonlySet<string> = /m)
})

test("an exported throwing function is re-exported from the body", () => {
  const { module } = split(`export function port(raw: string): number {\n  const n = Number(raw)\n  if (!Number.isInteger(n)) throw new RangeError(raw)\n  return n\n}\nexport const label = (raw: string) => "port " + raw\n`)
  assert.match(module, /^export \{ port \} from throwing$/m)
  assert.match(module, /^export const label = /m)
})

test("a throw VibeLang allows stays: async functions reject, generators are effect code", () => {
  assert.equal(split(`export async function load(id: string) { if (!id) throw new Error("no id"); return id }\nexport const k = 1\n`), null)
  assert.equal(split(`import { Effect } from "effect"\nexport const run = Effect.gen(function* () { throw new Error("x") })\nexport const k = 1\n`), null)
  assert.equal(split(`export function orNull(s: string) { try { return JSON.parse(s) } catch { return null } }\n`), null)
  // A plain function nested in an async one is plain code again.
  assert.match(split(`export async function load(xs: string[]) { return xs.map((x) => { if (!x) throw new Error("x"); return x }) }\nexport const k = 1\n`).module, /^module throwing \{$/m)
})

test("a throw the body cannot hold keeps the module TypeScript, with the reason", () => {
  assert.match(split(`if (Math.random() > 2) throw new Error("x")\nexport const k = 1\n`).refused, /runs in order/)
  assert.match(split(`export const f = (s: string) => { if (!s) throw new Error("x"); return s }\n`).refused, /reaches a throw/)
  assert.match(split(`export const f = (s: string) => { if (!s) throw new Error(import.meta.url); return s }\nexport const k = 1\n`).refused, /EK4009/)
})

test("the batch split moves plain throws by default, beside a platform sibling too", () => {
  const run = (text, options = {}) => {
    const files = { "package.json": '{"private":true}', "x.ts": text }
    const result = splitBatchPlatform("/none", ["x.ts"], ts, { exists: (f) => f in files, read: (f) => files[f], write: (f, t) => { files[f] = t }, ...options })
    return { result, files }
  }
  const on = run(orchestration)
  assert.deepEqual(on.result.splits, [{ file: "x.ts", platform: null, module: "throwing", moved: ["encodedKind"], wrapped: [], throwing: ["encodedKind"] }])
  assert.match(on.files["x.ts"], /^module throwing \{$/m)
  assert.equal(run(orchestration, { throwBodies: false }).files["x.ts"], orchestration)
  const both = run(`import { sep } from "node:path"\nexport function join2(a: string, b: string): string { return a + sep + b }\n${orchestration}`)
  assert.equal(both.result.splits[0].platform, "x.platform.ts")
  assert.equal(both.result.splits[0].module, "throwing")
  assert.match(both.files["x.platform.ts"], /sep/)
  assert.match(both.files["x.ts"], /^module throwing \{$/m)
  assert.doesNotMatch(both.files["x.ts"], /node:path/)
  // An exported throw would publish the body's declaration file: only with platformModuleBodies.
  const exported = `export function check(s: string): string { if (!s) throw new Error("x"); return s }\nexport const k = 1\n`
  const off = run(exported)
  assert.equal(off.files["x.ts"], exported)
  assert.match(off.result.refused[0], /check would be declared by `module throwing`, a new public declaration file/)
  assert.match(run(exported, { moduleBodies: true }).files["x.ts"], /^export \{ check \} from throwing$/m)
  // A throw body takes no platform code unless platformModuleBodies asks for it.
  const dynamic = `export const read = async (p: string) => (await import("node:fs/promises")).readFile(p)\n${orchestration}`
  const plainOnly = run(dynamic)
  assert.deepEqual(plainOnly.result.splits[0].moved, ["encodedKind"])
  assert.match(plainOnly.files["x.ts"], /^export const read = async/m)
  assert.equal(run(dynamic, { moduleBodies: true }).result.splits[0].module, "platform")
  const refused = run(`if (Math.random() > 2) throw new Error("x")\nexport const k = 1\n`)
  assert.equal(refused.result.splits.length, 0)
  assert.match(refused.result.refused[0], /runs in order/)
})

// Generated value-only modules with throwing helpers, compiled by the real
// compiler as .vibe against the original as .ts: the same exports at run
// time, and the module's own declaration file canonically identical.
const shapes = fc.record({
  declaration: fc.boolean(), exported: fc.boolean(), atLoad: fc.boolean(), nested: fc.boolean(), reads: fc.boolean(), second: fc.boolean()
})
const moduleOf = (s) => {
  const throwing = s.nested ? `[s].map((v) => { if (!v) throw new Error("empty"); return v })[0]` : `(() => { if (!s) throw new Error("empty") ; return s })()`
  const helper = s.declaration
    ? `${s.exported ? "export " : ""}function check(s: string): string {\n  return ${throwing}${s.reads ? " + suffix" : ""}\n}`
    : `${s.exported ? "export " : ""}const check = (s: string): string => {\n  if (!s) throw new RangeError("empty " + s)\n  return s${s.reads ? " + suffix" : ""}\n}`
  return [
    s.reads ? `const suffix = "!"` : "",
    helper,
    s.second ? `const other = (n: number): number => { if (n < 0) throw new Error("neg"); return n }` : "",
    `export const label = (s: string): string => "label " + s`,
    s.atLoad ? `export const loaded = check("x")` : `export const later = (s: string) => check(s)`,
    s.second ? `export const counted = other(2)` : "",
    `export const kept = 41 + 1`
  ].filter(Boolean).join("\n") + "\n"
}

const exportsOf = (dir, file) => {
  const r = spawnSync(process.execPath, ["--input-type=module", "-e", `const m = await import(${JSON.stringify(join(dir, file))}); console.log(JSON.stringify(Object.keys(m).sort().map((k) => [k, typeof m[k] === "function" ? [m[k]("a"), (() => { try { return m[k]("") } catch (e) { return e.constructor.name + ":" + e.message } })()] : m[k]])))`], { encoding: "utf8" })
  assert.equal(r.status, 0, r.stderr)
  return r.stdout
}

const rule = "A body is a TypeScript file stored inside a `.vibe` file."
test("a module whose throwing helpers moved compiles, runs and declares what the TypeScript module does", { skip: !compiler && "set VIBELANG_BINARY" }, () => checkProperty(fc, {
  name: "throwing-module-body", rule, command: "node --test .smithers/flows/migrate/test/throwing-module.property.test.mjs", regressions: new URL("./corpus/", import.meta.url), numRuns: 16,
  arbitrary: shapes,
  check: (shape) => {
    const text = moduleOf(shape)
    const dir = mkdtempSync(join(tmpdir(), "throwing-module-"))
    try {
      for (const side of ["ts", "vibe"]) {
        const root = join(dir, side)
        mkdirSync(join(root, "src"), { recursive: true })
        writeFileSync(join(root, "package.json"), '{"type":"module"}')
        writeFileSync(join(root, "tsconfig.json"), JSON.stringify({ compilerOptions: { target: "esnext", module: "esnext", moduleResolution: "bundler", strict: true, declaration: true, skipLibCheck: true, types: [], outDir: "out", rootDir: "src" }, include: ["src"] }))
      }
      writeFileSync(join(dir, "ts/src/x.ts"), text)
      const result = splitPlatformToModule(text, "src/x.ts", ts, { throws: true })
      assert.ok(result?.module, JSON.stringify(result))
      assert.ok(result.throwing.includes("check"), JSON.stringify(result))
      writeFileSync(join(dir, "vibe/src/x.vibe"), result.module)
      for (const side of ["ts", "vibe"]) {
        const r = spawnSync(compiler, ["-p", "tsconfig.json"], { cwd: join(dir, side), encoding: "utf8" })
        assert.equal(r.status, 0, `${side}: ${r.stdout}\n${result.module}`)
      }
      assert.equal(exportsOf(join(dir, "vibe/out"), "x.js"), exportsOf(join(dir, "ts/out"), "x.js"))
      const declaration = (side) => canonicalize(ts, readFileSync(join(dir, side, "out/x.d.ts"), "utf8"), "x.d.ts")
      if (!shape.exported) assert.equal(declaration("vibe"), declaration("ts"), result.module)
      else {
        // An exported helper is declared by the body, as by a sibling .ts, and re-exported.
        assert.match(readFileSync(join(dir, "vibe/out/x.d.ts"), "utf8"), /export \{ check \} from "\.\/x\.vibe\.throwing\.js"/)
        assert.ok(existsSync(join(dir, "vibe/out/x.vibe.throwing.d.ts")))
      }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
    return true
  }
}))
