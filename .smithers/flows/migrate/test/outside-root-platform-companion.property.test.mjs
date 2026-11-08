// A package can re-export a helper above its own directory that its project
// lists. When the helper is native and keeps its code in a named module body
// (VIP-40), the compiler's compatibility declaration beside the helper
// re-exports from the body's generated companion. Both are outside rootDir, so
// emit refuses them (TS6059) and the declaration snapshot stores them itself.
// The API is the one the plain TypeScript helper had (t3code apps/server,
// scripts/lib/linux-arm64-sea.vibe).
import assert from "node:assert/strict"
import { test } from "node:test"
import { createRequire } from "node:module"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, posix } from "node:path"
import { fileURLToPath } from "node:url"
import { compareDeclarations, emitDeclarations, recordDeclarationSurface } from "../lib/declarations.mjs"
import { checkProperty } from "../../../../scripts/testing/property.mjs"

const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const ts = require("typescript"), fc = require("fast-check")
const modules = fileURLToPath(new URL("../../../../packages/runtime/node_modules", import.meta.url))
const binary = process.env.VIBELANG_BINARY ?? fileURLToPath(new URL("../../../../packages/compiler/native/vibelang", import.meta.url))
const corpus = JSON.parse(readFileSync(new URL("./corpus/t3code-outside-root-platform-companion.json", import.meta.url), "utf8"))
const put = (file, text) => { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, text) }

const value = { number: "n + 1", string: "String(n)" }
const fn = ({ name, returns }, exported) => `${exported ? "export " : ""}function ${name}(n: number) { return ${value[returns]} }`
// The plain TypeScript helper, and the same helper with its code in a body.
// A function the parent does not re-export is the body's own export only.
function helperText(shape, kind) {
  const reexported = shape.functions.filter(f => f.reexported).map(f => f.name)
  const own = shape.own ? "export const own = 1\n" : ""
  if (kind === "ts") return shape.functions.map(f => fn(f, f.reexported)).join("\n") + "\n" + own
  if (kind === "plain") return shape.functions.map(f => fn(f, f.reexported)).join("\n") + "\n" + own
  return `module ${shape.body} {\n${shape.functions.map(f => "  " + fn(f, true)).join("\n")}\n}\n` +
    (reexported.length ? `export { ${reexported.join(", ")} } from ${shape.body}\n` : "") + own
}
const exported = shape => [...shape.functions.filter(f => f.reexported).map(f => f.name), ...(shape.own ? ["own"] : [])]

// One side of the comparison: emit, record the snapshot, and record it again
// without emit diagnostics as a later setup read does.
async function side(parent, name, shape, kind, { names = exported(shape), stale } = {}) {
  const root = join(parent, name)
  const file = shape.helper + (kind === "ts" ? ".ts" : ".vibe")
  put(join(root, file), helperText(shape, kind))
  const companion = join(root, file + "." + shape.body + ".d.ts")
  if (stale) put(companion, stale)
  symlinkSync(modules, join(root, "node_modules"), "dir")
  const pkg = join(root, shape.consumer)
  const manifest = { name: "consumer", private: true, type: "module", types: "./index.ts" }
  const specifier = posix.relative(shape.consumer, file)
  put(join(pkg, "package.json"), JSON.stringify(manifest))
  put(join(pkg, "index.ts"), `export { ${names.join(", ")} } from ${JSON.stringify(specifier)}\n`)
  put(join(pkg, "tsconfig.json"), JSON.stringify({ compilerOptions: {
    strict: true, target: "ESNext", module: "Preserve", moduleResolution: "Bundler", types: [], rootDir: ".",
    rewriteRelativeImportExtensions: true, declaration: true, skipLibCheck: true,
  }, vibe: { effectGlobals: false, effectModules: false }, include: ["index.ts", specifier] }))
  const dir = join(parent, name + "-snapshot")
  // As the flow does, emit and record against the repository root.
  const result = await emitDeclarations({ compiler: binary, tsconfig: "tsconfig.json", cwd: pkg, root,
    outDir: dir, log: join(parent, name + ".log"), typescript: ts })
  assert.ok(result.diagnostics.some(d => d.code === "TS6059"), JSON.stringify(result.diagnostics))
  const project = [{ tsconfig: "tsconfig.json", prefix: "." }]
  recordDeclarationSurface(ts, dir, pkg, project, manifest, { emitDiagnostics: result.diagnostics, emitRoot: root, outsideRoot: result.outsideRoot })
  recordDeclarationSurface(ts, dir, pkg, project, manifest)
  if (stale) assert.equal(readFileSync(companion, "utf8"), stale, "emit restores a file it did not create")
  return dir
}

