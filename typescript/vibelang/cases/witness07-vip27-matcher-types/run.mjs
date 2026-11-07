// run-seconds: 240
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import ts from "../../../../docs/tools/node_modules/typescript/lib/typescript.js"

function fixture(files, { switches = false, roots, extra = {} } = {}, action) {
  const dir = mkdtempSync(join(tmpdir(), "witness07-matcher-"))
  try {
    writeFileSync(join(dir, "package.json"), "{\"type\":\"module\"}")
    mkdirSync(join(dir, "node_modules"))
    symlinkSync(join(process.env.EFFECT_NODE_MODULES, "effect"), join(dir, "node_modules/effect"))
    symlinkSync(process.env.VIBELANG_RUNTIME, join(dir, "node_modules/vibelang-runtime"))
    for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text)
    const compilerOptions = { target: "ES2022", module: "NodeNext", strict: true, types: [], skipLibCheck: true, jsx: "preserve", outDir: "out", declaration: true, ...extra }
    writeFileSync(join(dir, "tsconfig.json"), JSON.stringify({ compilerOptions, files: roots ?? Object.keys(files), vibe: { effectGlobals: switches, effectModules: switches } }))
    const r = spawnSync(process.env.VIBELANG_BINARY, ["-p", ".", "--pretty", "false"], { cwd: dir, encoding: "utf8", timeout: 60000 })
    action({ dir, r, text: r.stdout + r.stderr, codes: [...(r.stdout + r.stderr).matchAll(/error ((?:TS|EK)\d+):/g)].map(m => m[1]) })
  } finally { rmSync(dir, { recursive: true, force: true }) }
}
const node = (dir, code) => {
  const r = spawnSync(process.execPath, ["--input-type=module", "-e", code], { cwd: dir, encoding: "utf8", timeout: 30000 })
  assert.equal(r.status, 0, r.stdout + r.stderr)
  return r.stdout.trim()
}

// Every .vibe and .vibex file sees SymbolConstructor.customMatcher, with no
// import, whatever the Effect prelude switches say. Its declarations add no
// runtime reference and no member the source did not write.
const user = "export const key: typeof Symbol.customMatcher = Symbol.customMatcher\nexport class Numeric {\n  static [Symbol.customMatcher](s: unknown): boolean { return s === 1 }\n}\n"
for (const suffix of [".vibe", ".vibex"]) for (const switches of [false, true]) {
  fixture({ ["main" + suffix]: user }, { switches }, ({ dir, r, text }) => {
    const label = JSON.stringify({ suffix, switches })
    assert.equal(r.status, 0, label + "\n" + text)
    for (const declaration of ["out/main.d.ts", "main.d" + suffix + ".ts"]) {
      const d = readFileSync(join(dir, declaration), "utf8")
      assert.doesNotMatch(d, /reference types=/, label + " " + declaration)
      assert.equal((d.match(/static \[/g) || []).length, 1, label + ": only the written matcher member")
    }
  })
}

// A .ts file in a program that contains the provider, the runtime a .vibe
// file's use of the key loads, sees the ambient property; stock TypeScript
// alone does not declare it, and neither does a program without the provider.
const helper = "export const seen: typeof Symbol.customMatcher | undefined = Symbol.customMatcher\n"
fixture({ "main.vibe": "export const witness = 1\n", "helper.ts": helper }, {}, ({ codes, text }) => {
  assert.deepEqual(codes, ["TS2339", "TS2339"], "no provider in the program\n" + text)
})
fixture({ "main.vibe": "export const key = Symbol.customMatcher\n", "helper.ts": helper }, {}, ({ dir, r, text }) => {
  assert.equal(r.status, 0, text)
  const stock = ts.createProgram([join(dir, "helper.ts")], { noEmit: true, strict: true, types: [], target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.NodeNext })
  assert.deepEqual(ts.getPreEmitDiagnostics(stock).map(d => d.code), [2339, 2339], "stock control: SymbolConstructor has no customMatcher")

  // TypeScript modules keep ordinary dependency order: the compiler adds no
  // initialization import, so the key exists only once the module imports
  // vibelang-runtime first. Seeing the type is not initialization.
  assert.equal(readFileSync(join(dir, "out/helper.js"), "utf8").trim(), "export const seen = Symbol.customMatcher;")
  assert.equal(node(dir, "const m = await import(\"./out/helper.js\"); console.log(typeof m.seen)"), "undefined")
  writeFileSync(join(dir, "first.mjs"), "import \"vibelang-runtime\"\nimport { seen } from \"./out/helper.js\"\nimport { customMatcher } from \"vibelang-runtime\"\nconsole.log(typeof seen, seen === customMatcher)\n")
  assert.equal(node(dir, "await import(\"./first.mjs\")"), "symbol true")
})

// Symbol.customMatcher has the unique symbol type of the runtime export: each
// is assignable to the other, and another unique symbol is not.
fixture({ "main.vibe": "import { customMatcher } from \"vibelang-runtime\"\nexport const a: typeof customMatcher = Symbol.customMatcher\nexport const b: typeof Symbol.customMatcher = customMatcher\n" }, {}, ({ dir, r, text }) => {
  assert.equal(r.status, 0, text)
  assert.equal(node(dir, "const m = await import(\"./out/main.js\"); console.log(m.a === m.b)"), "true")
})
fixture({ "main.vibe": "declare const other: unique symbol\nexport const c: typeof Symbol.customMatcher = other\n" }, {}, ({ codes, text }) => {
  assert.deepEqual(codes, ["TS2322"], text)
})
console.log("matcher type is program-wide and the runtime export's; initialization stays explicit")
