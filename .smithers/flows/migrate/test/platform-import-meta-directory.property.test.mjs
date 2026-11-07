// A declaration the platform split moves keeps refusing to read import.meta,
// which would name the sibling after the move. The sibling lives in the
// module's directory, so what names that directory names the same one there:
// path's dirname of url's fileURLToPath(import.meta.url), and the companion's
// $importMetaDirname and $importMetaResolve helpers given import.meta.url
// (the import.meta.dirname and import.meta.resolve repairs). Smithers' seeded-
// bugs labels and run, build-cli RepoResolution and Planner modules stayed
// TypeScript only for such a read.
import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { pathToFileURL } from "node:url"
import { splitPlatform } from "../lib/platform.mjs"

const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const ts = require("typescript"), fc = require("fast-check")

// The module's exports called in dir: each function's result, with dir written as "<dir>".
async function load(dir, files) {
  mkdirSync(dir, { recursive: true })
  for (const [name, text] of Object.entries(files)) {
    const js = ts.transpileModule(text, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText
    writeFileSync(join(dir, name.replace(/\.ts$/, ".mjs")), js.replace(/"\.\/([\w.]+)\.ts"/g, '"./$1.mjs"'))
  }
  const m = await import(pathToFileURL(join(dir, "m.mjs")).href)
  const seen = {}
  for (const key of Object.keys(m).sort()) seen[key] = typeof m[key] === "function" ? String(m[key]()).replaceAll(dir, "<dir>") : String(m[key])
  return seen
}

const forms = {
  "dirname of fileURLToPath": ['import { dirname, join } from "node:path"\nimport { fileURLToPath } from "node:url"\n', 'join(dirname(fileURLToPath(import.meta.url)), "corpus")'],
  "namespace dirname": ['import * as NodePath from "node:path"\nimport * as NodeUrl from "node:url"\n', 'NodePath.join(NodePath.dirname(NodeUrl.fileURLToPath(import.meta.url)), "corpus")'],
  "import.meta.dirname": ['import { join } from "node:path"\n', 'join(import.meta.dirname, "corpus")'],
}

test("smithers: a moved declaration that names the module's directory moves, and names the same directory", async () => {
  const root = mkdtempSync(join(tmpdir(), "migrate-platform-directory-"))
  try {
    for (const [name, [imports, directory]] of Object.entries(forms)) {
      const text = `${imports}/** Where the seeded corpus lives. */\nexport const corpusDir = (): string => ${directory}\nexport const label = "labels"\n`
      const split = splitPlatform(text, "m.ts", ts)
      assert.ok(split && !split.refused, `${name}: ${split?.refused}`)
      assert.match(split.module, /^export const corpusDir = \(\): string => \$platform\.corpusDir\(\)$/m, name)
      const original = await load(join(root, name.replaceAll(" ", "-"), "o"), { "m.ts": text })
      const after = await load(join(root, name.replaceAll(" ", "-"), "s"), { "m.ts": split.module, "m.platform.ts": split.platform })
      assert.deepEqual(after, original, name + "\n" + split.module + "\n---\n" + split.platform)
      assert.equal(after.corpusDir, "<dir>/corpus", name)
    }
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test("a moved declaration that names the module's file or entry keeps the refusal", () => {
  const head = 'import { basename, dirname, join } from "node:path"\nimport { fileURLToPath } from "node:url"\n'
  for (const read of ["fileURLToPath(import.meta.url)", "basename(fileURLToPath(import.meta.url))", "String(import.meta.main)", "import.meta.url", "dirname(import.meta.url)"]) {
    const text = `${head}export const where = (): string => join(${read}, "x")\nexport const label = "labels"\n`
    assert.match(splitPlatform(text, "m.ts", ts).refused ?? "", /reads import\.meta|import\.meta use/, read)
  }
  // A local function that shadows the import is not path's dirname.
  const shadow = 'import { join } from "node:path"\nimport { fileURLToPath } from "node:url"\nconst dirname = (p: string): string => p\nexport const where = (): string => join(dirname(fileURLToPath(import.meta.url)), "x")\nexport const label = "labels"\n'
  assert.match(splitPlatform(shadow, "m.ts", ts).refused ?? "", /reads import\.meta/)
})

// Neighbourhood: each directory form, at a function's body, a default
// parameter or a const's initializer, beside a kept export: the split moves
// it and the moved code computes the module's own directory.
test("every directory form moved names the module's directory", async () => {
  const root = mkdtempSync(join(tmpdir(), "migrate-platform-directory-prop-"))
  let runs = 0
  try {
    await fc.assert(fc.asyncProperty(fc.constantFrom(...Object.keys(forms)), fc.constantFrom("body", "default", "const"), async (form, at) => {
      const [imports, directory] = forms[form]
      const declaration = at === "body" ? `export function corpusDir(): string { return ${directory} }\n`
        : at === "default" ? `export function corpusDir(dir: string = ${directory}): string { return dir }\n`
        : `const resolved = ${directory}\nexport const corpusDir = (): string => resolved\n`
      const text = `${imports}${declaration}export const label = "labels"\n`
      const split = splitPlatform(text, "m.ts", ts)
      assert.ok(split && !split.refused, `${form} at ${at}: ${split?.refused}`)
      runs++
      const original = await load(join(root, `o${runs}`), { "m.ts": text })
      const after = await load(join(root, `s${runs}`), { "m.ts": split.module, "m.platform.ts": split.platform })
      assert.deepEqual(after, original, text + "\n---\n" + split.module + "\n---\n" + split.platform)
    }), { numRuns: 18 })
  } finally { rmSync(root, { recursive: true, force: true }) }
})