async function compare(before, after) {
  const parent = mkdtempSync(join(tmpdir(), "outside-root-platform-"))
  try {
    return compareDeclarations(ts, await side(parent, "before", ...before), await side(parent, "after", ...after), { canonical: true, includePrivate: true })
  } finally { rmSync(parent, { recursive: true, force: true }) }
}
const blockers = result => result.environmentDiagnostics.filter(d => d.blocking)
const identical = result => {
  assert.deepEqual(blockers(result), [], JSON.stringify(result.environmentDiagnostics))
  assert.equal(result.comparisonComplete, true, JSON.stringify(result))
  assert.equal(result.identical, true, JSON.stringify(result))
}
test("the module-body property quotes the current specification", () => {
  const specification = readFileSync(new URL("../../../../docs/design/src/001-functions.md", import.meta.url), "utf8")
  assert.ok(specification.includes(corpus.rule), "module-body rule changed; review the property oracle")
})

const minimum = corpus.input
const hidden = { ...minimum, functions: [...minimum.functions, { name: "g", returns: "number", reexported: false }] }

test("control: a plain TypeScript helper above the package compares complete and identical", async () =>
  identical(await compare([minimum, "ts"], [minimum, "ts"])))

test("control: a native helper above the package without a module body compares identical", async () =>
  identical(await compare([minimum, "ts"], [minimum, "plain"])))

test("a native helper above the package keeps its module body's companion", async () =>
  identical(await compare([minimum, "ts"], [minimum, "body"])))

test("a stale companion beside the helper does not replace the one emit wrote", async () =>
  identical(await compare([minimum, "ts"], [minimum, "body", { stale: "export declare function f(n: number): string;\n" }])))

test("a companion export the helper does not re-export stays out of the API", async () =>
  identical(await compare([minimum, "body"], [hidden, "body"])))

test("a changed function in the companion is a type difference", async () => {
  const result = await compare([minimum, "ts"], [{ ...minimum, functions: [{ ...minimum.functions[0], returns: "string" }] }, "body"])
  assert.equal(result.comparisonComplete, true, JSON.stringify(result))
  assert.equal(result.identical, false)
  assert.ok(result.typeDifferences.some(d => d.export === "f"), JSON.stringify(result.typeDifferences))
})

test("a native helper that stops re-exporting its body's function is still a missing export", async () => {
  const result = await compare([minimum, "ts"], [{ ...minimum, functions: [{ ...minimum.functions[0], reexported: false }], own: true }, "body", { names: ["f"] }])
  assert.equal(result.identical, false, JSON.stringify(result))
  assert.ok(result.nameDifferences.some(d => d.export === "f" && d.side === "before"), JSON.stringify(result))
})

// The neighbourhood: body names that need escaping in the companion's file
// name, helpers at several depths above the package, several functions with
// some kept private to the body, and the parent's own exports beside the body.
const shapes = fc.record({
  consumer: fc.constantFrom("consumer", "apps/server"),
  helper: fc.constantFrom("helper", "scripts/lib/linux-arm64-sea", "lib/a.b"),
  body: fc.constantFrom("platform", "host_io", "Node", "p2"),
  functions: fc.uniqueArray(fc.record({ name: fc.constantFrom("f", "g", "assertPage", "h2"),
    returns: fc.constantFrom("number", "string"), reexported: fc.boolean() }), { minLength: 1, maxLength: 3, selector: f => f.name })
    .filter(functions => functions.some(f => f.reexported)),
  own: fc.boolean(),
})
const rule = corpus.rule
test("property: an outside-root helper's module body keeps the plain helper's API", () => checkProperty(fc, {
  name: corpus.property, rule, command: "node --test .smithers/flows/migrate/test/outside-root-platform-companion.property.test.mjs",
  regressions: new URL("./corpus/", import.meta.url), numRuns: 6, arbitrary: shapes,
  check: async shape => {
    identical(await compare([shape, "ts"], [shape, "body"]))
    // Changing one re-exported function's type is still seen through the companion.
    const target = shape.functions.find(f => f.reexported)
    const changed = { ...shape, functions: shape.functions.map(f => f === target ? { ...f, returns: f.returns === "number" ? "string" : "number" } : f) }
    const result = await compare([shape, "ts"], [changed, "body"])
    assert.equal(result.comparisonComplete, true, JSON.stringify(result))
    assert.ok(result.typeDifferences.some(d => d.export === target.name), JSON.stringify(result.typeDifferences))
    return true
  }
}))
