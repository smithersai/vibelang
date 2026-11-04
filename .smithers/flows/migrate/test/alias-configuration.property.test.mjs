import assert from "node:assert/strict"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { join, dirname, posix } from "node:path"
import { tmpdir } from "node:os"
import { spawnSync } from "node:child_process"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import { makeConfig, wireTarget } from "../lib/steps.mjs"
import { pathAliases, renameBatch, restoreSpecifiers, rewriteImports } from "../lib/codemod.mjs"

const repo = fileURLToPath(new URL("../../../../", import.meta.url))
const require = createRequire(join(repo, "packages/runtime/package.json"))
const ts = require("typescript"), fc = require("fast-check")
const compiler = process.env.VIBELANG_BINARY || join(repo, "packages/compiler/native/vibelang")
const corpus = JSON.parse(readFileSync(new URL("./corpus/opencode-alias-configuration.json", import.meta.url), "utf8"))
const exactCorpus = JSON.parse(readFileSync(new URL("./corpus/opencode-exact-path-alias.json", import.meta.url), "utf8"))
const chapter = readFileSync(join(repo, "docs/design/src/007-tooling.md"), "utf8")
const quote = "Type checkers use `.d.vibe.ts`; linters, Knip, bundlers and test runners read `.vibe`."

function compile(root) {
  assert.ok(existsSync(compiler), "build the compiler or set VIBELANG_BINARY")
  const result = spawnSync(compiler, ["-p", join(root, "tsconfig.json"), "--pretty", "false"],
    { cwd: root, encoding: "utf8", timeout: 120000, env: { ...process.env, GOMAXPROCS: "2" } })
  assert.ifError(result.error)
  assert.equal(result.signal, null)
  const diagnostics = [...(result.stdout + result.stderr).matchAll(/([^\n]+)\((\d+),(\d+)\): error ([A-Z]+\d+):/g)]
    .map(match => ({ file: match[1].replaceAll("\\", "/"), code: match[4] }))
  return { status: result.status, diagnostics, output: (result.stdout + result.stderr).replaceAll(root, "<fixture>").replaceAll(compiler, "<compiler>") }
}

function stock(root) {
  const result = spawnSync(process.execPath, [require.resolve("typescript/lib/tsc.js"), "-p", join(root, "tsconfig.json"), "--pretty", "false"],
    { cwd: root, encoding: "utf8", timeout: 120000 })
  assert.ifError(result.error)
  assert.equal(result.signal, null)
  return { status: result.status, output: (result.stdout + result.stderr).replaceAll(root, "<fixture>") }
}

function successful(result, label) {
  assert.equal(result.status, 0, label + ": " + result.output)
  assert.deepEqual(result.diagnostics, [], label)
}

