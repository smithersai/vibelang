// run-seconds: 120
// The retired declarationImportStyle setting warns with EK3011 in both legacy
// locations for every value and changes neither exit status nor output.
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { spawnSync } from "node:child_process"

const binary = process.env.VIBELANG_BINARY
assert.ok(binary, "the harness supplies its built compiler")
const roots = []
const compilerOptions = {
  target: "es2022", module: "nodenext", moduleResolution: "nodenext", strict: true, types: [], lib: ["esnext"],
  skipLibCheck: true, declaration: true, noEmitOnError: true, rewriteRelativeImportExtensions: true, outDir: "out"
}
const sources = {
  "user.vibe": "export type User = { readonly name: string }\nexport const user: User = { name: \"a\" }\n",
  "main.vibe": "import { user } from \"./user.vibe\"\nexport const copy = user\n"
}

function project(config) {
  const root = mkdtempSync(join(tmpdir(), "w02-import-style-"))
  roots.push(root)
  for (const [file, text] of Object.entries({ "package.json": '{"type":"module"}\n', ...sources, "tsconfig.json": JSON.stringify(config) })) {
    mkdirSync(dirname(join(root, file)), { recursive: true })
    writeFileSync(join(root, file), text)
  }
  return root
}
function compile(root) {
  const run = spawnSync(binary, ["-p", "tsconfig.json", "--pretty", "false"], { cwd: root, encoding: "utf8", timeout: 120000 })
  const diagnostics = [...run.stdout.matchAll(/^(\S+)\((\d+),(\d+)\): (error|warning) ((?:EK|TS)\d+)/gm)]
    .map(m => ({ file: m[1], column: Number(m[3]), category: m[4], code: m[5] }))
  return { status: run.status, stdout: run.stdout + run.stderr, diagnostics }
}
const outputs = root => ["out/main.js", "out/main.d.ts", "out/user.js", "out/user.d.ts"].map(f => readFileSync(join(root, f), "utf8"))

try {
  const base = project({ compilerOptions, files: ["main.vibe"] })
  const baseRun = compile(base)
  assert.equal(baseRun.status, 0, baseRun.stdout)
  assert.deepEqual(baseRun.diagnostics, [], baseRun.stdout)
  const baseOut = outputs(base)
  const spelling = baseOut[1].match(/import\("([^"]+)"\)/)?.[1]
  console.log(`without the setting: exit 0, main.d.ts imports ${spelling}`)

  const values = [".js", ".ts", ".vibe", "extensionless", "invalid", "", 42, null, true, {}, []]
  const sections = {
    "vibelang": value => ({ compilerOptions, files: ["main.vibe"], vibelang: { declarationImportStyle: value } }),
    "compilerOptions.vibelang": value => ({ compilerOptions: { ...compilerOptions, vibelang: { declarationImportStyle: value } }, files: ["main.vibe"] })
  }
  for (const [section, make] of Object.entries(sections)) {
    for (const value of values) {
      const config = make(value)
      const root = project(config)
      const result = compile(root)
      const key = JSON.stringify(config).indexOf('"declarationImportStyle"') + 1
      assert.deepEqual(result.diagnostics, [{ file: "tsconfig.json", column: key, category: "warning", code: "EK3011" }],
        `${section} = ${JSON.stringify(value)}\n${result.stdout}`)
      assert.equal(result.status, 0, `nonfatal: ${section} = ${JSON.stringify(value)}\n${result.stdout}`)
      assert.deepEqual(outputs(root), baseOut, `output unchanged: ${section} = ${JSON.stringify(value)}`)
    }
    console.log(`${section}.declarationImportStyle: one EK3011 warning at the key for ${values.length} values, exit 0, output unchanged`)
  }

  // Both legacy locations at once: one warning for each.
  const both = { compilerOptions: { ...compilerOptions, vibelang: { declarationImportStyle: ".js" } }, files: ["main.vibe"], vibelang: { declarationImportStyle: "extensionless" } }
  const bothRun = compile(project(both))
  assert.deepEqual(bothRun.diagnostics.map(d => `${d.category} ${d.code}`), ["warning EK3011", "warning EK3011"], bothRun.stdout)
  assert.equal(bothRun.status, 0, bothRun.stdout)
  console.log("both legacy locations: two EK3011 warnings, exit 0")

  // Neighbour: the modern vibe object never had this key; it is unknown there.
  const modern = { compilerOptions, files: ["main.vibe"], vibe: { declarationImportStyle: ".ts" } }
  const modernRun = compile(project(modern))
  assert.deepEqual(modernRun.diagnostics.map(d => `${d.category} ${d.code}`), ["error EK3007"], modernRun.stdout)
  assert.equal(modernRun.status, 1, modernRun.stdout)
  console.log("vibe.declarationImportStyle: error EK3007 (unknown vibe key), exit 1")
} finally {
  for (const root of roots) rmSync(root, { recursive: true, force: true })
}
