import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { pathToFileURL } from "node:url"
const root = process.cwd(), require = createRequire(join(root, "docs/tools/package.json")), ts = require("typescript")
const { compareApiIdentity } = await import(pathToFileURL(join(root, "scripts/api-identity.mjs")))
const corpus = JSON.parse(readFileSync(join(root, "typescript/tsc/internal/vibelangfuzz/testdata/corpus/t3code-same-side-ambient-origins.json"), "utf8"))
const [key, modeText] = process.argv.slice(2), mode = Number(modeText) & 1
const options = { lib: ["lib.es5.d.ts"], types: [], strict: true, skipLibCheck: true, noEmit: true,
  target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext }
const fixture = mkdtempSync(join(tmpdir(), "migration-ambient-origins-"))
const put = (file, text) => { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, text) }
try {
  for (const [side, index] of [["before", 0], ["after", 1]]) {
    const base = join(fixture, side), duplicate = key !== "single" && index === mode
    const copy = key === "alias" ? "node-alias" : "node-copy"
    let names = duplicate ? ["node", copy] : ["node"]
    if (key === "reversed") names = [...names].reverse()
    for (const name of names) {
      put(join(base, "node_modules/@types", name, "package.json"), JSON.stringify(corpus.manifest))
      put(join(base, "node_modules/@types", name, "index.d.ts"), corpus.ambient)
    }
    const refs = names.map(name => `/// <reference types="${name}" />`).join("\n")
    let declaration = corpus.declaration
    if (key === "type-change" && side === "after") declaration = declaration.replace("NodeJS.ProcessEnv", "number")
    if (key === "docs-change") declaration = "/** " + (side === "before" ? "Original environment." : "Changed environment.") + " */\n" + declaration
    put(join(base, "index.d.ts"), refs + "\n" + declaration)
    put(join(base, "package.json"), '{"type":"module","types":"index.d.ts"}')
    const program = ts.createProgram([join(base, "index.d.ts")], options)
    const diagnostics = ts.getPreEmitDiagnostics(program).map(d => d.code)
    if (diagnostics.length) throw Error("invalid stock ambient-origin snapshot: " + diagnostics.join(","))
  }
  const compared = compareApiIdentity(ts, join(fixture, "before"), join(fixture, "after"), { compilerOptions: options })
  const expected = !["type-change", "docs-change"].includes(key)
  const ok = expected ? compared.identical && compared.comparisonComplete : !compared.identical
  console.log(JSON.stringify({ ok, expected, stockVersion: ts.version, stockDiagnostics: [], key, mode,
    identical: compared.identical, comparisonComplete: compared.comparisonComplete,
    nameDifferences: compared.nameDifferences, typeDifferences: compared.typeDifferences, docDifferences: compared.docDifferences,
    environmentDiagnostics: compared.environmentDiagnostics.map(({ diagnostic, blocking }) => ({ diagnostic, blocking })) }))
} finally { rmSync(fixture, { recursive: true, force: true }) }
