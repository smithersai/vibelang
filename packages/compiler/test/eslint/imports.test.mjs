// eslint-plugin-import on .ts files that import .vibe modules. The plugin
// parses an imported module with the parser `import/parsers` maps its
// extension to; with `vibelang/eslint` mapped to .vibe it reads every export a
// .vibe module declares, VibeLang's declarations included, so
// import/namespace and import/named check a .ts importer as they check one
// that imports a .ts module. Without the mapping it finds no exports
// (smithers flows/kernel: "'batch' not found in imported namespace").
import { strict as assert } from "node:assert"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import { ESLint } from "eslint"
import importPlugin from "eslint-plugin-import"
import tseslint from "typescript-eslint"

const parserPath = fileURLToPath(new URL("../../eslint.mjs", import.meta.url))
const corpus = JSON.parse(readFileSync(new URL("../../../../.smithers/flows/migrate/test/corpus/smithers-eslint-import-namespace-vibe.json", import.meta.url), "utf8"))

const rules = { "import/namespace": "error", "import/named": "error", "import/default": "error", "import/no-unresolved": "error" }
const configFor = (mapped) => [
  {
    files: ["**/*.ts"],
    languageOptions: { parser: tseslint.parser, sourceType: "module" },
    plugins: { import: importPlugin },
    settings: {
      "import/parsers": { "@typescript-eslint/parser": [".ts"], ...(mapped ? { [parserPath]: [".vibe"] } : {}) },
      "import/extensions": [".ts", ".vibe"]
    },
    rules
  }
]

async function lint(t, files, mapped = true) {
  const root = mkdtempSync(join(tmpdir(), "vibelang-eslint-imports-"))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  for (const [name, text] of Object.entries(files)) writeFileSync(join(root, name), text)
  const eslint = new ESLint({ cwd: root, overrideConfigFile: true, overrideConfig: configFor(mapped) })
  const [result] = await eslint.lintFiles([join(root, "importer.ts")])
  return result.messages.map((message) => `${message.ruleId ?? "fatal"}: ${message.message}`)
}

test("eslint-plugin-import reads a .vibe module's exports through vibelang/eslint", async (t) => {
  const files = { "FileSystemBatch.vibe": corpus.module, "FileSystem.ts": corpus.barrel, "importer.ts": corpus.importer }
  assert.deepEqual(await lint(t, files), [])
  // The Smithers report, without the mapping.
  const unmapped = await lint(t, files, false)
  assert.ok(unmapped.includes("import/namespace: 'batch' not found in imported namespace 'KernelFileSystem'."), unmapped.join("\n"))
})

// Each VibeLang declaration that exports a name, and the name it exports.
const forms = [
  ["error", (n) => `export error ${n} { reason: string }`],
  ["error class", (n) => `export error ${n} extends Error {}`],
  ["service", (n) => `export service ${n} { run(x: number): number }`],
  ["schema", (n) => `export schema ${n} { path: string }`],
  ["schema alias", (n) => `export schema ${n} = "a" | "b"`],
  ["data", (n) => `export data ${n} { Done; Failed { cause: string } }`],
  ["effect function", (n) => `export effect function ${n}(x: number) { return x }`],
  ["const", (n) => `export const ${n} = 1`],
  ["function", (n) => `export function ${n}() { return 1 }`],
  ["class", (n) => `export class ${n} {}`]
]

// mulberry32: a seeded generator, so a failure names its seed.
function random(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0
    let x = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296
  }
}

test("import/named and import/namespace report exactly the names a .vibe module does not export", async (t) => {
  for (let seed = 1; seed <= 24; seed++) {
    const next = random(seed)
    const exported = forms.filter(() => next() < 0.5).map(([, write], i) => [`Name${seed}x${i}`, write])
    const missing = [`Missing${seed}`]
    const names = [...exported.map(([name]) => name), ...missing]
    const module = exported.map(([name, write]) => write(name)).join("\n") + "\nexport const anchor = 0\n"
    const importer = [
      `import { ${names.join(", ")} } from "./m.vibe"`,
      `import * as M from "./m.vibe"`,
      `export const used = [${names.join(", ")}, ${names.map((name) => `M.${name}`).join(", ")}]`,
      ""
    ].join("\n")
    const messages = await lint(t, { "m.vibe": module, "importer.ts": importer })
    const expected = missing.flatMap((name) => [`import/named: ${name} not found in './m.vibe'`, `import/namespace: '${name}' not found in imported namespace 'M'.`])
    assert.deepEqual(messages.sort(), expected.sort(), `seed ${seed}\n${module}\n${importer}`)
  }
})
