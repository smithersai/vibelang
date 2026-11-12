import assert from "node:assert/strict"
import { test } from "node:test"
import ts from "typescript"
import { read } from "./spec-witness.mjs"

// The spec's claims about formatter plugins, declaration maps and the proof
// configuration must match what the compiler package and TypeScript do.

const bullet = (page, label) => read(page).split("\n").find(line => line.startsWith(`- **${label}**`))

test("VIP-34 and chapter 7 name a formatter plugin only where the compiler package ships one", () => {
  const pkg = JSON.parse(read("packages/compiler/package.json"))
  assert.ok("./prettier" in pkg.exports, "the Prettier plugin is vibelang/prettier")
  assert.ok(pkg.files.includes("dprint-plugin.json"), "the dprint plugin ships as dprint-plugin.json")
  const oxfmt = Object.keys(pkg.exports).some(key => /oxfmt/i.test(key)) || pkg.files.some(file => /oxfmt/i.test(file))
  for (const page of ["docs/design/vips/0034-compiler-and-tooling.md", "docs/design/src/007-tooling.md"]) {
    // Amendment bullets quote the text they replace; the rules are everything else.
    const text = read(page).split("\n").filter(line => !line.startsWith("- **Amended")).join("\n")
    assert.match(text, /Prettier and dprint reach it through plugins/, page)
    if (oxfmt) continue
    assert.doesNotMatch(text, /Oxfmt reach/, page + " must not promise an Oxfmt plugin")
    assert.match(text, /Oxfmt has no plugin interface, so a repo(sitory)?'s Oxfmt format and check scripts run `vibelang-format` after Oxfmt/, page)
  }
})

test("VIP-39 and VIP-40 give declaration maps sourcesContent only if TypeScript writes it", () => {
  const files = { "/p/a.ts": "export const a: number = 1\n" }
  const options = { declaration: true, declarationMap: true, sourceMap: true, inlineSources: true, outDir: "/p/out", target: ts.ScriptTarget.ES2022 }
  const host = ts.createCompilerHost(options)
  host.getSourceFile = (name, version) => name in files
    ? ts.createSourceFile(name, files[name], version)
    : ts.createCompilerHost(options).getSourceFile(name, version)
  host.fileExists = name => name in files || ts.sys.fileExists(name)
  host.readFile = name => files[name] ?? ts.sys.readFile(name)
  const out = {}
  ts.createProgram(["/p/a.ts"], options, host).emit(undefined, (name, text) => { out[name] = text })
  assert.ok(JSON.parse(out["/p/out/a.js.map"]).sourcesContent?.[0] === files["/p/a.ts"], "inlineSources embeds the source in the JavaScript map")
  const declarationContent = JSON.parse(out["/p/out/a.d.ts.map"]).sourcesContent !== undefined
  for (const page of ["docs/design/vips/0039-vibex.md", "docs/design/vips/0040-module-declarations.md"]) {
    const maps = bullet(page, "Source maps.")
    assert.ok(maps, page + " keeps its source-map bullet")
    if (declarationContent) continue
    assert.match(maps, /as TypeScript writes none in a `\.d\.ts\.map`/, page)
    assert.doesNotMatch(maps, /\.d\.ts\.map` name `[^`]+` with (its|the full) `sourcesContent`/, page)
  }
})

test("Appendix F calls vibe.proofDir an unknown option exactly while the compiler rejects it", () => {
  const vibe = read("typescript/tsc/internal/tsoptions/vibe.go")
  const accepted = /"Unknown vibe option "\+key\+"; use ([^"]+), or remove the option\."/.exec(vibe)?.[1]
  assert.ok(accepted, "vibe.go names the accepted vibe options")
  const appendix = read("docs/design/src/900-appendices.md")
  const row = appendix.split("\n").find(line => line.startsWith("| `vibe.proofDir` |"))
  assert.ok(row, "Appendix F lists vibe.proofDir")
  const unknown = /unknown option, `EK3007`/.test(row)
  assert.equal(unknown, !/\bproofDir\b/.test(accepted), "Appendix F's vibe.proofDir row must match vibe.go: " + accepted)
})
