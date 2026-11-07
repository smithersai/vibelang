import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"
import fc from "fast-check"

const repo = fileURLToPath(new URL("../../../", import.meta.url))
const compiler = process.env.VIBELANG_BINARY || join(repo, "packages/compiler/native/vibelang")
const preload = fileURLToPath(new URL("../bun.mjs", import.meta.url))
const corpus = JSON.parse(readFileSync(new URL("./corpus/alchemy-bun-module-body-companion.json", import.meta.url)))
const skip = spawnSync("bun", ["--version"]).status !== 0 ? "Bun required" :
  spawnSync(compiler, ["--version"]).status !== 0 && "build the compiler"
const spec = readFileSync(join(repo, "docs/design/src/001-functions.md"), "utf8")
// Chapter 1, Modules and the top level: moving a body to a sibling .ts file
// "changes no diagnostic, type, emitted statement, declaration or run-time observation".
const quote = "changes no diagnostic, type, emitted statement, declaration or run-time observation"

// Each body is the code a sibling twin.ts holds; the containing .vibe file
// re-exports it. Bun with the vibelang/bun preload must observe what Bun
// observes for the twin, under `bun run` and `bun test` (Alchemy's unit
// collection loads Connection.vibe.throwing.js and LoginSession.vibe.platform.js).
function body(imports, value) {
  if (imports === "helper") return { files: { "src/helper.ts": "export const base = " + value + "\n" },
    code: "import { base } from \"./helper.ts\"\nexport const value = base\n" }
  if (imports === "extensionless") return { files: { "src/extra.ts": "export const base = " + value + "\n" },
    code: "import { base } from \"./extra\"\nexport const value = base\n" }
  // The project has no @types/node; a local ambient module types the import.
  if (imports === "node") return { files: { "src/node-path.d.ts": "declare module \"node:path\" { export function basename(path: string): string }\n" },
    code: "import { basename } from \"node:path\"\nexport const value = basename(\"/a/" + value + "\").length + " + (value - String(value).length) + "\n" }
  return { files: {}, code: "export const value = " + value + "\n" }
}

function check({ name, imports, runner, dynamic, value }) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "vibe-module-body-")))
  const put = (file, text) => { mkdirSync(dirname(join(root, file)), { recursive: true }); writeFileSync(join(root, file), text) }
  try {
    put("package.json", '{"type":"module"}')
    put("tsconfig.json", JSON.stringify({ compilerOptions: { target: "ESNext", module: "ESNext", moduleResolution: "Bundler",
      strict: true, noEmit: true, types: [], skipLibCheck: true, allowImportingTsExtensions: true },
      vibe: { effectModules: false, effectGlobals: false }, include: ["src", "*.ts"] }))
    const { files, code } = body(imports, value)
    for (const [file, text] of Object.entries(files)) put(file, text)
    put("src/leaf.vibe", "module " + name + " {\n" + code + "}\nexport { value } from " + name + "\n")
    put("src/twin.ts", code)
    const run = (specifier, loaded) => {
      const read = dynamic ? "const { value } = await import(" + JSON.stringify(specifier) + ")\n" : "import { value } from " + JSON.stringify(specifier) + "\n"
      const args = loaded ? ["--preload", preload] : []
      if (runner === "test") {
        put("leaf.test.ts", 'import { expect, test } from "bun:test"\n' + read + 'test("value", () => { console.log("VALUE " + value); expect(typeof value).toBe("number") })\n')
        args.unshift("test"); args.push("./leaf.test.ts")
      } else {
        put("main.ts", read + 'console.log("VALUE " + value)\n'); args.push("main.ts")
      }
      const out = spawnSync("bun", args, { cwd: root, encoding: "utf8", timeout: 60000,
        env: { ...process.env, VIBELANG_BINARY: compiler, VIBELANG_PROJECT: "", VIBELANG_CACHE_DIR: join(root, "cache") } })
      return { status: out.status, value: (out.stdout + out.stderr).match(/VALUE (-?\d+)/)?.[1] ?? null, output: out.stdout + out.stderr }
    }
    const expected = run("./src/twin.ts", false)
    assert.equal(expected.status, 0, expected.output)
    const actual = run("./src/leaf.vibe", true)
    const label = JSON.stringify({ name, imports, runner, dynamic, value })
    assert.equal(actual.status, 0, label + "\n" + actual.output)
    assert.equal(actual.value, expected.value, label + "\n" + actual.output)
  } finally { rmSync(root, { recursive: true, force: true }) }
}

test("Chapter 1 still states the module-body move rule", () => assert.ok(spec.includes(quote), quote))

test("Bun loads the Alchemy module-body companions like their TypeScript twins", { skip }, () => {
  for (const witness of corpus.cases) check(witness)
})

test("Bun module-body companions match the twin across names, imports and runners", { skip }, async () => {
  await fc.assert(fc.asyncProperty(fc.record({
    name: fc.constantFrom("throwing", "platform", "host", "parse", "Über"),
    imports: fc.constantFrom("none", "helper", "extensionless", "node"),
    runner: fc.constantFrom("run", "test"),
    dynamic: fc.boolean(),
    value: fc.integer({ min: 1, max: 99 })
  }), check), { numRuns: 16, verbose: 1 })
})
