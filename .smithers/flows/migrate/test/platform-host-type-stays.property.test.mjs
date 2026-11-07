// The platform split moved a type alias or interface that names a host global
// only as a type, `interface Options { readonly signal?: AbortSignal }`, into
// the sibling, while the module's wrapper `pause(opts?: Options)` still named
// it: TS2304 in the module (opencode app runtime/server/health). A .vibe file
// may name a host global as a type, so the declaration stays in the module and
// moved code that reads it takes a private copy.
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
const corpus = JSON.parse(readFileSync(new URL("./corpus/opencode-platform-split-host-type-stays.json", import.meta.url), "utf8"))
const moveQuote = "The quick fix and the codemod move the code into a sibling"
const ambient = 'declare function setTimeout(handler: () => void, ms?: number): number\ndeclare class AbortSignal { readonly aborted: boolean }\ndeclare const performance: { now(): number }\ndeclare module "node:fs" { export interface Stats { readonly size: number } export function statSync(path: string): Stats }\n'

// Stock TypeScript over the files, with declarations: the errors, and each
// export of entry as a fully qualified type.
function check(files, entry) {
  const root = mkdtempSync(join(tmpdir(), "migrate-platform-host-type-"))
  try {
    for (const [file, text] of Object.entries({ ...files, "ambient.d.ts": ambient })) {
      mkdirSync(join(root, dirname(file)), { recursive: true })
      writeFileSync(join(root, file), text)
    }
    const options = { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, allowImportingTsExtensions: true, strict: true, noUnusedLocals: true, declaration: true, emitDeclarationOnly: true, lib: ["lib.es2022.d.ts"], types: [], skipLibCheck: true, outDir: join(root, ".out") }
    const program = ts.createProgram(Object.keys(files).concat("ambient.d.ts").map((f) => join(root, f)), options)
    const emitted = program.emit()
    const errors = [...ts.getPreEmitDiagnostics(program), ...emitted.diagnostics].filter((d) => d.category === ts.DiagnosticCategory.Error).map((d) => `${d.file ? d.file.fileName.slice(root.length + 1) : ""} TS${d.code} ${ts.flattenDiagnosticMessageText(d.messageText, " ")}`)
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
function assertSplitPreserves(file, text, globals) {
  const before = check({ [file]: text }, file)
  assert.deepEqual(before.errors, [], "the original compiles:\n" + text)
  const split = splitPlatform(text, file, ts, { globals })
  assert.ok(split && !split.refused, split?.refused ?? "no split")
  const after = check({ [file]: split.module, [platformPath(file)]: split.platform }, file)
  assert.deepEqual(after.errors, [], split.module + "\n---\n" + split.platform)
  assert.deepEqual(after.types, before.types, split.module + "\n---\n" + split.platform)
  return split
}

test("the split quotes the accepted repair contract", () => {
  assert.ok(readFileSync(SpecPath("005-services.md"), "utf8").includes(moveQuote))
})

test("opencode: an interface that names a host type stays beside the wrapper", () => {
  for (const { file, text, globals, kept } of corpus.modules) {
    const split = assertSplitPreserves(file, text, globals)
    assert.match(split.module, new RegExp(`^interface ${kept} \\{`, "m"), split.module)
  }
})

test("a type that reads a builtin value import still moves with it", () => {
  const text = 'import { statSync, Stats } from "node:fs"\ntype Size = Pick<Stats, "size">\nexport function size(path: string): number {\n  const s: Size = statSync(path)\n  return s.size\n}\n'
  const split = assertSplitPreserves("src/size.ts", text, [])
  assert.doesNotMatch(split.module, /node:fs|type Size/, split.module)
  assert.match(split.platform, /^type Size = /m, split.platform)
})

// Neighbourhood: a type alias or interface naming a host global as a type
// reference or a type query, exported or private, read by a moved export's
// written parameter or return type, by kept code, or by both. Every module
// splits, keeps every export's type, and compiles beside its sibling.
test("a type that names host globals only as types stays in the module", () => {
  const field = fc.constantFrom("readonly signal?: AbortSignal", "readonly timer: ReturnType<typeof setTimeout>", "readonly clock: typeof performance", "readonly both: [AbortSignal, ReturnType<typeof setTimeout>]")
  fc.assert(fc.property(field, fc.boolean(), fc.boolean(), fc.constantFrom("param", "return", "kept"), (member, interfaceForm, exported, use) => {
    const head = exported ? "export " : ""
    const type = interfaceForm ? `${head}interface Options {\n  ${member}\n}\n` : `${head}type Options = {\n  ${member}\n}\n`
    const fn = use === "return"
      ? "export function wait(ms: number): Options | undefined {\n  setTimeout(() => {}, ms)\n  return undefined\n}\n"
      : "export function wait(ms: number, opts?: Options): number {\n  setTimeout(() => {}, ms)\n  return opts === undefined ? 0 : 1\n}\n"
    const kept = use === "kept" || !exported ? "export const describe = (opts: Options): string => typeof opts\n" : ""
    const split = assertSplitPreserves("m.ts", type + fn + kept, ["setTimeout", "AbortSignal", "performance"])
    assert.match(split.module, /^(?:export )?(?:interface|type) Options\b/m, split.module)
  }), { numRuns: 40 })
})
