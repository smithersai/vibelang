import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { wireNewPackages, wireTarget } from "../lib/steps.mjs"

const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const ts = require("typescript"), fc = require("fast-check")
const chapter = readFileSync(new URL("../../../../docs/design/src/007-tooling.md", import.meta.url), "utf8")
// VIP-30: native compiler options keep TypeScript's meanings, including defaults and inheritance.
const quote = "An `extends` array merges bases left to right, later entries winning, before applying the child, as in TypeScript."
const corpus = JSON.parse(readFileSync(new URL("./corpus/setup-native-rewrite-option.json", import.meta.url), "utf8"))
const option = flag => flag === undefined ? {} : { rewriteRelativeImportExtensions: flag }

async function exercise({ flags, array = false, solution = false, newPackage = false, indent = 2, comments = false, stockTwin = false }) {
  const root = mkdtempSync(join(tmpdir(), "setup-native-rewrite-"))
  const put = (name, value) => {
    mkdirSync(dirname(join(root, name)), { recursive: true })
    writeFileSync(join(root, name), typeof value === "string" ? value : JSON.stringify(value, null, indent))
  }
  const parse = name => {
    const result = ts.getParsedCommandLineOfConfigFile(join(root, name), {}, {
      ...ts.sys, onUnRecoverableConfigFileDiagnostic(d) { assert.fail(ts.flattenDiagnosticMessageText(d.messageText, "\n")) }
    })
    assert.deepEqual(result.errors, [])
    return result.options.rewriteRelativeImportExtensions
  }
  try {
    mkdirSync(join(root, "node_modules"))
    symlinkSync(dirname(require.resolve("typescript/package.json")), join(root, "node_modules/typescript"))
    put("package.json", { name: "fixture", private: true })
    put("src/main.ts", 'import { value } from "./kept.js"; export { value };\n')
    put("src/kept.ts", "export const value = 1;\n")
    const bases = flags.slice(0, -1).map((flag, i) => {
      const name = `configs/base-${i}.json`
      put(name, { ...(!array && i ? { extends: `./base-${i - 1}.json` } : {}), compilerOptions: option(flag) })
      return "./" + name
    })
    const project = solution ? "tsconfig.src.json" : "tsconfig.json"
    const config = {
      ...(bases.length ? { extends: array ? bases : bases.at(-1) } : {}),
      compilerOptions: { module: "Preserve", moduleResolution: "Bundler", types: [], noEmit: true, ...option(flags.at(-1)) },
      include: ["src/**/*.ts"]
    }
    put(project, (comments ? "// keep authored compiler options\n" : "") + JSON.stringify(config, null, indent))
    if (solution) put("tsconfig.json", { files: [], references: [{ path: "./" + project }] })
    const stock = () => {
      const result = spawnSync(process.execPath, [require.resolve("typescript/bin/tsc"), "-p", project, "--showConfig"], { cwd: root, encoding: "utf8" })
      assert.equal(result.status, 0, result.stdout + result.stderr)
      const shown = JSON.parse(result.stdout)
      assert.ok(shown.files.some(file => file.endsWith("/main.ts")), "stock tsc checks the TypeScript twin")
      return shown.compilerOptions.rewriteRelativeImportExtensions
    }
    const before = parse(project)
    if (stockTwin) assert.equal(stock(), false, "tsc 5.9.3 --showConfig: inherited false before setup")
    // Independently model TypeScript's rightmost-present override, including absent.
    assert.equal(before, flags.filter(flag => flag !== undefined).at(-1))
    const basesBefore = bases.map(name => readFileSync(join(root, name), "utf8"))
    const cfg = {
      target: root, packages: [{ dir: ".", sources: ["src"], tsconfig: "tsconfig.json", dtsTsconfig: "tsconfig.json" }],
      toolchain: { kind: "npm", version: "0.0.11" }, install: "true", test: { command: "true", cwd: "." }
    }
    const wire = newPackage ? wireNewPackages : wireTarget
    if (newPackage) {
      put("wired/package.json", { dependencies: { "vibelang-runtime": "0.0.11" } })
      put("wired/tsconfig.json", { files: [] })
      cfg.packages.unshift({ dir: "wired", sources: ["src"], tsconfig: "tsconfig.json", dtsTsconfig: "tsconfig.json" })
    }
    const log = join(root, "logs")
    mkdirSync(log)
    const init = spawnSync("jj", ["git", "init", root], { encoding: "utf8" })
    assert.equal(init.status, 0, init.stderr)
    await wire(cfg, log)
    const after = readFileSync(join(root, project), "utf8")
    assert.equal(parse(project), before, "setup preserves the effective native option")
    if (stockTwin) assert.equal(stock(), false, "tsc 5.9.3 --showConfig: inherited false after setup")
    const written = ts.parseConfigFileTextToJson(project, after).config
    assert.deepEqual(option(written.compilerOptions?.rewriteRelativeImportExtensions), option(flags.at(-1)), "setup neither inserts nor changes an authored option")
    assert.ok(written.include.includes("src/**/*.vibe"), "exercise production wiring")
    assert.deepEqual(bases.map(name => readFileSync(join(root, name), "utf8")), basesBefore)
    if (comments) assert.ok(after.startsWith("// keep authored compiler options\n"))
    await wire(cfg, log)
    assert.equal(readFileSync(join(root, project), "utf8"), after, "replay preserves config bytes")
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

test("setup native rewrite oracle quotes VIP-30's inheritance rule", () => {
  assert.ok(chapter.includes(quote))
  assert.equal(ts.version, "5.9.3", "the stock TypeScript reference is pinned")
})

test("setup-native-rewrite-option: inherited false remains false", () => exercise({ ...corpus, stockTwin: true, flags: corpus.flags.map(flag => flag === null ? undefined : flag) }))

test("setup preserves native rewrite defaults and overrides through referenced and newly wired projects", async () => {
  for (const flag of [undefined, false, true]) for (const inherited of [false, true]) {
    await exercise({ flags: inherited ? [flag, undefined] : [flag] })
  }
  await fc.assert(fc.asyncProperty(fc.record({
    flags: fc.array(fc.constantFrom(undefined, false, true), { minLength: 1, maxLength: 5 }),
    array: fc.boolean(), solution: fc.boolean(), newPackage: fc.boolean(),
    indent: fc.constantFrom(0, 2, 4), comments: fc.boolean()
  }), exercise), { seed: 273027, numRuns: 100 })
})
