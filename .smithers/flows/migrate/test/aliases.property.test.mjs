// opencode-39: packages/app imports `@/composer/schema` through tsconfig
// `paths` ("@/*": ["./src/*"]). After schema.ts became .vibe the codemod left
// the alias as written, which stock `bun check` cannot resolve (TS2307); a
// relative importer had gained `./schema.vibe` (opencode-19).
import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { pathAliases, renameBatch, restoreSpecifiers, rewriteImports } from "../lib/codemod.mjs"

const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const ts = require("typescript")
const fc = require("fast-check")

function write(root, files) {
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, file)), { recursive: true })
    writeFileSync(join(root, file), text)
  }
}

// Stock TypeScript's view of a specifier from a file, under the project's options plus allowArbitraryExtensions.
function stockResolves(root, project, from, specifier) {
  const parsed = ts.getParsedCommandLineOfConfigFile(join(root, project), {}, { ...ts.sys, onUnRecoverableConfigFileDiagnostic() {} })
  const options = { ...parsed.options, allowArbitraryExtensions: true, moduleResolution: ts.ModuleResolutionKind.Bundler, module: ts.ModuleKind.ESNext }
  return ts.resolveModuleName(specifier, join(root, from), options, ts.sys).resolvedModule?.resolvedFileName
}

test("opencode-39: an alias importer names the migrated module by its source name, and revert puts it back", () => {
  const corpus = JSON.parse(readFileSync(new URL("./corpus/opencode-app-alias-importer.json", import.meta.url), "utf8"))
  const root = mkdtempSync(join(tmpdir(), "migrate-alias-"))
  try {
    write(root, corpus.files)
    const renames = renameBatch(root, corpus.renames)
    write(root, Object.fromEntries(renames.map((r) => [r.to.replace(/\.vibe$/, ".d.vibe.ts"), "export declare const X: number;\n"])))
    const scope = Object.keys(corpus.files).filter((f) => /\.(?:ts|tsx)$/.test(f) && !f.endsWith(".d.ts")).map((f) => corpus.renames.includes(f) ? f.replace(/\.ts$/, ".vibe") : f)
    const aliases = pathAliases(ts, root)
    const edits = rewriteImports(root, scope, renames.map((r) => r.to), aliases)
    assert.deepEqual(edits, corpus.edits)
    for (const { file, to } of edits) {
      if (file.endsWith(".vibe")) continue
      assert.match(stockResolves(root, corpus.project, file, to) ?? "", /\.d\.vibe\.ts$/, `${file}: ${to}`)
    }
    const restored = renames.flatMap((r) => restoreSpecifiers(root, edits, r.from, aliases))
    for (const file of Object.keys(corpus.files).filter((f) => !corpus.renames.includes(f))) assert.equal(readFileSync(join(root, file), "utf8"), corpus.files[file], file)
    assert.equal(restored.length, edits.filter((e) => !e.file.endsWith(".vibe")).length)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

// Generated projects: alias shapes (prefix wildcards, an exact alias, an
// alias from an extended config with baseUrl), specifier forms (bare, .js,
// directory index, trailing slash) and importer kinds. Every rewritten
// specifier of a .ts importer resolves, by stock TypeScript, to the migrated
// module's sidecar, and revert restores every .ts importer byte for byte.
const alias = fc.constantFrom(
  { paths: { "@/*": ["./src/*"] } },
  { paths: { "~/*": ["./src/*"], "@/*": ["./other/*"] } },
  { paths: { "#app/*": ["./src/*"], "config": ["./src/config.ts"] } },
  { extends: "./tsconfig.base.json", base: { compilerOptions: { baseUrl: ".", paths: { "@/*": ["src/*"] } } } }
)
const module = fc.constantFrom("schema", "composer/schema", "composer/index", "config")
const form = fc.constantFrom("bare", "js", "dir", "slash")

test("alias-importers: rewritten aliases resolve to the sidecar for stock TypeScript, and revert restores them", () => {
  fc.assert(fc.property(alias, module, form, fc.boolean(), (config, name, kind, vibeImporter) => {
    const prefixOf = (paths) => Object.keys(paths).find((p) => p.endsWith("/*") && paths[p][0].replace(/^\.\//, "").startsWith("src/"))
    const paths = config.paths ?? config.base.compilerOptions.paths
    const prefix = prefixOf(paths).slice(0, -1)
    const dirIndex = name.endsWith("/index")
    if ((kind === "dir" || kind === "slash") && !dirIndex) return
    const stem = dirIndex ? name.slice(0, -"/index".length) : name
    const specifier = kind === "js" ? `${prefix}${name}.js` : kind === "dir" ? `${prefix}${stem}` : kind === "slash" ? `${prefix}${stem}/` : `${prefix}${name}`
    const root = mkdtempSync(join(tmpdir(), "migrate-alias-"))
    try {
      const project = config.extends
        ? { "tsconfig.json": JSON.stringify({ extends: config.extends, include: ["src"] }), "tsconfig.base.json": JSON.stringify(config.base) }
        : { "tsconfig.json": JSON.stringify({ compilerOptions: { paths: config.paths }, include: ["src"] }) }
      const importer = vibeImporter ? "src/app/view.vibe" : "src/app/view.ts"
      const text = `import { X } from "${specifier}"\nexport const y = X\n`
      write(root, { ...project, [`src/${name}.ts`]: "export const X = 1\n", [importer]: text })
      const [rename] = renameBatch(root, [`src/${name}.ts`])
      write(root, { [rename.to.replace(/\.vibe$/, ".d.vibe.ts")]: "export declare const X: number;\n" })
      const aliases = pathAliases(ts, root)
      const edits = rewriteImports(root, [importer, rename.to], [rename.to], aliases)
      assert.equal(edits.length, 1, JSON.stringify({ specifier, edits }))
      const next = edits[0].to
      assert.ok(next.startsWith(prefix) && next.endsWith(".vibe"), next)
      if (!vibeImporter) {
        assert.equal(stockResolves(root, "tsconfig.json", importer, next), join(root, rename.to.replace(/\.vibe$/, ".d.vibe.ts")), next)
        restoreSpecifiers(root, edits, rename.from, aliases)
        assert.equal(readFileSync(join(root, importer), "utf8"), text)
      }
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  }), { seed: 39039, numRuns: 200 })
})
