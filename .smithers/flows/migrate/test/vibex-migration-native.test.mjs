import assert from "node:assert/strict"
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { test } from "node:test"
import { fixToFixedPoint, renameBatch, rewriteImports } from "../lib/codemod.mjs"
import { compareDeclarations, recordDeclarationSurface } from "../lib/declarations.mjs"
import { quote, must } from "../lib/util.mjs"

const runtime = fileURLToPath(new URL("../../../../packages/runtime/", import.meta.url))
const require = createRequire(join(runtime, "package.json"))
const ts = require("typescript")
const reactRequire = createRequire(new URL("../../../../site/package.json", import.meta.url))
const compiler = process.env.VIBELANG_COMPILER ?? fileURLToPath(new URL("../../../../packages/compiler/native/vibelang", import.meta.url))
const corpus = JSON.parse(readFileSync(new URL("./corpus/opencode-card-tsx.json", import.meta.url)))

test("a TSX component with hooks, generics and an Effect value compiles identically and renders after migration", { skip: !existsSync(compiler) && "build the native compiler first" }, async () => {
  const directory = mkdtempSync(join(tmpdir(), "migrate-vibex-native-"))
  const root = join(directory, "repo"), before = join(directory, "before"), after = join(directory, "after")
  mkdirSync(root)
  try {
    const put = (file, text) => writeFileSync(join(root, file), text)
    mkdirSync(join(root, "node_modules/@types"), { recursive: true })
    for (const name of ["effect"]) symlinkSync(dirname(require.resolve(name + "/package.json")), join(root, "node_modules", name), "dir")
    symlinkSync(runtime, join(root, "node_modules/vibelang-runtime"), "dir")
    for (const name of ["react", "react-dom", "@types/react"]) symlinkSync(dirname(reactRequire.resolve(name + "/package.json")), join(root, "node_modules", name), "dir")
    put("package.json", JSON.stringify({ name: "jsx-component-fixture", type: "module", exports: { ".": "./Card.tsx" } }))
    put(corpus.file, corpus.source)
    const config = { compilerOptions: { target: "ES2022", module: "ESNext", moduleResolution: "bundler", jsx: "react-jsx", strict: true, skipLibCheck: true, types: [], declaration: true, rootDir: ".", outDir: "dist" }, vibe: { effectGlobals: false, effectModules: false }, files: [corpus.file] }
    put("tsconfig.json", JSON.stringify(config))
    await must(quote(compiler) + " -p tsconfig.json --pretty false --singleThreaded", { cwd: root })
    await must("node " + quote(require.resolve("typescript/bin/tsc")) + " -p tsconfig.json --outDir " + quote(join(directory, "stock")) + " --pretty false", { cwd: root })
    const originalJs = readFileSync(join(root, "dist/Card.js"), "utf8")
    assert.equal(readFileSync(join(directory, "stock/Card.js"), "utf8"), originalJs)
    cpSync(join(root, "dist"), before, { recursive: true })
    recordDeclarationSurface(ts, before, root, [{ tsconfig: "tsconfig.json", prefix: "." }])
    const renames = renameBatch(root, [corpus.file])
    assert.deepEqual(renames, [{ from: corpus.file, to: "Card.vibex" }])
    rewriteImports(root, ["Card.vibex"], ["Card.vibex"])
    config.files = ["Card.vibex"]
    put("tsconfig.json", JSON.stringify(config))
    const fixed = await fixToFixedPoint({ compiler, tsconfig: "tsconfig.json", cwd: root, root, only: ["Card.vibex"], log: join(root, "fix") })
    assert.equal(fixed.settled, true)
    assert.deepEqual(fixed.diagnostics.filter(d => d.category === "error"), [])
    assert.ok(fixed.rounds.every(r => r.code === 0))
    await must(quote(compiler) + " -p tsconfig.json --pretty false --singleThreaded", { cwd: root })
    assert.equal(readFileSync(join(root, "dist/Card.js"), "utf8"), originalJs)
    // The shared gate checks type and documentation identity, including the specified generated throws metadata.
    cpSync(join(root, "dist"), after, { recursive: true })
    recordDeclarationSurface(ts, after, root, [{ tsconfig: "tsconfig.json", prefix: "." }], { name: "jsx-component-fixture", type: "module", exports: { ".": "./Card.vibex" } })
    const comparison = compareDeclarations(ts, before, after)
    assert.equal(comparison.comparisonComplete, true, JSON.stringify(comparison))
    assert.equal(comparison.identical, true, JSON.stringify(comparison))
    const { createElement } = await import(pathToFileURL(reactRequire.resolve("react")).href)
    const { renderToStaticMarkup } = await import(pathToFileURL(reactRequire.resolve("react-dom/server")).href)
    const { Effect } = await import(pathToFileURL(require.resolve("effect")).href)
    mkdirSync(join(root, "render"))
    for (const dir of ["before", "after"]) {
      const file = join(root, "render", "Card-" + dir + ".js")
      writeFileSync(file, readFileSync(join(directory, dir, "Card.js")))
      const { Card, ready } = await import(pathToFileURL(file).href)
      assert.equal(renderToStaticMarkup(createElement(Card, { item: { name: "Ada" } })), '<button type="button">Ada: ready</button>')
      assert.equal(Effect.runSync(ready), "ready")
    }
    put("EffectCard.tsx", 'import { Effect } from "effect"\nexport const load = Effect.fn("load")(function* (name: string) { return yield* Effect.succeed(name) })\nexport const icon = <span />\n')
    renameBatch(root, ["EffectCard.tsx"])
    config.files = ["EffectCard.vibex"]
    put("tsconfig.json", JSON.stringify(config))
    const repaired = await fixToFixedPoint({ compiler, tsconfig: "tsconfig.json", cwd: root, root, only: ["EffectCard.vibex"], log: join(root, "effect-fix") })
    assert.equal(repaired.settled, true)
    assert.ok(repaired.rounds.some(round => round.fixes > 0), JSON.stringify(repaired))
    assert.ok(Object.hasOwn(repaired.byFile, "EffectCard.vibex"), JSON.stringify(repaired.byFile))
    assert.deepEqual(repaired.diagnostics.filter(d => d.category === "error"), [])
    assert.equal(readFileSync(join(root, "EffectCard.vibex"), "utf8").includes("Effect.fn"), false)
    const stable = await fixToFixedPoint({ compiler, tsconfig: "tsconfig.json", cwd: root, root, only: ["EffectCard.vibex"] })
    assert.equal(stable.rounds.length, 1)
    assert.equal(stable.rounds[0].fixes, 0)
  } finally { rmSync(directory, { recursive: true, force: true }) }
})

