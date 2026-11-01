import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"
import { tmpdir } from "node:os"
import { fileURLToPath } from "node:url"
import test from "node:test"
import { importerFiles } from "./importer-declaration-files.mjs"

const repo = fileURLToPath(new URL("../../../", import.meta.url))
const require = createRequire(new URL("../../runtime/package.json", import.meta.url))
const fc = require("fast-check")
const binary = process.env.VIBELANG_BINARY || join(repo, "packages/compiler/native/vibelang")
const stock = process.env.VIBELANG_STOCK_TSC || join(repo, "packages/runtime/node_modules/.bin/tsc")
const modules = process.env.EFFECT_NODE_MODULES || join(repo, "experiments/node_modules")
const runtime = process.env.VIBELANG_RUNTIME || join(repo, "packages/runtime")
const fixture = JSON.parse(readFileSync(new URL("./property-regressions/t3code-importer-sidecar-declaration.json", import.meta.url), "utf8"))

test("the importer declaration oracle quotes source selection and preserves its literal corpus", () => {
  const chapter = readFileSync(join(repo, "docs/design/src/007-tooling.md"), "utf8")
  assert.ok(chapter.includes("A compatibility sidecar is an emit output: when `include` or default discovery selects both `x.vibe` and `x.d.vibe.ts`, the source wins and the sidecar leaves the program, as discovery selects `x.ts` ahead of `x.d.ts`."))
  assert.ok(chapter.includes("A sidecar explicitly listed in `files` remains an input."))
  assert.ok(chapter.includes("If the compatibility write would overwrite it, the compiler reports native `TS5055` (`Cannot write file … because it would overwrite input file`), exits `1` and leaves its bytes unchanged."))
  assert.ok(chapter.includes("VibeLang resolves a relative `./x.vibe` to source; plain `tsc` reads the compatibility declaration."))
  assert.ok(chapter.includes("A non-relative specifier that TypeScript resolves to `x.d.vibe.ts` or `x.d.vibex.ts`, through a package `types` export, a `paths` entry or package `#imports`, resolves to the available `x.vibe` or `x.vibex` source when the final resolved path is outside `node_modules`."))
  assert.ok(chapter.includes("Classify the path after TypeScript's own `realpath` step, not the written name: a linked workspace package normally reads its source."))
  assert.ok(chapter.includes("With `preserveSymlinks: true` the logical path keeps its `node_modules` segment and therefore its declarations, as a published package does; TypeScript may then distinguish the source and declaration modules."))
  assert.ok(chapter.includes("For relocated sidecars, follow the source that the sidecar map names rather than guessing from basenames."))
  assert.ok(chapter.includes("An explicitly listed sidecar remains an input even when another import redirects to its source, and its attempted overwrite keeps `TS5055` protection."))
  for (const [name, hash] of Object.entries(fixture.hashes)) {
    assert.equal(createHash("sha256").update(fixture.files[name]).digest("hex"), hash, name)
  }
})

function check(input, literal) {
  const root = mkdtempSync(join(tmpdir(), "vibelang-importer-declaration-"))
  try {
    const files = literal || importerFiles(input)
    const declarations = {}
    for (const [engine, compiler] of [["stock", stock], ["native", binary]]) {
      // The stock control contains only the original compatibility declaration;
      // the native program also sees its source. Both must emit identical bytes.
      const dir = join(root, engine)
      mkdirSync(join(dir, "node_modules"), { recursive: true })
      symlinkSync("../lib", join(dir, "node_modules/lib"), "dir")
      symlinkSync(join(modules, "effect"), join(dir, "node_modules/effect"), "dir")
      symlinkSync(runtime, join(dir, "node_modules/vibelang-runtime"), "dir")
      for (const [name, text] of Object.entries(files)) {
        if (engine === "stock" && name.endsWith(".vibe")) continue
        const path = join(dir, name)
        mkdirSync(dirname(path), { recursive: true })
        writeFileSync(path, text)
      }
      const result = spawnSync(compiler, ["-p", "tsconfig.json", "--pretty", "false"], {
        cwd: dir, encoding: "utf8", timeout: 120000, maxBuffer: 2 << 20,
        env: { ...process.env, GOMAXPROCS: "2" },
      })
      assert.ifError(result.error)
      assert.equal(result.signal, null, engine + " compiler terminated")
      assert.equal(result.status, 0, engine + ": " + result.stdout + result.stderr)
      declarations[engine] = readFileSync(join(dir, "out/src/a.d.ts"), "utf8")
    }
    assert.equal(declarations.native, declarations.stock, JSON.stringify(input))
    assert.ok(declarations.native.includes("import * as " + input.alias + ' from "lib/Provider"'))
    assert.ok(declarations.native.includes("remoteOf: (d: Driver) => (c: " + input.alias + ".Ctx"))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

test("t3code: source and sidecar import paths preserve the importer namespace in raw declarations", () => {
  check(fixture.input, fixture.files)
})

test("importer declaration identity spans relative and package paths, aliases and generic nominal types", () => {
  fc.assert(fc.property(fc.record({
    route: fc.constantFrom("relative", "package"),
    generic: fc.boolean(),
    alias: fc.constantFrom("Provider", "P", "Source"),
    shape: fc.constantFrom("interface", "class"),
  }), input => check(input)), { seed: 361108, numRuns: 24, endOnFailure: true })
})
