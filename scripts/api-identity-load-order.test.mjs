import assert from "node:assert/strict"
import { test } from "node:test"
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createRequire } from "node:module"
import { compareApiIdentity, loadTypeScript } from "./api-identity.mjs"
import { checkProperty } from "./testing/property.mjs"
const ts = loadTypeScript()
const fc = createRequire(new URL("../docs/tools/package.json", import.meta.url))("fast-check")
function fixture(literal, run) {
  const root = mkdtempSync(join(tmpdir(), "api-identity-load-order-"))
  try {
    for (const side of ["before", "after"]) {
      const path = join(root, side)
      mkdirSync(path)
      writeFileSync(join(path, "package.json"), JSON.stringify({ types: "index.d.ts" }))
      writeFileSync(join(path, "a.d.ts"), "declare global { function IdentityOrdered(x: string): 0; } export {};")
      writeFileSync(join(path, "b.d.ts"), `declare global { function IdentityOrdered(x: string): ${literal}; } export {};`)
      writeFileSync(join(path, "index.d.ts"), (side === "before" ? 'import "./a"; import "./b";' : 'import "./b"; import "./a";') +
        "export declare const result: ReturnType<typeof IdentityOrdered>;")
    }
    return run(join(root, "before"), join(root, "after"))
  } finally { rmSync(root, { recursive: true, force: true }) }
}
function isolatedLiteral(path) {
  const file = join(path, "index.d.ts")
  const program = ts.createProgram([file], {
    strict: true, noEmit: true, types: [], module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
  })
  assert.deepEqual(ts.getPreEmitDiagnostics(program), [])
  const checker = program.getTypeChecker()
  const symbol = checker.getExportsOfModule(checker.getSymbolAtLocation(program.getSourceFile(file))).find(s => s.name === "result")
  return checker.typeToString(checker.getTypeOfSymbolAtLocation(symbol, symbol.valueDeclaration))
}
function verify(literal) {
  fixture(literal, (before, after) => {
    assert.equal(isolatedLiteral(before), String(literal))
    assert.equal(isolatedLiteral(after), "0")
    assert.equal(compareApiIdentity(ts, before, before).identical, true)
    const result = compareApiIdentity(ts, before, after)
    assert.equal(result.identical, false, JSON.stringify(result))
    assert.equal(result.comparisonComplete, false, JSON.stringify(result))
    assert.deepEqual(result.typeDifferences, [])
    assert.ok(result.environmentDiagnostics.some(d => d.blocking && /load order/.test(d.diagnostic)), JSON.stringify(result))
  })
}
test("ambient overload binding order cannot be erased by a shared comparison program", () => verify(1))
test("property: isolated overload results differ after swapping their declaration load order", async () => {
  await checkProperty(fc, {
    name: "api-identity-ambient-load-order",
    rule: "Will: every export type must be identical. Global overload binding order changes the isolated exported literal and cannot be merged away by the comparison probe.",
    command: "node --test scripts/api-identity-load-order.test.mjs",
    arbitrary: fc.integer({ min: 1, max: 1000 }),
    numRuns: 4,
    check: verify,
  })
})
