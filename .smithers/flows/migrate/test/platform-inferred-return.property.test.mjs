// The platform split kept an export that uses platform code only when it was
// a function with written parameter and return types. 28 Smithers modules
// stayed TypeScript for an arrow whose return type TypeScript infers, such as
// `export const digestNpmrc = async (npmrc: string) => { ... }`. The wrapper
// now leaves that type inferred: it returns the moved function's result, so
// its type is the same type. The module's declaration prints it from the
// sibling, where a type only the sibling declares has no name; the moved
// code imports the module's exported types instead of copying them, and a
// private type or class keeps the module in TypeScript.
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
const corpus = JSON.parse(readFileSync(new URL("./corpus/smithers-platform-split-inferred-return.json", import.meta.url), "utf8"))

// Stock TypeScript over the files, with declarations: the errors, and each
// export of entry as a fully qualified type, which names a type by the file
// that declares it whatever the module imports.
function check(files, ambient, entry) {
  const root = mkdtempSync(join(tmpdir(), "migrate-platform-inferred-"))
  try {
    for (const [file, text] of Object.entries({ ...files, "ambient.d.ts": ambient })) {
      mkdirSync(join(root, dirname(file)), { recursive: true })
      writeFileSync(join(root, file), text)
    }
    const options = { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, allowImportingTsExtensions: true, strict: true, noUnusedLocals: true, declaration: true, emitDeclarationOnly: true, lib: ["lib.es2022.d.ts"], types: [], skipLibCheck: true, outDir: join(root, ".out") }
    const program = ts.createProgram(Object.keys(files).concat("ambient.d.ts").map((f) => join(root, f)), options)
    const emitted = program.emit()
    const errors = [...ts.getPreEmitDiagnostics(program), ...emitted.diagnostics].filter((d) => d.category === ts.DiagnosticCategory.Error).map((d) => `TS${d.code} ${ts.flattenDiagnosticMessageText(d.messageText, " ")}`)
    const checker = program.getTypeChecker()
    const source = program.getSourceFile(join(root, entry))
    const flags = ts.TypeFormatFlags.NoTruncation | ts.TypeFormatFlags.UseFullyQualifiedType
    const types = {}
    for (const symbol of checker.getExportsOfModule(checker.getSymbolAtLocation(source))) {
      const type = symbol.flags & ts.SymbolFlags.Value ? checker.getTypeOfSymbolAtLocation(symbol, source) : checker.getDeclaredTypeOfSymbol(symbol)
      // The module's own declarations print bare or through import("./m"); a copy the sibling declared would name m.platform.
      types[symbol.name] = checker.typeToString(type, undefined, flags).replaceAll(root, "<root>").replaceAll(`import("<root>/${entry.replace(/\.ts$/, "")}").`, "")
    }
    return { errors, types }
  } finally { rmSync(root, { recursive: true, force: true }) }
}

// The split compiles, with declarations, and each export has the type it had.
function assertSplitPreserves(file, text, ambient, others = {}) {
  const before = check({ ...others, [file]: text }, ambient, file)
  assert.deepEqual(before.errors, [], "the original compiles")
  const split = splitPlatform(text, file, ts)
  assert.ok(split, "the module imports a builtin")
  if (split.refused) return split
  // The module stays at its path, which the sibling's import type names.
  const after = check({ ...others, [file]: split.module, [platformPath(file)]: split.platform }, ambient, file)
  assert.deepEqual(after.errors, [], split.module + "\n---\n" + split.platform)
  assert.deepEqual(after.types, before.types, split.module + "\n---\n" + split.platform)
  return split
}

test("smithers: an export with an inferred return type stays in the module with that type", () => {
  for (const { file, text, wrapped } of corpus.modules) {
    const split = assertSplitPreserves(file, text, corpus.ambient, corpus.others)
    assert.ok(!split.refused, `${file}: ${split.refused}`)
    assert.deepEqual(split.wrapped, wrapped, file)
    // The module's exported types stay the module's; the sibling imports them.
    for (const name of ["ServerOptions", "Row"]) assert.ok(!new RegExp(`^(?:export )?interface ${name}\\b`, "m").test(split.platform), `${file}: the sibling copies ${name}`)
  }
})

test("an inferred return type that may name a type only the sibling declares keeps the refusal", () => {
  const privateType = 'import { readFileSync } from "node:fs"\ninterface Row { readonly id: string }\nexport const readRows = (path: string) => JSON.parse(readFileSync(path, "utf8")) as ReadonlyArray<Row>\n'
  assert.match(splitPlatform(privateType, "src/Rows.ts", ts).refused, /inferred return type that may name Row/)
  const privateClass = 'import { readFileSync } from "node:fs"\nclass Handle { constructor(readonly text: string) {} }\nexport const open = (path: string) => new Handle(readFileSync(path, "utf8"))\n'
  assert.match(splitPlatform(privateClass, "src/Open.ts", ts).refused, /inferred return type that may name Handle/)
  // A parameter with no written type has no signature to write: the function is re-exported instead.
  const untyped = 'import { readFileSync } from "node:fs"\nexport const read = (path) => readFileSync(path, "utf8")\nexport const name = "read"\n'
  const split = splitPlatform(untyped, "src/Read.ts", ts)
  assert.deepEqual([split.wrapped, split.reexported], [[], ["read"]])
})

// Neighbourhood: an inferred platform export over each parameter form, sync
// or async, generic or not, returning a builtin's value, another module's
// type, the module's exported type or a private one, beside an exported or
// private interface. The split refuses, or compiles with declarations and
// keeps every export's fully qualified type.
test("an inferred-return wrapper keeps every export's type, or the split refuses", () => {
  const ambient = 'declare module "node:fs" { export function readFileSync(path: string, encoding: "utf8"): string }\n'
  const others = { "lib.ts": "export interface Box<A> {\n  readonly value: A\n}\nexport const box = <A>(value: A): Box<A> => ({ value })\n" }
  const params = fc.constantFrom("(path: string)", "(path: string, n = 1)", "(path: string, ...rest: number[])", "<T>(path: string)", "<T extends Shape>(path: string)")
  const result = fc.constantFrom("text", "Lib.box(text)", "({ n: text.length }) as Shape", "JSON.parse(text) as T[]", "text.length > 0")
  let splits = 0, runs = 0
  fc.assert(fc.property(params, result, fc.boolean(), fc.boolean(), fc.boolean(), (param, value, async, exportedShape, declared) => {
    fc.pre(!value.includes("T[]") || param.startsWith("<T"))
    const shape = `${exportedShape ? "export " : ""}interface Shape {\n  readonly n: number\n}\n`
    const fn = declared
      ? `export ${async ? "async " : ""}function read${param} {\n  const text = readFileSync(path, "utf8")\n  return ${value}\n}\n`
      : `export const read = ${async ? "async " : ""}${param} => {\n  const text = readFileSync(path, "utf8")\n  return ${value}\n}\n`
    const uses = exportedShape ? "" : "export const size = (s: Shape): number => s.n\n"
    const lib = value.includes("Lib.") ? 'import * as Lib from "./lib.ts"\n' : ""
    const text = `import { readFileSync } from "node:fs"\n${lib}${shape}${fn}${uses}`
    const before = check({ ...others, "m.ts": text }, ambient, "m.ts")
    fc.pre(before.errors.length === 0)
    runs++
    if (!assertSplitPreserves("m.ts", text, ambient, others).refused) splits++
  }), { numRuns: 60 })
  assert.ok(splits > runs / 3, `only ${splits} of ${runs} modules split`)
})
