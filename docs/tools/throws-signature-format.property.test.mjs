import assert from "node:assert/strict"
import { test } from "node:test"
import { mkdtempSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import ts from "typescript"
import { signatureFormatter } from "./throws-inventory.mjs"

test("signature text stays equal to the real checker across aliases and shuffled queries", { timeout: 60_000 }, () => {
  const dir = mkdtempSync(join(tmpdir(), "throws-format-"))
  try {
    const definitions = [], aliases = []
    for (let i = 0; i < 24; i++) {
      definitions.push([
        "export type Box" + i + "<T> = { readonly value: T }",
        "type Link" + i + " = { value?: " + i + "; next?: Link" + i + " }",
        "export function f" + i + "<T extends string | number>(value: T, cb?: (input: T) => T): Promise<Box" + i + "<T>>;",
        "export function f" + i + "(value: boolean): ReadonlyArray<Box" + i + "<boolean>>;",
        "export function f" + i + "(value: unknown, ...rest: unknown[]): any { return value }",
        "export class C" + i + "<T extends { key: string }> {",
        "  constructor(public readonly value: T) {}",
        "  join<U>(other: U): readonly [T, U] { return [this.value, other] }",
        "}",
        "export declare const build" + i + ": {",
        "  (value: 'tag" + i + "' | " + i + "): Box" + i + "<'tag" + i + "' | " + i + ">;",
        "  new<T>(value: T): Box" + i + "<T>;",
        "}",
        "export function walk" + i + "(value: Link" + i + "): Link" + i + " { return value }",
      ].join("\n"))
      aliases.push("export { f" + i + " as again" + i + ", C" + i + " as Other" + i + ", build" + i + " as maker" + i + ", walk" + i + " as traverse" + i + " } from './types.js'")
    }
    const sourcePath = join(dir, "types.ts"), aliasPath = join(dir, "aliases.ts")
    writeFileSync(sourcePath, definitions.join("\n"))
    writeFileSync(aliasPath, aliases.join("\n"))
    const program = ts.createProgram([sourcePath, aliasPath], {
      strict: true, skipLibCheck: true, target: ts.ScriptTarget.ES2022, lib: ["lib.es2022.d.ts"],
      module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext,
    })
    assert.deepEqual(ts.getPreEmitDiagnostics(program).map(d => d.messageText), [])
    const checker = program.getTypeChecker(), queries = []
    const visit = node => {
      if (ts.isFunctionLike(node)) {
        const signature = checker.getSignatureFromDeclaration(node)
        if (signature) queries.push(signature)
      }
      ts.forEachChild(node, visit)
    }
    visit(program.getSourceFile(sourcePath))
    for (const file of [sourcePath, aliasPath]) {
      for (let symbol of checker.getExportsOfModule(checker.getSymbolAtLocation(program.getSourceFile(file)))) {
        if (symbol.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol)
        if (!(symbol.flags & ts.SymbolFlags.Value)) continue
        const location = symbol.valueDeclaration ?? symbol.declarations[0]
        const type = checker.getTypeOfSymbolAtLocation(symbol, location)
        queries.push(...type.getCallSignatures(), ...type.getConstructSignatures())
      }
    }
    const unique = new Set(queries)
    assert.ok(unique.size > 100)
    let calls = 0
    const observed = Object.create(checker)
    Object.defineProperty(observed, "signatureToString", { value(signature, ...args) {
      calls++
      return Reflect.apply(checker.signatureToString, checker, [signature, ...args])
    } })
    const format = signatureFormatter(observed)
    const reference = signature => checker.signatureToString(signature, undefined,
      ts.TypeFormatFlags.NoTruncation | ts.TypeFormatFlags.UseAliasDefinedOutsideCurrentScope).replace(/\s+/g, " ").trim()
    let state = 20261101
    for (let round = 0; round < 32; round++) {
      const order = [...queries]
      for (let i = order.length - 1; i > 0; i--) {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0
        const j = state % (i + 1)
        ;[order[i], order[j]] = [order[j], order[i]]
      }
      for (const signature of order) assert.equal(format(signature), reference(signature))
    }
    assert.equal(calls, unique.size)
    const fresh = signatureFormatter(observed)
    assert.equal(fresh(queries[0]), reference(queries[0]))
    assert.equal(calls, unique.size + 1, "a separate formatter must have a separate cache")
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
