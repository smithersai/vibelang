// Alchemy's old InMemory observation: capture an imported namespace member,
// then rename and revert the producer while Bun reuses its transpiler cache.
// This is coverage of the boundary, not a claim to reproduce the full target.
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, delimiter } from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"
import fc from "fast-check"

const repo = fileURLToPath(new URL("../../../", import.meta.url))
const preload = fileURLToPath(new URL("../bun.mjs", import.meta.url))
const compiler = process.env.VIBELANG_BINARY || join(repo, "packages/compiler/native/vibelang")
const bun = process.env.VIBELANG_TEST_BUN || "bun"
const available = spawnSync(bun, ["--version"]).status === 0
const skip = !available ? "Bun is required" : spawnSync(compiler, ["--version"]).status !== 0 && "build the native compiler"
const corpus = JSON.parse(readFileSync(new URL("./property-regressions/alchemy-pnpm-node-path-namespace.json", import.meta.url), "utf8"))

function inspect(input) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "alchemy-bun-namespace-")))
  const put = (file, source) => {
    const path = join(root, file)
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, typeof source === "string" ? source : JSON.stringify(source))
  }
  try {
    const app = ["app", ...Array.from({ length: input.depth }, (_, i) => "d" + i)].join("/")
    const name = input.scoped ? "@fixture/probe" : "probe"
    const pkg = "workspace/lib"
    put("package.json", { private: true, type: "module" })
    put(pkg + "/tsconfig.json", {
      compilerOptions: { strict: true, target: "ES2022", module: "Preserve", moduleResolution: "Bundler",
        skipLibCheck: true, types: [], noEmit: true, allowArbitraryExtensions: true, rewriteRelativeImportExtensions: true },
      include: ["*.ts", "*.vibe"]
    })
    mkdirSync(join(root, app, "node_modules", dirname(name)), { recursive: true })
    symlinkSync(join(root, pkg), join(root, app, "node_modules", name))
    put(app + "/a.ts", 'import { Layer } from ' + JSON.stringify(name + "/Leaf") + '; export const a = Layer;\n')
    put(app + "/b.ts", 'import { run } from ' + JSON.stringify(name + "/Use") + '; export const b = run();\n')
    put(app + "/main.ts", input.parallel
      ? 'const [a,b] = await Promise.all([import("./a.ts"),import("./b.ts")]); console.log(a.a,b.b);\n'
      : 'import { a } from "./a.ts"; import { b } from "./b.ts"; console.log(a,b);\n')
    put("empty.toml", "")
    put("bunfig.toml", input.config ? "preload = [" + JSON.stringify(preload) + "]\n" : "")
    // pnpm provides NODE_PATH. An unrelated package with the same name is a
    // negative resolution control: importer-local exports must keep priority.
    put("pnpm/node_modules/" + name + "/package.json", {
      name, type: "module", exports: { "./Leaf": "./wrong.ts", "./Use": "./wrong.ts" }
    })
    put("pnpm/node_modules/" + name + "/wrong.ts", "export const Layer=-999; export const run=()=>-999;\n")
    put(app + "/control.ts", 'import { Layer, make } from ' + JSON.stringify(name + "/Leaf") + '; console.log(Layer,make());\n')
    if (input.stableImporter) put(pkg + "/Use.vibe", 'import * as Leaf from "./Leaf.ts"\nconst captured = Leaf.make\nexport const run = (): number => captured()\n')
    const importerTime = input.stableImporter && statSync(join(root, pkg, "Use.vibe")).mtimeMs
    const outputs = []
    for (const [stage, extension] of ["ts", "vibe", "ts"].entries()) {
      for (const file of ["Leaf.ts", "Leaf.vibe", "Leaf.d.vibe.ts", ...(input.stableImporter ? [] : ["Use.ts", "Use.vibe", "Use.d.vibe.ts"])]) {
        rmSync(join(root, pkg, file), { force: true })
      }
      put(pkg + "/package.json", { name, type: "module", exports: {
        "./Leaf": "./Leaf." + extension, "./Use": "./Use." + (input.stableImporter ? "vibe" : extension)
      } })
      put(pkg + "/Leaf." + extension, "export const make = (): number => " + input.value + "\nexport const Layer = 7\n")
      if (!input.stableImporter) put(pkg + "/Use." + extension, 'import * as Leaf from "./Leaf.' + extension + '"\nconst captured = Leaf.make\nexport const run = (): number => captured()\n')
      const args = ["--config=" + join(root, "bunfig.toml"), ...(input.config ? [] : ["--preload", preload]), join(root, app, "main.ts")]
      const options = {
        cwd: root, encoding: "utf8", timeout: 30000,
        env: { ...process.env, GOMAXPROCS: "2", PATH: dirname(bun) + delimiter + process.env.PATH,
          BUN_OPTIONS: "", NODE_OPTIONS: "", VIBELANG_BINARY: compiler, VIBELANG_PROJECT: "",
          VIBELANG_CACHE_DIR: join(root, ".vibe-cache"),
          BUN_RUNTIME_TRANSPILER_CACHE_PATH: join(root, ".bun-transpiler-cache"),
          NODE_PATH: input.nodePath ? join(root, "pnpm/node_modules") : "" }
      }
      if (extension === "ts") {
        const control = spawnSync(bun, ["--config=" + join(root, "empty.toml"), join(root, app, input.stableImporter ? "control.ts" : "main.ts")], options)
        assert.ifError(control.error)
        assert.equal(control.status, 0, JSON.stringify({ input, stage, control }))
        assert.equal(control.stdout.trim(), "7 " + input.value, JSON.stringify({ input, stage, control }))
      }
      const run = spawnSync(bun, args, options)
      assert.ifError(run.error)
      assert.equal(run.signal, null)
      assert.equal(run.status, 0, JSON.stringify({ input, stage, extension, stdout: run.stdout, stderr: run.stderr }))
      assert.equal(run.stdout.trim(), "7 " + input.value, JSON.stringify({ input, stage, extension, stderr: run.stderr }))
      outputs.push(run.stdout)
    }
    assert.equal(new Set(outputs).size, 1)
    if (input.stableImporter) assert.equal(statSync(join(root, pkg, "Use.vibe")).mtimeMs, importerTime, "native importer source must remain untouched")
  } finally { rmSync(root, { recursive: true, force: true }) }
}

test("Alchemy namespace capture survives native rename and revert with a reused Bun cache", { skip }, () => {
  assert.ok(readFileSync(join(repo, corpus.spec), "utf8").includes(corpus.quote))
  inspect(corpus)
})

test("property: namespace captures keep local export identity across pnpm layouts and rename/revert", { skip }, () => {
  fc.assert(fc.property(fc.record({
    depth: fc.integer({ min: 0, max: 3 }), scoped: fc.boolean(), parallel: fc.boolean(),
    config: fc.boolean(), nodePath: fc.boolean(), stableImporter: fc.boolean(), value: fc.integer({ min: -50, max: 50 })
  }), input => { inspect(input); return true }), { seed: 300055, numRuns: 16 })
})
