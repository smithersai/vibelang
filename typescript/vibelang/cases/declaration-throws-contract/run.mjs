// run-seconds: 180
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import ts from "../../../../docs/tools/node_modules/typescript/lib/typescript.js"

const source = readFileSync(new URL("./main.vibe", import.meta.url), "utf8")
const twin = source
  .replace(" method(", " /** @throws {never} */\n method(")
  .replace(" (x: number): string", " /** @throws {never} */\n (x: number): string")
  .replace(" new (", " /** @throws {never} */\n new (")
  .replace("/** Preserve identity documentation. */", "/** Preserve identity documentation.\n * @throws {never}\n */")
  .replace("export const arrow = (x: number) => x;", "export const arrow: {\n/** @throws {never} */\n(x: number): number\n} = (x) => x;")
  .replace(" constructor(", " /** @throws {never} */\n constructor(")
  .replace("/** Read the value. */", "/** Read the value.\n * @throws {never}\n */")
  .replaceAll("export function overloaded(x:", "/** @throws {never} */\nexport function overloaded(x:")
const withInferredMethods = twin
  .replace("/** Inferred method documentation. */", "/** Inferred method documentation.\n * @throws {never}\n */")
  .replace("  method(x: number): number {", "  /** @throws {never} */\n  method(x: number): number {")
  .replace("export function makeMethods()", "/** @throws {never} */\nexport function makeMethods()")
const withDefaultConstructors = withInferredMethods
  .replace("export const Default = class {};", "export const Default: {\n/** @throws {never} */\nnew (): {}\n} = class {};")
  .replace("export function makeDefault()", "/** @throws {never} */\nexport function makeDefault(): {\n/** @throws {never} */\nnew (): {}\n}")
const dir = mkdtempSync(join(tmpdir(), "declaration-throws-"))
try {
  writeFileSync(join(dir, "package.json"), '{"type":"module"}')
  const options = { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.NodeNext, strict: true, types: [], declaration: true, emitDeclarationOnly: true, outDir: join(dir, "stock") }
  writeFileSync(join(dir, "main.ts"), withDefaultConstructors)
  const program = ts.createProgram([join(dir, "main.ts")], options)
  const diagnostics = ts.getPreEmitDiagnostics(program)
  assert.equal(diagnostics.length, 0, ts.formatDiagnosticsWithColorAndContext(diagnostics, { getCanonicalFileName: x=>x, getCurrentDirectory: ()=>dir, getNewLine: ()=>"\n" }))
  assert.equal(program.emit().emitSkipped, false)
  const stock = readFileSync(join(dir, "stock/main.d.ts"), "utf8")
  writeFileSync(join(dir, "main.vibe"), source)
  writeFileSync(join(dir, "tsconfig.json"), JSON.stringify({ compilerOptions: { target: "ES2022", module: "NodeNext", strict: true, types: [], declaration: true, emitDeclarationOnly: true, outDir: "out" }, files: ["main.vibe"], vibe: { effectModules: false, effectGlobals: false } }))
  const result = spawnSync(process.env.VIBELANG_BINARY, ["-p", "tsconfig.json", "--pretty", "false"], { cwd: dir, encoding: "utf8" })
  assert.equal(result.status, 0, result.stdout + result.stderr)
  const emitted = readFileSync(join(dir, "out/main.d.ts"), "utf8")
  const scan = text => {
    const scanner = ts.createScanner(ts.ScriptTarget.Latest, false, ts.LanguageVariant.Standard, text)
    const tokens = []
    for (let k = scanner.scan(); k !== ts.SyntaxKind.EndOfFileToken; k = scanner.scan()) {
      if (![ts.SyntaxKind.WhitespaceTrivia, ts.SyntaxKind.NewLineTrivia].includes(k)) tokens.push(k === ts.SyntaxKind.MultiLineCommentTrivia
        ? scanner.getTokenText().replace(/^\/\*\*|\*\/$/g, "").replace(/^\s*\*/gm, "").trim().replace(/\s+/g, " ")
        : scanner.getTokenText())
    }
    return tokens
  }
  assert.deepEqual(scan(emitted), scan(stock), "declarations and signature-local documentation must match the tagged TypeScript twin\n" + emitted)
  const sidecar = readFileSync(join(dir, "main.d.vibe.ts"), "utf8")
  assert.deepEqual(scan(sidecar), scan(stock), "sidecar signature contracts must match the tagged TypeScript twin")
  console.log("declaration contracts match TypeScript " + ts.version)
} finally { rmSync(dir, { recursive: true, force: true }) }
