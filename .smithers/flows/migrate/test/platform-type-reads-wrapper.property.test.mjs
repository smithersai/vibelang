// The platform split refused a module whose kept type reads an exported
// function the split moves, `export type Timer = ReturnType<typeof
// createTimer>`, as if the value left the module (opencode app composer,
// editor and interaction, gui-plugins browser and chromium, core instance).
// A moved export stays in the module as a wrapper of the same name and
// signature, so the type reads the wrapper and every export keeps its type.
// A kept type that reads a moved value with no wrapper keeps the refusal.
import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import { SpecPath } from "../../../../scripts/testing/spec-path.mjs"
import { loadTypeScript } from "../lib/declarations.mjs"
import { platformPath, splitPlatform } from "../lib/platform.mjs"

const runtime = fileURLToPath(new URL("../../../../packages/runtime/", import.meta.url))
const ts = loadTypeScript([runtime])
const fc = createRequire(join(runtime, "package.json"))("fast-check")
const corpus = JSON.parse(readFileSync(new URL("./corpus/opencode-platform-split-type-reads-wrapper.json", import.meta.url), "utf8"))
const quote = "A quick fix is offered only when it preserves evaluation order, coldness, types, comments, and declaration output"
const moveQuote = "The quick fix and the codemod move the code into a sibling"

// Stock TypeScript over the files, with declarations: the errors, and each
// export of entry as a fully qualified type.
function check(files, ambient, entry) {
  const root = mkdtempSync(join(tmpdir(), "migrate-platform-type-wrapper-"))
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
      types[symbol.name] = checker.typeToString(type, undefined, flags).replaceAll(root, "<root>").replaceAll(`import("<root>/${entry.replace(/\.ts$/, "")}").`, "")
    }
    return { errors, types }
  } finally { rmSync(root, { recursive: true, force: true }) }
}

// The split compiles, with declarations, and each export has the type it had.
function assertSplitPreserves(file, text, ambient, globals = []) {
  const before = check({ [file]: text }, ambient, file)
  assert.deepEqual(before.errors, [], "the original compiles:\n" + text)
  const split = splitPlatform(text, file, ts, { globals })
  assert.ok(split, "the module uses platform code:\n" + text)
  assert.ok(!split.refused, split.refused)
  const after = check({ [file]: split.module, [platformPath(file)]: split.platform }, ambient, file)
  assert.deepEqual(after.errors, [], split.module + "\n---\n" + split.platform)
  assert.deepEqual(after.types, before.types, split.module + "\n---\n" + split.platform)
  return split
}

test("the split quotes the accepted repair contract", () => {
  assert.ok(readFileSync(SpecPath("007-tooling.md"), "utf8").includes(quote))
  assert.ok(readFileSync(SpecPath("005-services.md"), "utf8").includes(moveQuote))
})

test("opencode: a kept type that reads a moved export reads its wrapper", () => {
  for (const { file, text, globals } of corpus.modules) {
    const split = assertSplitPreserves(file, text, corpus.ambient, globals)
    assert.match(split.module, /^export type \w+ = ReturnType<typeof \w+>$/m, file)
  }
})

test("a kept type that reads a moved value with no wrapper keeps the refusal", () => {
  const text = 'import { readFileSync } from "node:fs"\nconst read = (path: string) => readFileSync(path, "utf8")\nexport type Read = typeof read\nexport const size = 1\n'
  assert.match(splitPlatform(text, "src/Read.ts", ts)?.refused ?? "", /the type Read reads the value read, which Read\.platform\.ts would take/)
})

// Neighbourhood: a moved export as a function declaration or a const arrow,
// sync or async, with a written or an inferred return type, read by a kept
// type through ReturnType, Parameters, Awaited or a bare typeof, exported or
// private behind an exported signature. Every module splits and keeps every
// export's fully qualified type.
test("a kept type over a wrapped export keeps every export's type", () => {
  const ambient = 'declare module "node:fs" { export function readFileSync(path: string, encoding: "utf8"): string }\n'
  const query = fc.constantFrom("ReturnType<typeof load>", "Parameters<typeof load>[0]", "typeof load", "Awaited<ReturnType<typeof load>>")
  fc.assert(fc.property(fc.boolean(), fc.boolean(), fc.boolean(), query, fc.boolean(), (declared, async, written, read, exported) => {
    const result = written ? (async ? ": Promise<{ readonly text: string }>" : ": { readonly text: string }") : ""
    const body = `{\n  return { text: readFileSync(path, "utf8") }\n}`
    const fn = declared
      ? `export ${async ? "async " : ""}function load(path: string)${result} ${body}\n`
      : `export const load = ${async ? "async " : ""}(path: string)${result} => ${body}\n`
    const type = exported ? `export type Loaded = ${read}\n` : `type Loaded = ${read}\nexport const describe = (value: Loaded): string => typeof value\n`
    assertSplitPreserves("m.ts", `import { readFileSync } from "node:fs"\n${fn}${type}`, ambient)
  }), { numRuns: 40 })
})
