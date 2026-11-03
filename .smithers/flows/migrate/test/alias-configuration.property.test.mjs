import assert from "node:assert/strict"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { join, dirname } from "node:path"
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
const raw = process.env.VIBELANG_ALIAS_CONFIGURATION_RAW === "1"
const chapter = readFileSync(join(repo, "docs/design/src/007-tooling.md"), "utf8")
const quote = "Type checkers work through `.d.vibe.ts`, and linters, Knip, bundlers and test runners each read `.vibe`."

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

function successful(result, label) {
  assert.equal(result.status, 0, label + ": " + result.output)
  assert.deepEqual(result.diagnostics, [], label)
}

async function inspect(input) {
  assert.ok(chapter.includes(quote), "Chapter 7's existing-tools contract")
  const root = mkdtempSync(join(tmpdir(), "migrate-alias-config-"))
  try {
    const stem = [...Array.from({ length: input.depth }, (_, i) => "d" + i), "a", ...(input.index ? ["index"] : [])].join("/")
    const target = "src/" + stem + ".ts", importer = "src/b.ts"
    const specifier = input.kind === "exact" ? "models" : input.prefix + (input.index ? stem.slice(0, -"/index".length) : stem)
    const paths = input.kind === "exact" ? { models: ["./" + target] } : { [input.prefix + "*"]: ["./src/*"] }
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
    successful(compile(root), "unmodified native TypeScript control")
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
    const migrated = compile(root)
    const pending = input.kind === "exact" && !input.wire ? corpus.pending?.exact_alias : undefined
    if (!raw && pending) {
      const code = input.kind === "exact" ? "TS2307" : "TS2877"
      assert.equal(pending.owner, "migfix-opencode")
      assert.equal(migrated.status, 2, "XPASS " + pending.key + ": retire its pending entry")
      assert.deepEqual(migrated.diagnostics, [{ file: importer, code }], "only the exact original alias disagreement is pending: " + migrated.output)
    } else successful(migrated, "migration preserves the native check")

    renameSync(join(root, renamed.to), join(root, renamed.from))
    const restored = restoreSpecifiers(root, edits, renamed.from, aliases)
    const after = compile(root), text = readFileSync(join(root, importer), "utf8")
    if (!raw && input.kind === "exact" && !input.wire && corpus.pending?.exact_alias) {
      assert.equal(restored.length, 0, "XPASS exact-alias revert: retire its pending entry")
      assert.notEqual(text, original)
      assert.ok(text.includes('"models.vibe"'))
      assert.equal(after.status, 2)
      assert.deepEqual(after.diagnostics, [{ file: importer, code: "TS2307" }])
    } else {
      assert.equal(text, original, "revert restores the original alias spelling")
      successful(after, "restored native check")
    }
  } finally { rmSync(root, { recursive: true, force: true }) }
}

// Chapter 007 / actual setup and native checks preserve alias configuration coherence: docs/design/src/007-tooling.md#6076a170de8e438c
// Chapter 007 / actual setup and native checks preserve alias configuration coherence: docs/design/src/007-tooling.md#0937ee616d12e256
// Chapter 007 / actual setup and native checks preserve alias configuration coherence: docs/design/src/007-tooling.md#dfea88aeb731cf9c
test("opencode-54: actual setup, alias migration and inverse native controls", () => inspect(corpus.input))
test("exact path alias names remain an independently keyed migration gap", () =>
  inspect({ ...corpus.input, kind: "exact", wire: false }))
test("alias/config coherence across wildcard and exact maps, nested and directory-index modules", async () => {
  await fc.assert(fc.asyncProperty(fc.record({
    kind: fc.constantFrom("wildcard", "exact"), wire: fc.boolean(),
    prefix: fc.constantFrom("@/", "~/", "#app/"), depth: fc.integer({ min: 0, max: 2 }), index: fc.boolean()
  }), inspect), { seed: 541101, numRuns: 12 })
})
