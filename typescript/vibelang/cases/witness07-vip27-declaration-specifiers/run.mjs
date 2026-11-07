// run-seconds: 180
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import ts from "../../../../docs/tools/node_modules/typescript/lib/typescript.js"

const specifiers = text => [...text.matchAll(/from "([^"]+)"/g)].map(m => m[1])
const publicSpelling = ["./user.ts", "./App.tsx", "./user.js", "./App.jsx", "./user", "./plain.ts"]
const sources = {
  "user.vibe": "export interface User { name: string }\n",
  "App.vibex": "export interface AppProps { title: string }\n",
  "plain.ts": "export interface Plain { p: number }\nexport const plain: Plain = { p: 1 }\n",
}
const main = ext => [
  `import type { User } from "./user.${ext.vibe}"`,
  `import type { AppProps } from "./App.${ext.vibex}"`,
  `import type { User as U2 } from "./user.js"`,
  `import type { AppProps as A2 } from "./App.jsx"`,
  `import type { User as U3 } from "./user"`,
  `import { plain, type Plain } from "./plain.ts"`,
  `export type All = [User, AppProps, U2, A2, U3, Plain]`,
  `export const value: Plain = plain`,
  "",
].join("\n")

const publicTexts = new Set()
// allowImportingTsExtensions without rewriting needs a declaration-only build.
for (const [allow, rewrite] of [[true, false], [true, true]]) {
  const dir = mkdtempSync(join(tmpdir(), "witness07-specifiers-"))
  try {
    writeFileSync(join(dir, "package.json"), "{\"type\":\"module\"}")
    mkdirSync(join(dir, "node_modules"))
    symlinkSync(join(process.env.EFFECT_NODE_MODULES, "effect"), join(dir, "node_modules/effect"))
    symlinkSync(process.env.VIBELANG_RUNTIME, join(dir, "node_modules/vibelang-runtime"))
    for (const [name, text] of Object.entries(sources)) writeFileSync(join(dir, name), text)
    writeFileSync(join(dir, "main.vibe"), main({ vibe: "vibe", vibex: "vibex" }))
    const options = { target: "ES2022", module: "preserve", moduleResolution: "bundler", strict: true, types: [], skipLibCheck: true, jsx: "preserve", outDir: "out", declaration: true, allowImportingTsExtensions: allow, rewriteRelativeImportExtensions: rewrite, emitDeclarationOnly: !rewrite }
    writeFileSync(join(dir, "tsconfig.json"), JSON.stringify({ compilerOptions: options, files: ["main.vibe"], vibe: { effectGlobals: false, effectModules: false } }))
    const r = spawnSync(process.env.VIBELANG_BINARY, ["-p", ".", "--pretty", "false"], { cwd: dir, encoding: "utf8", timeout: 60000 })
    assert.equal(r.status, 0, r.stdout + r.stderr)
    const label = JSON.stringify({ allow, rewrite })

    // Ordinary declarations use the native twin's spelling.
    const published = readFileSync(join(dir, "out/main.d.ts"), "utf8")
    assert.deepEqual(specifiers(published), publicSpelling, label)
    assert.doesNotMatch(published, /\.vibex?"/, label + ": a package declaration names no VibeLang source")
    publicTexts.add(published)

    // Stock tsc on the .ts twin, with the same options, declares the same text.
    writeFileSync(join(dir, "user.ts"), sources["user.vibe"])
    writeFileSync(join(dir, "App.tsx"), sources["App.vibex"])
    writeFileSync(join(dir, "main.ts"), main({ vibe: "ts", vibex: "tsx" }))
    const native = ts.createProgram([join(dir, "main.ts")], { ...ts.convertCompilerOptionsFromJson(options, dir).options, outDir: join(dir, "stock") })
    assert.deepEqual(ts.getPreEmitDiagnostics(native).map(d => d.code), [], label)
    native.emit()
    // The generated @throws tag is the one allowed difference (VIP-27, 2026-11-04).
    assert.equal(specifiers(readFileSync(join(dir, "stock/main.d.ts"), "utf8")).join(), publicSpelling.join(), label + ": stock tsc declares the same specifiers")

    // The compatibility sidecar keeps the written VibeLang source references.
    const written = specifiers(readFileSync(join(dir, "main.d.vibe.ts"), "utf8"))
    assert.equal(written[0], "./user.vibe", label)
    assert.equal(written[1], "./App.vibex", label)
    assert.equal(written[5], "./plain.ts", label)

    // JavaScript output rewriting is separate from declaration spelling.
    if (rewrite) {
      const js = readFileSync(join(dir, "out/main.js"), "utf8")
      assert.match(js, /from "\.\/plain\.js"/, label + ": rewriteRelativeImportExtensions rewrites JavaScript")
      assert.match(published, /from "\.\/plain\.ts"/, label + ": but not the declaration")
    }
  } finally { rmSync(dir, { recursive: true, force: true }) }
}
assert.equal(publicTexts.size, 1, "extension flags do not change declaration specifiers")
console.log("declaration specifiers follow the native twin; sidecars keep source references")
