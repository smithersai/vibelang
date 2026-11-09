// A package can list a helper that sits inside its own directory but outside
// rootDir, such as scripts/helper.vibe beside src/, and re-export it. Emit
// refuses the helper (TS6059), so the declaration snapshot stores the
// compiler's compatibility declaration in its place, as it stores the source
// of a plain TypeScript helper. Neither is a deep entry of a package without
// `exports`: the helper counts through the package modules that re-export it.
import assert from "node:assert/strict"
import { test } from "node:test"
import { createRequire } from "node:module"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { compareDeclarations, emitDeclarations, recordDeclarationSurface } from "../lib/declarations.mjs"
import { checkProperty } from "../../../../scripts/testing/property.mjs"

const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const ts = require("typescript"), fc = require("fast-check")
const modules = fileURLToPath(new URL("../../../../packages/runtime/node_modules", import.meta.url))
const binary = process.env.VIBELANG_BINARY ?? fileURLToPath(new URL("../../../../packages/compiler/native/vibelang", import.meta.url))
const corpus = JSON.parse(readFileSync(new URL("./corpus/in-package-native-helper-entry.json", import.meta.url), "utf8"))
const put = (file, text) => { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, text) }

// One side: package `consumer` with rootDir src, whose index is src/index.ts,
// and one helper at <dir>/<helper>.<ext> that the project lists.
const helperText = ({ kind, body = "platform", returns = "number" }) => {
  const f = `export function f(n: number) { return ${returns === "number" ? "n + 1" : "String(n)"} }`
  return kind === "body" ? `module ${body} {\n  ${f}\n}\nexport { f } from ${body}\n` : f + "\n"
}
async function snapshot(parent, name, shape) {
  const root = join(parent, name), pkg = join(root, "consumer")
  const dir = shape.dir ?? "scripts", helper = shape.helper ?? "helper"
  const file = `${dir}/${helper}.${shape.kind === "ts" ? "ts" : "vibe"}`
  put(join(pkg, file), helperText(shape))
  put(join(pkg, "src/index.ts"), shape.reexported === false ? "export const x = 1\n" : `export { f } from "../${file}"\n`)
  const manifest = { name: "consumer", private: true, type: "module", types: "./src/index.ts" }
  put(join(pkg, "package.json"), JSON.stringify(manifest))
  put(join(pkg, "tsconfig.json"), JSON.stringify({ compilerOptions: {
    strict: true, target: "ESNext", module: "Preserve", moduleResolution: "Bundler", types: [], rootDir: "src",
    rewriteRelativeImportExtensions: true, declaration: true, skipLibCheck: true,
  }, vibe: { effectGlobals: false, effectModules: false }, include: ["src/index.ts", file] }))
  symlinkSync(modules, join(root, "node_modules"), "dir")
  const out = join(parent, name + "-snapshot")
  const result = await emitDeclarations({ compiler: binary, tsconfig: "tsconfig.json", cwd: pkg, root, outDir: out,
    log: join(parent, name + ".log"), typescript: ts })
  const project = [{ tsconfig: "tsconfig.json", prefix: "." }]
  recordDeclarationSurface(ts, out, pkg, project, manifest, { emitDiagnostics: result.diagnostics, emitRoot: root, outsideRoot: result.outsideRoot })
  // A metadata refresh without emit keeps what the emit saved.
  recordDeclarationSurface(ts, out, pkg, project, manifest)
  return out
}
async function compare(before, after, options = { canonical: true, includePrivate: true }) {
  const parent = mkdtempSync(join(tmpdir(), "in-package-helper-"))
  try {
    return compareDeclarations(ts, await snapshot(parent, "before", before), await snapshot(parent, "after", after), options)
  } finally { rmSync(parent, { recursive: true, force: true }) }
}
const summary = result => JSON.stringify({ complete: result.comparisonComplete, identical: result.identical,
  blocking: result.environmentDiagnostics.filter(d => d.blocking).map(d => d.code),
  names: result.nameDifferences.map(d => `${d.side}:${d.entry ?? d.entrypoint}:${d.export}`),
  types: result.typeDifferences.map(d => `${d.entry ?? d.entrypoint}:${d.export}`) })
const identical = result => {
  assert.equal(result.comparisonComplete, true, summary(result))
  assert.equal(result.identical, true, summary(result))
}
const differsOnF = result => {
  assert.equal(result.comparisonComplete, true, summary(result))
  assert.ok(result.typeDifferences.some(d => d.export === "f"), summary(result))
}

test("control: a plain TypeScript helper outside rootDir compares identical with itself", async () =>
  identical(await compare({ kind: "ts" }, { kind: "ts" })))

test("a native helper outside rootDir, inside the package, adds no deep entry", async () =>
  identical(await compare({ kind: "ts" }, { kind: "native" })))

test("a native helper with a module body adds no deep entry and resolves its companion", async () =>
  identical(await compare({ kind: "ts" }, { kind: "body" })))

test("the published view agrees", async () =>
  identical(await compare({ kind: "ts" }, { kind: "native" }, { canonical: true })))

test("a changed type in the native helper is still a difference", async () => {
  differsOnF(await compare({ kind: "ts" }, { kind: "native", returns: "string" }))
  differsOnF(await compare({ kind: "ts" }, { kind: "body", returns: "string" }))
})

// A helper that no package module re-exports is reachable through no entry.
// The native helper must compare as the plain TypeScript helper does.
test("a helper nothing re-exports compares as its TypeScript twin does", async () => {
  const plain = await compare({ kind: "ts", reexported: false }, { kind: "ts", reexported: false, returns: "string" })
  const native = await compare({ kind: "native", reexported: false }, { kind: "native", reexported: false, returns: "string" })
  assert.equal(plain.comparisonComplete, true, summary(plain))
  assert.deepEqual([native.comparisonComplete, native.identical], [plain.comparisonComplete, plain.identical], summary(native))
})

test("the property's rule is the VIP-40 sentence the companion property checks", () => {
  const companion = JSON.parse(readFileSync(new URL("./corpus/t3code-outside-root-platform-companion.json", import.meta.url), "utf8"))
  assert.equal(corpus.rule, companion.rule)
})

const shapes = fc.record({
  dir: fc.constantFrom("scripts", "tools/lib", "build"),
  helper: fc.constantFrom("helper", "linux-arm64-sea", "a.b"),
  body: fc.constantFrom("platform", "host_io", "Node", "p2"),
  returns: fc.constantFrom("number", "string"),
})
test("property: a module body in an in-package helper outside rootDir keeps the plain helper's API", () => checkProperty(fc, {
  name: corpus.property, rule: corpus.rule, command: "node --test .smithers/flows/migrate/test/in-package-native-helper-entry.property.test.mjs",
  regressions: new URL("./corpus/", import.meta.url), numRuns: 6, arbitrary: shapes,
  check: async shape => {
    identical(await compare({ ...shape, kind: "ts" }, { ...shape, kind: "body" }))
    differsOnF(await compare({ ...shape, kind: "ts" }, { ...shape, kind: "body", returns: shape.returns === "number" ? "string" : "number" }))
    return true
  }
}))
