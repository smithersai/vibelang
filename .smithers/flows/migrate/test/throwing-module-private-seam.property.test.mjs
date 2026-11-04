import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { checkProperty } from "../../../../scripts/testing/property.mjs"
import { canonicalize } from "../lib/declarations.mjs"
import { splitPlatformToModule } from "../lib/platform.mjs"

// platform-body:internal-export-TS2883 (drive-t3code-apps 2026-11-04T02:23:57Z):
// the throw route exported every private declaration it moved into a body.
// VIP-40's copy rule declares a body as a sibling .ts file, so an export whose
// inferred type names an unexported type is TS2883 there, though the original
// never declared it. A body now exports a private value only for kept code
// that reads it, or a type a kept declaration may name through typeof.

const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const fc = require("fast-check")
const ts = require("typescript")
const compiler = process.env.VIBELANG_BINARY
const corpus = JSON.parse(readFileSync(new URL("./corpus/t3code-throwing-module-private-seam.json", import.meta.url), "utf8"))
const split = (text) => splitPlatformToModule(text, corpus.file, ts, { throws: true })
const bodyOf = (module) => module.slice(module.indexOf("module throwing {"), module.indexOf("\n}\n") + 2)

test("a private const only the body reads stays private in the body (t3code themePalette)", () => {
  const { module } = split(corpus.text)
  const body = bodyOf(module)
  assert.match(body, /^const hidden = make\(\)$/m)
  assert.match(body, /^export function read\(\)/m)
  assert.doesNotMatch(module, /import \{[^}]*hidden[^}]*\} from throwing/)
  assert.match(module, /^export \{ read \} from throwing$/m)
})

// What a kept declaration may still need from the body stays exported.
const shapes = fc.record({ init: fc.constantFrom("call", "literal", "symbol", "class"), keptReads: fc.boolean(), typeofQuery: fc.boolean() })
const moduleOf = (s) => [
  `import { make } from "dep"`,
  `const seam = ${{ call: "make()", literal: "{ n: 7 }", symbol: `Symbol("seam")`, class: "class { n = 7 }" }[s.init]}`,
  `export function read(): number {`,
  `  if (!seam) throw new Error("missing")`,
  `  return 1`,
  `}`,
  s.keptReads ? `export const kept = () => seam` : `export const kept = 42`,
  s.typeofQuery ? `export type Seam = typeof seam` : ``
].filter(Boolean).join("\n") + "\n"
const exported = (s) => s.keptReads || s.typeofQuery || s.init === "symbol" || s.init === "class"

test("a body exports a private value exactly when kept code reads it or may name its type", () => checkProperty(fc, {
  name: "throwing-module-private-seam", rule: "A body is a TypeScript file stored inside a `.vibe` file.", command: "node --test .smithers/flows/migrate/test/throwing-module-private-seam.property.test.mjs", numRuns: 64,
  arbitrary: shapes,
  check: (shape) => {
    const { module } = split(moduleOf(shape))
    assert.equal(/^export const seam/m.test(bodyOf(module)), exported(shape), module)
    return true
  }
}))

const write = (root, files) => { for (const [name, text] of Object.entries(files)) { mkdirSync(dirname(join(root, name)), { recursive: true }); writeFileSync(join(root, name), text) } }
const exportsOf = (file) => {
  const r = spawnSync(process.execPath, ["--input-type=module", "-e", `const m = await import(${JSON.stringify(file)}); console.log(JSON.stringify(Object.keys(m).sort().map((k) => [k, typeof m[k] === "function" ? m[k]() : m[k]])))`], { encoding: "utf8" })
  assert.equal(r.status, 0, r.stderr)
  return r.stdout
}

test("the themePalette shape compiles with the original's declarations and exports", { skip: !compiler && "set VIBELANG_BINARY" }, () => {
  const dir = mkdtempSync(join(tmpdir(), "private-seam-"))
  try {
    const { module } = split(corpus.text)
    for (const [side, file, text] of [["ts", "src/x.ts", corpus.text], ["vibe", "src/x.vibe", module]]) {
      const root = join(dir, side)
      write(root, {
        "package.json": '{"type":"module"}',
        "tsconfig.json": JSON.stringify({ compilerOptions: { target: "esnext", module: "esnext", moduleResolution: "bundler", strict: true, declaration: true, skipLibCheck: true, types: [], outDir: "out", rootDir: "src" }, include: ["src"] }),
        [file]: text,
        ...Object.fromEntries(Object.entries(corpus.dep).map(([n, t]) => [`node_modules/dep/${n}`, t]))
      })
      const r = spawnSync(compiler, ["-p", "tsconfig.json"], { cwd: root, encoding: "utf8" })
      assert.equal(r.status, 0, `${side}: ${r.stdout}\n${module}`)
    }
    const declaration = (side) => canonicalize(ts, readFileSync(join(dir, side, "out/x.d.ts"), "utf8"), "x.d.ts")
    const sidecar = existsSync(join(dir, "vibe/out/x.d.ts")) ? "x.d.ts" : "x.d.vibe.ts"
    assert.equal(sidecar, "x.d.ts")
    // read is re-exported from the body, as the original exports it; hidden appears nowhere.
    const body = readFileSync(join(dir, "vibe/out/x.vibe.throwing.d.ts"), "utf8")
    assert.doesNotMatch(body, /hidden/)
    assert.match(readFileSync(join(dir, "vibe/out/x.d.ts"), "utf8"), /export \{ read \} from "\.\/x\.vibe\.throwing\.js"/)
    assert.match(declaration("ts"), /read\(\): number/)
    assert.equal(exportsOf(join(dir, "vibe/out/x.js")), exportsOf(join(dir, "ts/out/x.js")))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
