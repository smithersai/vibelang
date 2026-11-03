// VIP-27 native TypeScript resolution and import-permission controls.
// VIP-27 native TypeScript resolution and import-permission controls: docs/design/vips/0027-declaration-output.md#e8244e4d37693cf3
// VIP-27 native TypeScript resolution and import-permission controls: docs/design/vips/0027-declaration-output.md#e03f739b15d58bc8
// VIP-27 native TypeScript resolution and import-permission controls: docs/design/vips/0027-declaration-output.md#a05d3dce267ca5ae
// VIP-27 native TypeScript resolution and import-permission controls: docs/design/vips/0027-declaration-output.md#9f15e96798b741ea
import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { tmpdir } from "node:os"
import test from "node:test"
import fc from "fast-check"
import ts from "../../../docs/tools/node_modules/typescript/lib/typescript.js"

// VIP-27 native resolution controls: explicit arbitrary extensions work without
// moduleSuffixes. Both suffix orders can shadow an unchanged .tsx module.
test("VIP-27 TypeScript suffix search can select a sidecar before an unchanged TSX source", () => {
  fc.assert(fc.property(fc.constantFrom("runtime", "odd name", "Ω"), fc.constantFrom(["", ".d.vibe"], [".d.vibe", ""]), (name, suffixes) => {
    const root = mkdtempSync(join(tmpdir(), "vip27-suffix-"))
    try {
      for (const [file, text] of Object.entries({
        "main.ts": 'export {}',
        [name + ".tsx"]: 'export const value = "original" as const;',
        [name + ".d.vibe.ts"]: 'export declare const value: "sidecar";',
        "explicit.d.vibe.ts": "export declare const value: 42;"
      })) writeFileSync(join(root, file), text)
      const options = { module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext, jsx: ts.JsxEmit.Preserve, allowArbitraryExtensions: true }
      const from = join(root, "main.ts")
      const resolve = (name, extra = {}) => ts.resolveModuleName(name, from, { ...options, ...extra }, ts.sys).resolvedModule?.resolvedFileName
      assert.equal(resolve("./" + name + ".js"), join(root, name + ".tsx"))
      assert.equal(resolve("./" + name + ".js", { moduleSuffixes: suffixes }), join(root, name + ".d.vibe.ts"))
      assert.equal(resolve("./explicit.vibe"), join(root, "explicit.d.vibe.ts"))
      assert.equal(resolve("./absent"), undefined)
    } finally { rmSync(root, { recursive: true, force: true }) }
  }), { seed: 27258, numRuns: 18 })
})

test("VIP-27 stock consumers require arbitrary-extension permission and retain native .ts gates", () => {
  for (const arbitrary of [false, true]) {
    const root = mkdtempSync(join(tmpdir(), "vip27-native-gates-"))
    try {
      writeFileSync(join(root, "package.json"), '{"type":"module"}')
      writeFileSync(join(root, "producer.d.vibe.ts"), "export declare const value: 42;")
      writeFileSync(join(root, "helper.ts"), "export const value = 42;")
      const options = { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext, noEmit: true, types: [], allowArbitraryExtensions: arbitrary }
      const codes = specifier => {
        writeFileSync(join(root, "main.ts"), 'import { value } from "' + specifier + '"; const n: 42 = value;')
        return ts.getPreEmitDiagnostics(ts.createProgram([join(root, "main.ts")], options)).map(d => d.code)
      }
      assert.deepEqual(codes("./producer.vibe"), arbitrary ? [] : [6263])
      assert.deepEqual(codes("./helper.ts"), [5097])
      assert.deepEqual(codes("./helper.js"), [])
    } finally { rmSync(root, { recursive: true, force: true }) }
  }
})
