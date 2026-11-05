import assert from "node:assert/strict"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { applyState, prepareState } from "../lib/codemod-state.mjs"
import { pathAliases, renameBatch, restoreExports, restoreScripts, restoreSpecifiers, rewriteExports, rewriteImports, rewriteScripts, vibePath } from "../lib/codemod.mjs"
import { candidates, validatePlan } from "../lib/plan.mjs"
import { sidecarPath, sidecarSettings } from "../lib/sidecar-config.mjs"
import { batchSidecarLocator, makeConfig, paths, revert } from "../lib/steps.mjs"
import { must, writeJson } from "../lib/util.mjs"
import * as Jj from "../lib/jj.mjs"
import { apiProjection } from "../lib/api-projection.mjs"
import { publishedEntrypoints } from "../lib/api-identity.mjs"
import { convertedIn, shapeOf } from "../lib/source-digest.mjs"
import { planScope } from "../lib/onepass.mjs"

const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const ts = require("typescript")
const fc = require("fast-check")
const corpus = JSON.parse(readFileSync(new URL("./corpus/opencode-card-tsx.json", import.meta.url), "utf8"))
const put = (root, path, text) => { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), text) }
const record = path => ({ path, effect: "values", test: false, imports: [], testedBy: [], coverage: null, lines: 1 })

