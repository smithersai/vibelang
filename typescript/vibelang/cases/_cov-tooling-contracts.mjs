import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, writeFileSync, existsSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import ts from "../../../docs/tools/node_modules/typescript/lib/typescript.js"
export function checkContracts(group) {
// run-seconds: 180

const issues = []
const record = issue => { if (group === "all" || group === "foreign" && ["riskyAlias","parseAlias","pure","declared","foreignOverloads"].includes(issue.name) || group === "local" && ["add","arrow","overloaded","Plain.read"].includes(issue.name) || group === "signatures" && ["declaredLocal","foreignOverloads","factoryReturn","callback"].includes(issue.name)) issues.push(issue) }
for (const suffix of [".vibe", ".vibex"]) {
  const dir = mkdtempSync(join(tmpdir(), "vip27-contracts-"))
  try {
    writeFileSync(join(dir, "package.json"), '{"type":"module"}')
    writeFileSync(join(dir, "foreign.ts"), [
      "/** @throws {unknown} */",
      "export function risky(n: number): number { return n }",
      "/** @throws {RangeError} */",
      "export function parse(n: number): number { return n }",
      "/** @throws {never} */",
      "export function pure(n: number): number { return n }",
      "/** @throws {RangeError} */",
      "export function foreignOverloads(n: number): number",
      "/** @throws {SyntaxError} */",
      "export function foreignOverloads(n: string): string",
      "export function foreignOverloads(n: number | string) { return n }", "/** @rethrows f */", "export function callback(f: () => void): void { f() }",
      // A `.vibe` file can't write `@throws` (EK0406, chapter 3), so the tagged
      // ambient signatures are foreign declarations that main re-exports.
      'import type { BadInput } from "@fixture/contracts"',
      "export declare const declaredLocal: {\n/** @throws {BadInput} */\n(s: string): string\n}",
      "export interface SchemaLike<T> { readonly value: T }",
      "export declare function decodeUnknownSync<T>(s: SchemaLike<T>): {\n/** @throws {BadInput} */\n(input: unknown): T\n}"
    ].join("\n"))
    const library = join(dir, "node_modules/@fixture/contracts")
    mkdirSync(library, { recursive: true })
    writeFileSync(join(library, "package.json"), JSON.stringify({ name: "@fixture/contracts", types: "index.d.ts" }))
    writeFileSync(join(library, "index.d.ts"), "export interface BadInput { readonly _tag: 'BadInput' }\nexport declare const declared: {\n/** @throws {BadInput} */\n(s: string): string\n}")
    const control = ts.createProgram([join(library, "index.d.ts")], { noEmit: true, types: [] })
    const cc = control.getTypeChecker()
    const cs = control.getSourceFile(join(library, "index.d.ts"))
    const declared = cc.getExportsOfModule(cc.getSymbolAtLocation(cs)).find(s => s.name === "declared")
    const tags = cc.getTypeOfSymbolAtLocation(declared, cs).getCallSignatures()[0].getJsDocTags()
    assert.ok(tags.some(t => t.name === "throws"), "native declaration JSDoc control must be visible")
    writeFileSync(join(dir, "main" + suffix), [
      'import { risky, parse } from "./foreign.ts"',
      'export { pure, foreignOverloads, callback } from "./foreign.ts"',
      'export { declared } from "@fixture/contracts"',
      'export { declaredLocal, decodeUnknownSync } from "./foreign.ts"',
      'export type { SchemaLike } from "./foreign.ts"',
      'export function add(n: number) { return n + 1 }',
      'export const arrow = (n: number) => n + 1',
      'export function overloaded(n: number): number',
      'export function overloaded(n: string): string',
      'export function overloaded(n: number | string) { return n }',
      'export const riskyAlias = risky',
      'export const parseAlias = parse',
      'export class Plain { read() { return 1 } }'
    ].join("\n"))
    writeFileSync(join(dir, "tsconfig.json"), JSON.stringify({
      compilerOptions: { target: "ES2022", module: "NodeNext", strict: true, types: [], jsx: "preserve", declaration: true, emitDeclarationOnly: true, outDir: "out", allowImportingTsExtensions: true },
      files: ["main" + suffix], vibe: { effectGlobals: false, effectModules: false }
    }))
    const emit = spawnSync(process.env.VIBELANG_BINARY, ["-p", "tsconfig.json", "--pretty", "false"], { cwd: dir, encoding: "utf8", timeout: 30000 })
    assert.equal(emit.error, undefined)
    assert.equal(emit.status, 0, emit.stdout + emit.stderr)
    for (const entry of ["main.d" + suffix + ".ts", "out/main.d.ts"]) {
      const file = join(dir, entry)
      if (!existsSync(file)) { record({ suffix, entry, stage: "missing compatibility declaration" }); continue }
      const program = ts.createProgram([file], { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.NodeNext, types: [], skipLibCheck: true, noEmit: true, allowImportingTsExtensions: true })
      const diagnostics = ts.getPreEmitDiagnostics(program)
      assert.deepEqual(diagnostics.map(d => d.code), [], entry + ": declarations must resolve before reading their contracts")
      const checker = program.getTypeChecker()
      const source = program.getSourceFile(file)
      const exports = new Map(checker.getExportsOfModule(checker.getSymbolAtLocation(source)).map(symbol => [symbol.name, symbol]))
      const throws = signature => signature.getJsDocTags().filter(tag => tag.name === "throws").map(tag => ts.displayPartsToString(tag.text ?? []).replace(/[{}\s]/g, ""))
      for (const [name, expected, count] of [["add", "never", 1], ["arrow", "never", 1], ["overloaded", "never", 2], ["riskyAlias", "unknown", 1], ["parseAlias", "RangeError", 1], ["pure", "never", 1], ["declared", "BadInput", 1], ["declaredLocal", "BadInput", 1]]) {
        const symbol = exports.get(name)
        assert.ok(symbol, name)
        const signatures = checker.getTypeOfSymbolAtLocation(symbol, source).getCallSignatures()
        assert.equal(signatures.length, count, name)
        for (const signature of signatures) {
          const got = throws(signature)
          if (!got.includes(expected)) record({ suffix, entry, name, expected, actual: got })
        }
      }
      const foreignOverloads = checker.getTypeOfSymbolAtLocation(exports.get("foreignOverloads"), source).getCallSignatures()
      assert.equal(foreignOverloads.length, 2)
      for (const [index, expected] of ["RangeError", "SyntaxError"].entries()) {
        if (!throws(foreignOverloads[index]).includes(expected)) record({ suffix, entry, name: "foreignOverloads", expected, actual: throws(foreignOverloads[index]) })
      }
      if (group === "all" || group === "signatures") {
        const callback = checker.getTypeOfSymbolAtLocation(exports.get("callback"), source).getCallSignatures()[0]
        if (!callback.getJsDocTags().some(t => t.name === "rethrows" && ts.displayPartsToString(t.text ?? []).includes("f"))) record({ suffix, entry, name: "callback", expected: "@rethrows f" })
        const factory = checker.getTypeOfSymbolAtLocation(exports.get("decodeUnknownSync"), source).getCallSignatures()[0]
        const returned = checker.getReturnTypeOfSignature(factory).getCallSignatures()[0]
        if (!returned || !throws(returned).includes("BadInput")) record({ suffix, entry, name: "factoryReturn", expected: "BadInput", actual: returned ? throws(returned) : [] })
      }
      const klass = checker.getDeclaredTypeOfSymbol(exports.get("Plain"))
      const method = klass.getProperty("read")
      const signatures = checker.getTypeOfSymbolAtLocation(method, source).getCallSignatures()
      assert.equal(signatures.length, 1)
      if (!throws(signatures[0]).includes("never")) record({ suffix, entry, name: "Plain.read", expected: "never", actual: throws(signatures[0]) })
    }
  } finally { rmSync(dir, { recursive: true, force: true }) }
}
assert.deepEqual(issues, [], "VIP-27 foreign contract boundary matrix")

}
