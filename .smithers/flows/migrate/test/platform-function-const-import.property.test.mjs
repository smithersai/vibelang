// A sibling split binds a moved private const that kept code reads to a local
// const of its own name, `const x: typeof x$platform = x$platform`, so a
// closure keeps TypeScript's narrowing. A function or class value has nothing
// to narrow, and in a .vibe module the typed binding of a TypeScript function
// is EK0402 (VIP-4: an unannotated foreign function may throw unknown, which
// the written type does not admit). Such a value comes back as a plain import.
// Witness minimized from opencode's codemode openapi runtime (applyCredentials).
import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import { loadTypeScript } from "../lib/declarations.mjs"
import { platformPath, splitPlatform } from "../lib/platform.mjs"

const runtime = fileURLToPath(new URL("../../../../packages/runtime/", import.meta.url))
const ts = loadTypeScript([runtime])
const fc = createRequire(join(runtime, "package.json"))("fast-check")
const corpus = JSON.parse(readFileSync(new URL("./corpus/opencode-codemode-openapi-runtime-apply-credentials.json", import.meta.url), "utf8"))

function check(files, ambient) {
  const root = mkdtempSync(join(tmpdir(), "migrate-platform-function-const-"))
  try {
    for (const [file, text] of Object.entries({ ...files, "ambient.d.ts": ambient })) {
      mkdirSync(join(root, dirname(file)), { recursive: true })
      writeFileSync(join(root, file), text)
    }
    const options = { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, allowImportingTsExtensions: true, strict: true, declaration: true, emitDeclarationOnly: true, lib: ["lib.es2022.d.ts"], types: [], skipLibCheck: true, outDir: join(root, ".out") }
    const program = ts.createProgram(Object.keys(files).concat("ambient.d.ts").map((f) => join(root, f)), options)
    const errors = ts.getPreEmitDiagnostics(program).filter((d) => d.category === ts.DiagnosticCategory.Error).map((d) => `TS${d.code} ${ts.flattenDiagnosticMessageText(d.messageText, " ")}`)
    const out = {}
    program.emit(undefined, (name, text) => { out[name.slice(name.lastIndexOf("/") + 1)] = text })
    return { errors, out }
  } finally { rmSync(root, { recursive: true, force: true }) }
}

function split(file, text, globals, ambient) {
  const before = check({ [file]: text }, ambient)
  assert.deepEqual(before.errors, [], "the original compiles")
  const result = splitPlatform(text, file, ts, { globals })
  assert.ok(result && !result.refused, result?.refused ?? "nothing split")
  const after = check({ [file.replace(/\.ts$/, ".vibe.ts")]: result.module, [platformPath(file)]: result.platform }, ambient)
  assert.deepEqual(after.errors, [], result.module)
  const name = file.slice(file.lastIndexOf("/") + 1).replace(/\.ts$/, "")
  assert.equal(after.out[`${name}.vibe.d.ts`], before.out[`${name}.d.ts`])
  return result
}

test("opencode codemode runtime: a moved function const comes back as a plain import", () => {
  const { module } = split(corpus.file, corpus.text, corpus.globals, corpus.ambient)
  assert.doesNotMatch(module, /: typeof applyCredentials\$platform/, module)
  assert.match(module, /import \{[^}]*\bapplyCredentials\b[^}]*\} from "\.\/runtime\.platform\.ts"/, module)
})

// Neighbourhood: function, function-expression, class and data consts moved
// beside each other. Only a data const keeps the typed local binding.
test("only a narrowable moved const is bound to a typed local const", () => {
  const ambient = "declare var process: { readonly env: Record<string, string | undefined> }\n"
  const kinds = {
    arrow: (i) => `const v${i} = (s: string) => s + (process.env.A ?? "")\n`,
    expression: (i) => `const v${i} = function (s: string) { return s + (process.env.A ?? "") }\n`,
    asserted: (i) => `const v${i} = ((s: string) => s + (process.env.A ?? "")) as (s: string) => string\n`,
    class: (i) => `const v${i} = class { readonly a = process.env.A ?? "" }\n`,
    data: (i) => `const v${i}: { readonly a: string } | null = process.env.A ? { a: process.env.A } : null\n`,
  }
  const use = { arrow: (i) => `v${i}("x")`, expression: (i) => `v${i}("x")`, asserted: (i) => `v${i}("x")`, class: (i) => `new v${i}().a`, data: (i) => `(v${i} ? v${i}.a : "")` }
  fc.assert(fc.property(fc.array(fc.constantFrom(...Object.keys(kinds)), { minLength: 1, maxLength: 4 }), fc.boolean(), (picked, closure) => {
    const text = picked.map((k, i) => kinds[k](i)).join("") + picked.map((k, i) => closure ? `export const e${i} = () => ${use[k](i)}\n` : `export const e${i} = ${use[k](i)}\n`).join("")
    const { module } = split("src/m.ts", text, ["process"], ambient)
    picked.forEach((k, i) => {
      const bound = new RegExp(`const v${i}: typeof v${i}\\$platform`).test(module)
      assert.equal(bound, k === "data", `${k} v${i}:\n${module}`)
    })
  }), { numRuns: 60 })
})