// VIP-39: Renaming x.tsx to x.vibex changes nothing in its JSX.
test("JSX sources enter both batch and whole-scope plans as vibex", () => {
  assert.ok(readFileSync(new URL("../../../../docs/design/vips/0039-vibex.md", import.meta.url), "utf8").includes(corpus.quote))
  const root = mkdtempSync(join(tmpdir(), "migrate-vibex-plan-"))
  try {
    put(root, "Card.tsx", 'export const Card = () => <div />\n')
    const inventory = { files: [record("Card.tsx")] }
    assert.equal(vibePath("Card.tsx"), "Card.vibex")
    assert.deepEqual(candidates(inventory).map(f => f.path), ["Card.tsx"])
    assert.deepEqual(validatePlan({ batches: [{ files: ["Card.tsx"], reason: "JSX component" }] }, inventory).errors, [])
    assert.deepEqual(planScope(root, ["Card.tsx"]).batches[0].files, ["Card.tsx"])
    for (const ext of [".cts", ".jsx", ".d.ts", ".d.mts", ".d.cts", ".d.vibex.ts"]) {
      assert.throws(() => vibePath("Card" + ext), /declaration|unsupported|only/)
    }
    put(root, "view.config.tsx", "export default {}\n")
    assert.equal(candidates({ files: [record("view.config.tsx")] }).length, 0)
    assert.match(planScope(root, ["Card.tsx", "view.config.tsx"]).deferred[0].reason, /tool config/)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test("TSX rename, imports, package entries and restoration follow generated file names", () => {
  const stem = fc.oneof(fc.stringMatching(/^[A-Za-z][A-Za-z0-9_-]{0,10}$/), fc.constantFrom("with space", "café", "Card.story"))
  fc.assert(fc.property(stem, fc.constantFrom("", "views/", "views/nested/"), fc.constantFrom("", ".js", ".tsx"), fc.boolean(), (name, dir, spelling, durable) => {
    const root = mkdtempSync(join(tmpdir(), "migrate-vibex-route-"))
    try {
      const from = dir + name + ".tsx", to = dir + name + ".vibex"
      const original = 'export const Card = () => <div title="x" />\n'
      const specifier = "./" + dir + name + spelling
      const importer = 'export { Card } from ' + JSON.stringify(specifier) + '\n'
      const manifest = { type: "module", exports: { ".": "./" + from }, scripts: { render: "node " + JSON.stringify(from) } }
      put(root, from, original)
      put(root, "consumer.tsx", importer)
      put(root, "package.json", JSON.stringify(manifest))
      let renames, exportEdits, importEdits, packageScriptEdits
      if (durable) {
        const state = prepareState(root, [from, "consumer.tsx"], [from, "consumer.tsx"])
        applyState(root, state)
        applyState(root, state)
        ;({ renames, exportEdits, importEdits, packageScriptEdits } = state)
      } else {
        renames = renameBatch(root, [from, "consumer.tsx"])
        exportEdits = rewriteExports(root, renames)
        packageScriptEdits = rewriteScripts(root, renames)
        importEdits = rewriteImports(root, [to, "consumer.vibex"], renames.map(r => r.to))
      }
      assert.equal(existsSync(join(root, from)), false)
      assert.equal(readFileSync(join(root, to), "utf8"), original)
      assert.equal(readFileSync(join(root, "consumer.vibex"), "utf8"), 'export { Card } from "./' + dir + name + '.vibex"\n')
      const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"))
      assert.equal(pkg.exports["."]["vibelang-source"], "./" + to)
      assert.equal(pkg.exports["."].types, "./" + dir + name + ".d.vibex.ts")
      assert.equal(pkg.exports["."].default, "./.vibelang/js/" + dir + name + ".js")
      renameSync(join(root, to), join(root, from))
      renameSync(join(root, "consumer.vibex"), join(root, "consumer.tsx"))
      restoreSpecifiers(root, importEdits, from)
      restoreExports(root, exportEdits, from)
      restoreScripts(root, packageScriptEdits, from)
      assert.equal(readFileSync(join(root, "consumer.tsx"), "utf8"), importer)
      assert.deepEqual(JSON.parse(readFileSync(join(root, "package.json"), "utf8")), manifest)
    } finally { rmSync(root, { recursive: true, force: true }) }
  }), { seed: 390039, numRuns: 90 })
})

test("vibex imports follow aliases and JSX emission policy", () => {
  const root = mkdtempSync(join(tmpdir(), "migrate-vibex-alias-"))
  try {
    for (const jsx of ["react-jsx", "preserve"]) {
      put(root, "tsconfig.json", JSON.stringify({ compilerOptions: { jsx, paths: { "@card": ["./Card.tsx"] } } }))
      for (const extension of ["", ".js", ".tsx"]) {
        put(root, "Card.vibex", "export const value = 1\n")
        put(root, "consumer.vibex", 'export { value } from "./Card' + extension + '"\n')
        rewriteImports(root, ["Card.vibex", "consumer.vibex"], ["Card.vibex"], pathAliases(ts, root))
        assert.match(readFileSync(join(root, "consumer.vibex"), "utf8"), new RegExp('Card\\' + (jsx === "preserve" ? ".jsx" : ".js")))
      }
      put(root, "consumer.vibex", 'export { value } from "@card"\n')
      rewriteImports(root, ["Card.vibex", "consumer.vibex"], ["Card.vibex"], pathAliases(ts, root))
      assert.equal(readFileSync(join(root, "consumer.vibex"), "utf8"), 'export { value } from "./Card' + (jsx === "preserve" ? ".jsx" : ".js") + '"\n')
    }
  } finally { rmSync(root, { recursive: true, force: true }) }
})


test("configured declaration sidecars preserve JSX source identity", () => {
  const root = mkdtempSync(join(tmpdir(), "migrate-vibex-sidecar-"))
  try {
    put(root, "tsconfig.json", JSON.stringify({ compilerOptions: { jsx: "preserve", rootDir: "src", rewriteRelativeImportExtensions: true }, vibe: { sidecarDir: "types" }, include: ["src/**/*"] }))
    put(root, "src/Card.tsx", "export const Card = () => <div />\n")
    put(root, "package.json", '{"type":"module","exports":{".":"./src/Card.tsx"}}')
    const renames = renameBatch(root, ["src/Card.tsx"])
    const edits = rewriteExports(root, renames)
    assert.deepEqual(JSON.parse(readFileSync(join(root, "package.json"), "utf8")).exports["."], {
      types: "./types/Card.d.vibex.ts", "vibelang-source": "./src/Card.vibex", default: "./.vibelang/js/src/Card.jsx"
    })
    const locate = batchSidecarLocator({ target: root, packages: [{ dir: "." }] })
    assert.equal(locate("src/Card.tsx"), "types/Card.d.vibex.ts")
    assert.equal(locate("src/Card.vibex"), "types/Card.d.vibex.ts")
    assert.equal(locate("types/Card.d.vibex.ts"), null)
    const settings = sidecarSettings(join(root, "tsconfig.json"), ts)
    assert.equal(sidecarPath(join(root, "src/Card.vibex"), settings), join(root, "types/Card.d.vibex.ts"))
    restoreExports(root, edits, "src/Card.tsx")
    assert.equal(JSON.parse(readFileSync(join(root, "package.json"), "utf8")).exports["."], "./src/Card.tsx")
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test("revert restores the TSX module, authored imports and package entry", async () => {
  const root = mkdtempSync(join(tmpdir(), "migrate-vibex-revert-"))
  const target = join(root, "repo"), run = join(root, "run")
  try {
    mkdirSync(target)
    await must("jj git init && jj config set --repo user.name test && jj config set --repo user.email test@localhost", { cwd: target })
    const original = "export const Card = () => <div />\n"
    put(target, "tsconfig.json", JSON.stringify({ compilerOptions: { jsx: "react-jsx" }, include: ["*.tsx", "*.vibex"] }))
    put(target, "Card.tsx", original)
    put(target, "consumer.tsx", 'export { Card } from "./Card.js"\n')
    put(target, "package.json", '{"type":"module","exports":{".":"./Card.tsx"}}')
    mkdirSync(join(target, "node_modules"))
    symlinkSync(dirname(require.resolve("typescript/package.json")), join(target, "node_modules/typescript"), "dir")
    await Jj.commit(target, "fixture")
    writeJson(paths(run).config, makeConfig({ target, test: "true", vibelangVersion: "0.0.11" }))
    writeJson(paths(run).plan, { batches: [{ files: ["Card.tsx", "consumer.tsx"] }] })
    const state = prepareState(target, ["Card.tsx", "consumer.tsx"], ["Card.tsx", "consumer.tsx"])
    applyState(target, state)
    writeJson(paths(run).codemodState("01"), state)
    put(target, "Card.d.vibex.ts", "export declare const Card: () => unknown;\n")
    const result = await revert({ run, batch: "01", file: "Card.vibex", reason: "verify JSX restoration" })
    assert.equal(result.file, "Card.tsx")
    assert.equal(readFileSync(join(target, "Card.tsx"), "utf8"), original)
    assert.equal(readFileSync(join(target, "consumer.vibex"), "utf8"), 'export { Card } from "./Card.js"\n')
    assert.equal(JSON.parse(readFileSync(join(target, "package.json"), "utf8")).exports["."], "./Card.tsx")
    assert.equal(existsSync(join(target, "Card.d.vibex.ts")), false)
  } finally { rmSync(root, { recursive: true, force: true }) }
})


test("TSX source provenance is required for JSX renames", () => {
  fc.assert(fc.property(fc.stringMatching(/^[A-Za-z][A-Za-z0-9_-]{0,12}$/), name => {
    const from = "src/" + name + ".tsx", to = "src/" + name + ".vibex"
    for (const entries of [
      [{ status: "D", path: from }, { status: "A", path: to }],
      [{ status: "R", from, path: to }]
    ]) assert.deepEqual(convertedIn(entries), [from])
    assert.deepEqual(convertedIn([{ status: "D", path: from }, { status: "A", path: "src/" + name + ".vibe" }]), [])
    const source = extension => 'export { Card } from "./' + name + extension + '"'
    assert.equal(shapeOf(source(".tsx")), shapeOf(source(".vibex")))
    assert.notEqual(shapeOf(source(".tsx")), shapeOf(source("changed.vibex")))
  }), { seed: 390040, numRuns: 100 })
})

test("API snapshot aliases resolve JSX source entries to exactly one sidecar", () => {
  for (const [source, native] of [[".ts", ".vibe"], [".tsx", ".vibex"]]) {
    const root = mkdtempSync(join(tmpdir(), "migrate-jsx-api-"))
    let projection
    try {
      put(root, "snapshot/Card.d.ts", "export declare const Card: () => string;\n")
      const metadata = {
        packageDir: root, manifest: { name: "jsx-api-fixture", type: "module", exports: { ".": "./Card" + native } },
        aliases: { ["Card" + source]: "Card.d.ts", ["Card" + native]: "Card.d.ts", ["Card.d" + native + ".ts"]: "Card.d.ts" },
        logicalPaths: { "Card.d.ts": "dist/Card.d.ts" }
      }
      projection = apiProjection(ts, join(root, "snapshot"), { apiMetadata: metadata }, ["Card.d.ts"])
      const sidecar = join(projection.directory, "Card.d" + native + ".ts")
      assert.equal(existsSync(sidecar), true)
      assert.equal(existsSync(join(projection.directory, "Card.d" + native + ".d.ts")), false)
      assert.deepEqual(publishedEntrypoints(projection.directory, ts), { ".": sidecar })
    } finally { projection?.cleanup(); rmSync(root, { recursive: true, force: true }) }
  }
})

// VIP-39: Renaming x.tsx to x.vibex changes nothing in its JSX.
test("import-shaped text in JSX and template literals survives rewrite and restoration", () => {
  const spelling = fc.constantFrom("", ".js", ".tsx")
  fc.assert(fc.property(spelling, spelling, spelling, fc.boolean(), (inText, inAttribute, inTemplate, resolved) => {
    const root = mkdtempSync(join(tmpdir(), "migrate-vibex-text-"))
    try {
      const text = (spec, written = "./Card") => 'import c from "' + written + spec + '"'
      const consumer = [
        'import { Card } from "./Card"',
        "export const View = () => <pre title='" + text(inAttribute) + "'>",
        text(inText),
        'export { Card } from "./Card' + inText + '"',
        "</pre>",
        "export const Shown = () => <b>from \"./Card" + inText + "\"</b>",
        "export const sample = `",
        text(inTemplate),
        "`",
        "export const card = Card",
        ""
      ].join("\n")
      put(root, "tsconfig.json", JSON.stringify({ compilerOptions: { jsx: "react-jsx", module: "esnext", moduleResolution: "bundler" } }))
      put(root, "Card.tsx", "export const Card = () => <div />\n")
      put(root, "consumer.tsx", consumer)
      const renames = renameBatch(root, ["Card.tsx", "consumer.tsx"])
      const aliases = resolved ? pathAliases(ts, root) : undefined
      const moved = renames.map(rename => rename.to)
      const edits = rewriteImports(root, moved, moved, aliases)
      const rewritten = readFileSync(join(root, "consumer.vibex"), "utf8")
      assert.deepEqual(edits.map(edit => edit.from), ["./Card"], rewritten)
      assert.equal(rewritten, consumer.replace('import { Card } from "./Card"', 'import { Card } from "' + edits[0].to + '"'))
      for (const rename of renames) renameSync(join(root, rename.to), join(root, rename.from))
      for (const rename of renames) restoreSpecifiers(root, edits, rename.from, aliases)
      assert.equal(readFileSync(join(root, "consumer.tsx"), "utf8"), consumer)
    } finally { rmSync(root, { recursive: true, force: true }) }
  }), { seed: 390041, numRuns: 40 })
})
