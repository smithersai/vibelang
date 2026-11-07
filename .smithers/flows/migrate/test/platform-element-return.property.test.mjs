// The platform split refused every export with an inferred return type once
// moved code read a private type of the module, because that type might
// appear in the return type and only the sibling would declare it. A function
// that returns only JSX elements, null or undefined, or no value at all, has
// a return type that names no type of the module, so its wrapper stays
// (opencode gui-plugins terminal and updater/whats-new, session-ui
// session-review). A factory that returns the private type names the
// sibling's copy, which the sibling exports, and keeps its type.
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
const corpus = JSON.parse(readFileSync(new URL("./corpus/opencode-platform-split-element-return.json", import.meta.url), "utf8"))
const quote = "A quick fix is offered only when it preserves evaluation order, coldness, types, comments, and declaration output"
const globals = ["getComputedStyle", "document"]
const ambient = `declare namespace JSX {
  interface Element { readonly element: true }
  interface ElementChildrenAttribute { children: {} }
  interface IntrinsicElements { div: { readonly style?: { readonly color?: string }; readonly children?: unknown } }
}
declare function getComputedStyle(element: unknown): { readonly color: string }
declare const document: { readonly body: unknown }
`

// Stock TypeScript over the files, with declarations and preserved JSX: the
// errors, and each export of entry as a fully qualified type.
function check(files, entry) {
  const root = mkdtempSync(join(tmpdir(), "migrate-platform-element-"))
  try {
    for (const [file, text] of Object.entries({ ...files, "ambient.d.ts": ambient })) {
      mkdirSync(join(root, dirname(file)), { recursive: true })
      writeFileSync(join(root, file), text)
    }
    const options = { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, allowImportingTsExtensions: true, jsx: ts.JsxEmit.Preserve, strict: true, noUnusedLocals: true, declaration: true, emitDeclarationOnly: true, lib: ["lib.es2022.d.ts"], types: [], skipLibCheck: true, outDir: join(root, ".out") }
    const program = ts.createProgram(Object.keys(files).concat("ambient.d.ts").map((f) => join(root, f)), options)
    const emitted = program.emit()
    const errors = [...ts.getPreEmitDiagnostics(program), ...emitted.diagnostics].filter((d) => d.category === ts.DiagnosticCategory.Error).map((d) => `${d.file ? d.file.fileName.slice(root.length + 1) : ""} TS${d.code} ${ts.flattenDiagnosticMessageText(d.messageText, " ")}`)
    const checker = program.getTypeChecker()
    const source = program.getSourceFile(join(root, entry))
    const flags = ts.TypeFormatFlags.NoTruncation | ts.TypeFormatFlags.UseFullyQualifiedType
    const types = {}
    for (const symbol of checker.getExportsOfModule(checker.getSymbolAtLocation(source))) {
      const type = symbol.flags & ts.SymbolFlags.Value ? checker.getTypeOfSymbolAtLocation(symbol, source) : checker.getDeclaredTypeOfSymbol(symbol)
      // A private type the sibling exports for an inferred result prints
      // through import("./m.platform"), the same declaration text.
      types[symbol.name] = checker.typeToString(type, undefined, flags).replaceAll(root, "<root>").replaceAll(`import("<root>/${entry.replace(/\.tsx?$/, "")}.platform").`, "").replaceAll(`import("<root>/${entry.replace(/\.tsx?$/, "")}").`, "")
    }
    return { errors, types }
  } finally { rmSync(root, { recursive: true, force: true }) }
}

// The split compiles, with declarations, and each export has the type it had.
function assertSplitPreserves(file, text) {
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
  assert.ok(readFileSync(SpecPath("007-tooling.md"), "utf8").includes(quote))
})

test("opencode: a component or a void export keeps its wrapper beside a private type", () => {
  for (const { file, text, wrapped } of corpus.modules) {
    const split = assertSplitPreserves(file, text)
    assert.match(split.module, new RegExp(`\\$platform\\.${wrapped}\\(`), split.module)
  }
})

test("a factory that returns the private type names the sibling's copy and keeps its type", () => {
  const text = 'type Colors = { readonly fg: string }\n\nexport function theme() {\n  const colors: Colors = { fg: getComputedStyle(document.body).color }\n  return colors\n}\n'
  assert.match(assertSplitPreserves("src/theme.ts", text).platform, /\bColors\b/)
  const nested = 'type Colors = { readonly fg: string }\n\nexport const Theme = () => {\n  const colors: Colors = { fg: getComputedStyle(document.body).color }\n  return colors.fg ? colors : null\n}\n'
  assert.match(assertSplitPreserves("src/theme.tsx", nested).platform, /\bColors\b/)
})

// Neighbourhood: a function declaration, const arrow or function expression,
// sync or async, returning JSX in a concise body, JSX from a block, JSX or
// null from a conditional, or nothing, beside a private type the moved body
// reads and a kept function also reads, and an exported or private props
// type. Every module splits and keeps every export's type.
test("an element-returning export keeps its type beside private types", () => {
  const body = fc.constantFrom("concise", "block", "conditional", "void")
  fc.assert(fc.property(fc.constantFrom("declaration", "arrow", "expression"), body, fc.boolean(), fc.boolean(), (form, shape, async, exportedProps) => {
    fc.pre(!(form !== "arrow" && shape === "concise"))
    fc.pre(!(async && shape === "concise"))
    const props = `${exportedProps ? "export " : ""}type Props = { readonly label: string }\n`
    const colors = "type Colors = { readonly fg: string }\n"
    const read = "const colors: Colors = { fg: getComputedStyle(document.body).color }"
    const element = "<div style={{ color: colors.fg }}>{props.label}</div>"
    const block = shape === "block" ? `{\n  ${read}\n  return ${element}\n}`
      : shape === "conditional" ? `{\n  ${read}\n  return props.label ? (${element}) : null\n}`
      : shape === "void" ? `{\n  ${read}\n  void colors\n  void props\n}`
      : `<div style={{ color: getComputedStyle(document.body).color }}>{props.label}</div>`
    const word = async ? "async " : ""
    const fn = form === "declaration" ? `export ${word}function Theme(props: Props) ${block}\n`
      : form === "arrow" ? `export const Theme = ${word}(props: Props) => ${block}\n`
      : `export const Theme = ${word}function (props: Props) ${block}\n`
    // A kept reader keeps the private type in use in the module as well.
    const uses = "export const tint = (c: Colors): string => c.fg\n"
    assertSplitPreserves("m.tsx", props + colors + fn + uses)
  }), { numRuns: 40 })
})
