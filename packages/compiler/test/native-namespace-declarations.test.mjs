
import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { spawnSync } from "node:child_process"
import { test } from "node:test"
const require = createRequire(new URL("../../runtime/package.json", import.meta.url))
const ts = require("typescript"), fc = require("fast-check")
const binary = fileURLToPath(new URL("../native/vibelang", import.meta.url))
const corpus = JSON.parse(readFileSync(new URL("./fixtures/alchemy-namespace-declarations.json", import.meta.url), "utf8"))
const rule = "A relative import of a VibeLang module, `./user.vibe`, is declared through its `.js` output, `./user.js`, by default"
assert.ok(readFileSync(new URL("../../../docs/design/src/001-functions.md", import.meta.url), "utf8").includes(rule), "D263/D298 declaration spec quote must remain current")

function fixture(files, style, consume) {
  const root = mkdtempSync(join(tmpdir(), "alchemy-native-namespace-"))
  const put = (name, value) => { mkdirSync(dirname(join(root, name)), { recursive: true }); writeFileSync(join(root, name), value) }
  try {
    for (const [name, value] of Object.entries(files)) put(name, value)
    put("tsconfig.json", JSON.stringify({
      compilerOptions: { strict: true, target: "ES2022", module: "Preserve", moduleResolution: "Bundler",
        allowImportingTsExtensions: true, allowArbitraryExtensions: true, skipLibCheck: true, types: [],
        declaration: true, emitDeclarationOnly: true, rootDir: "src", outDir: "lib" },
      vibelang: { declarationImportStyle: style }, include: ["src/**/*.ts", "src/**/*.vibe"]
    }))
    const emitted = spawnSync(binary, ["-p", "tsconfig.json", "--singleThreaded", "--pretty", "false"], { cwd: root, encoding: "utf8" })
    assert.equal(emitted.status, 0, emitted.stdout + emitted.stderr)
    const checked = ts.createProgram([join(root, "consumer.ts")], {
      strict: true, noEmit: true, skipLibCheck: false, types: [], target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.Preserve, moduleResolution: ts.ModuleResolutionKind.Bundler,
      allowImportingTsExtensions: true, allowArbitraryExtensions: true
    })
    const errors = ts.getPreEmitDiagnostics(checked).filter(d => d.category === ts.DiagnosticCategory.Error)
    assert.deepEqual(errors.map(d => ts.flattenDiagnosticMessageText(d.messageText, "\n")), [], "stock consumers must resolve the emitted graph and retain concrete types")
    consume?.(root)
  } finally { rmSync(root, { recursive: true, force: true }) }
}
const noAny = target => '\ntype IsAny<T> = 0 extends (1 & T) ? true : false;\nconst concrete: IsAny<' + target + '> = false;\n'

test("alchemy-57: stock namespace and direct consumers resolve the same emitted DBInstance type", () => {
  fixture({ ...corpus.files, "consumer.ts": corpus.files["consumer.ts"] + noAny("AWS.RDS.DBInstance") }, ".js", root => {
    assert.match(readFileSync(join(root, "lib/RDS/index.d.ts"), "utf8"), /DBInstance\.js/)
    assert.match(readFileSync(join(root, "lib/index.d.ts"), "utf8"), /RDS\/index\.ts/)
  })
})

test("property: native leaves behind retained TypeScript barrels resolve through declaration-only packages", () => {
  fc.assert(fc.property(fc.constantFrom(".js", ".ts", "extensionless"), fc.constantFrom('"', "'"),
    fc.integer({ min: 0, max: 3 }), fc.constantFrom("star", "named", "typed", "importType", "namespace"),
    (style, quote, depth, form) => {
      const spec = quote + "./DBInstance.vibe" + quote
      const edge = {
        star: "export * from " + spec + ";\n",
        named: "export { DBInstance } from " + spec + ";\n",
        typed: "import type { DBInstance as Native } from " + spec + ";\nexport type DBInstance = Native;\n",
        importType: "export type DBInstance = import(" + spec + ").DBInstance;\n",
        namespace: "export * as Nested from " + spec + ";\n"
      }[form]
      const files = {
        "src/DBInstance.vibe": "export interface DBInstance { readonly id: string }\n",
        "src/plain.ts": "export interface Plain { readonly stable: true }\n",
        "src/last.ts": edge + "export type { Plain } from " + quote + "./plain.ts" + quote + ";\n",
        "src/index.ts": "export * as RDS from " + quote + (depth ? "./hop0.ts" : "./last.ts") + quote + ";\n"
      }
      for (let i = 0; i < depth; i++) files["src/hop" + i + ".ts"] = "export * from " + quote + (i + 1 < depth ? "./hop" + (i + 1) + ".ts" : "./last.ts") + quote + ";\n"
      const target = "AWS.RDS." + (form === "namespace" ? "Nested." : "") + "DBInstance"
      files["consumer.ts"] = 'import * as AWS from "./lib/index.js";\nexport type Selected = ' + target + " | string;\n" + noAny(target)
      fixture(files, style, root => {
        const declaration = readFileSync(join(root, "lib/last.d.ts"), "utf8")
        assert.ok(!declaration.includes("./DBInstance.vibe"), declaration)
        assert.ok(declaration.includes("./DBInstance" + (style === "extensionless" ? "" : style)), declaration)
        assert.ok(declaration.includes("./plain.ts"), declaration)
      })
    }), { seed: 570053, numRuns: 40 })
})