async function inspect(input) {
  assert.ok(chapter.includes(quote), "Chapter 7's existing-tools contract")
  const root = mkdtempSync(join(tmpdir(), "migrate-alias-config-"))
  try {
    const stem = [...Array.from({ length: input.depth }, (_, i) => "d" + i), "a", ...(input.index ? ["index"] : [])].join("/")
    const sourceExt = input.sourceExt ?? ".ts"
    const target = "src/" + stem + sourceExt, importer = "src/b.ts"
    const specifier = input.kind === "exact" ? (input.alias ?? "models") : input.prefix + (sourceExt === ".mts" ? stem + ".mjs" : input.index ? stem.slice(0, -"/index".length) : stem)
    const paths = input.kind === "exact" ? { [specifier]: ["./" + target] } : { [input.prefix + "*"]: ["./src/*"] }
    const original = "import { x } from " + JSON.stringify(specifier) + "; export const result: number = x;\n"
    const files = {
      "package.json": '{"name":"fixture","type":"module","private":true}',
      "tsconfig.json": JSON.stringify({ compilerOptions: {
        strict: true, target: "ES2022", module: "Preserve", moduleResolution: "Bundler",
        skipLibCheck: true, noEmit: true, allowArbitraryExtensions: true,
        allowImportingTsExtensions: true, types: [], paths
      }, include: ["src"] }),
      [target]: "export const x = 1;\n", [importer]: original
    }
    for (const [file, text] of Object.entries(files)) {
      mkdirSync(dirname(join(root, file)), { recursive: true })
      writeFileSync(join(root, file), text)
    }
    const config = ts.getParsedCommandLineOfConfigFile(join(root, "tsconfig.json"), {}, { ...ts.sys, onUnRecoverableConfigFileDiagnostic() {} })
    const nativeTarget = ts.resolveModuleName(specifier, join(root, importer), config.options, ts.sys).resolvedModule
    assert.equal(nativeTarget?.resolvedFileName, join(root, target), "generated alias has the intended stock TypeScript target")
    successful(compile(root), "unmodified native TypeScript control")
    if (input.stock) {
      let result = stock(root)
      assert.equal(result.status, 0, result.output)
      writeFileSync(join(root, importer), original.replace(JSON.stringify(specifier), JSON.stringify(specifier + ".vibe")))
      result = stock(root)
      assert.equal(result.status, 2, result.output)
      assert.match(result.output, /TS2307/)
      writeFileSync(join(root, importer), original)
    }
    if (input.wire) {
      mkdirSync(join(root, "node_modules"), { recursive: true })
      symlinkSync(join(repo, "packages/runtime/node_modules/typescript"), join(root, "node_modules/typescript"), "dir")
      const init = spawnSync("jj", ["git", "init", root], { encoding: "utf8" })
      assert.equal(init.status, 0, init.stderr)
      const config = makeConfig({ target: root, test: "true", vibelangVersion: "0.0.11", install: "true" })
      config.packages = [{ dir: ".", sources: ["src"], tsconfig: "tsconfig.json", dtsTsconfig: "tsconfig.json" }]
      await wireTarget(config, join(root, ".logs"))
      successful(compile(root), "native control after actual setup")
    }
    const aliases = pathAliases(ts, root)
    const [renamed] = renameBatch(root, [target])
    const edits = rewriteImports(root, [renamed.to, importer], [renamed.to], aliases)
    if (input.kind === "exact") {
      let relative = posix.relative(posix.dirname(importer), renamed.to)
      if (!relative.startsWith(".")) relative = "./" + relative
      assert.equal(edits.length, 1)
      assert.equal(edits[0].to, relative, "an opaque alias key uses the same resolved source")
    }
    const migrated = compile(root)
    successful(migrated, "migration preserves the native check")
    if (input.stock) {
      const result = stock(root)
      assert.equal(result.status, 0, result.output)
    }

    renameSync(join(root, renamed.to), join(root, renamed.from))
    const restored = restoreSpecifiers(root, edits, renamed.from, aliases)
    const after = compile(root), text = readFileSync(join(root, importer), "utf8")
    assert.equal(text, original, "revert restores the original alias spelling")
    successful(after, "restored native check")
    if (input.kind === "exact") assert.equal(restored.length, 1)
    if (input.stock) {
      const result = stock(root)
      assert.equal(result.status, 0, result.output)
      console.log("stock TypeScript " + ts.version + " exact alias twin: authored=0; invented alias=TS2307; migrated=0; reverted=0")
    }
  } finally { rmSync(root, { recursive: true, force: true }) }
}

// Chapter 007 / actual setup and native checks preserve alias configuration coherence: docs/design/src/007-tooling.md#6076a170de8e438c
// Chapter 007 / actual setup and native checks preserve alias configuration coherence: docs/design/src/007-tooling.md#0937ee616d12e256
// Chapter 007 / actual setup and native checks preserve alias configuration coherence: docs/design/src/007-tooling.md#dfea88aeb731cf9c
test("opencode-54: actual setup, alias migration and inverse native controls", () => inspect(corpus.input))
test("exact path alias names preserve native checks and round-trip", () =>
  inspect({ ...corpus.input, kind: "exact", wire: false }))
test("opencode-54: exact path alias reaches its source for stock TypeScript and reverts", () => inspect(exactCorpus.input))
test("exact path aliases round-trip across setup, source extensions and directory layouts", async t => {
  for (const wire of [false, true]) for (const sourceExt of [".ts", ".mts"])
    for (const depth of [0, 2]) for (const index of [false, true])
      await t.test(JSON.stringify({ wire, sourceExt, depth, index }), () =>
        inspect({ kind: "exact", wire, sourceExt, depth, index, prefix: "@/", alias: "models" }))
})
test("alias/config coherence across wildcard and exact maps, nested and directory-index modules", async () => {
  await fc.assert(fc.asyncProperty(fc.record({
    kind: fc.constantFrom("wildcard", "exact"), wire: fc.boolean(),
    alias: fc.constantFrom("models", "@models/core", "models.entry", "models.js"), sourceExt: fc.constantFrom(".ts", ".mts"),
    prefix: fc.constantFrom("@/", "~/", "#app/"), depth: fc.integer({ min: 0, max: 2 }), index: fc.boolean()
  }), inspect), { seed: 541101, numRuns: 36 })
})
