// vibelang/metro: a real Metro bundle of an app that imports a .vibe module.
import { strict as assert } from "node:assert"
import { realpathSync } from "node:fs"
import { createRequire, SourceMap } from "node:module"
import { join } from "node:path"
import { test } from "node:test"
import { runInNewContext } from "node:vm"
import { compilerPackage, project, tools } from "./helpers.mjs"

const require = createRequire(import.meta.url)
const Metro = require("metro")
const { getDefaultConfig, mergeConfig } = require("metro-config")
const { withVibeLang } = require(join(compilerPackage, "metro.cjs"))

// The types erase, so the marker's line in the emitted JavaScript (1) is not
// its line in the source (7).
const greet = `type Name = string

interface Greeting {
  readonly to: Name
}

export const marker = "metro-marker"

export function greet(name: Name): string {
  return marker + ":" + name
}
`
const markerLine = 7

async function bundle(t, wrap, files = {
  "src/greet.vibe": greet,
  "index.js": 'import { greet } from "./src/greet.vibe"\nglobalThis.result = greet("metro")\n'
}) {
  const root = project(t, files, ["metro", "metro-config", "metro-runtime", "metro-transform-worker", "metro-babel-transformer"])
  const config = wrap(mergeConfig(await getDefaultConfig(root), {
    projectRoot: root,
    // Metro and its runtime are installed beside the test, outside the app.
    watchFolders: [root, realpathSync(tools)],
    cacheStores: [],
    resetCache: true,
    maxWorkers: 2,
    reporter: { update() {} },
    transformer: { getTransformOptions: async () => ({ transform: { experimentalImportSupport: true, inlineRequires: false } }) }
  }))
  const { code, map } = await Metro.runBuild(await config, { entry: "./index.js", dev: false, minify: false, platform: "ios", sourceMap: true })
  return { code, map: JSON.parse(map) }
}

test("Metro bundles a .vibe module through the app's transformer", async (t) => {
  const { code } = await bundle(t, withVibeLang)
  const context = {}
  runInNewContext(code, Object.assign(context, { globalThis: context }))
  assert.equal(context.result, "metro-marker:metro")
})

// t3code's @t3tools/contracts has only an `import` condition.
test("a .vibe module's import takes a package's import condition", async (t) => {
  const { code } = await bundle(t, withVibeLang, {
    "node_modules/dep/package.json": JSON.stringify({ name: "dep", exports: { ".": { types: "./index.d.ts", import: "./import.js" } } }),
    "node_modules/dep/index.d.ts": "export declare const condition: string\n",
    "node_modules/dep/import.js": 'export const condition = "import"\n',
    "src/use.vibe": `type Name = string

import { condition } from "dep"

export const name: Name = condition
`,
    "index.js": 'import { name } from "./src/use.vibe"\nglobalThis.result = name\n'
  })
  const context = {}
  runInNewContext(code, Object.assign(context, { globalThis: context }))
  assert.equal(context.result, "import")
})

test("the bundle's source map names the .vibe module's lines", async (t) => {
  const { code, map } = await bundle(t, withVibeLang)
  const at = code.indexOf('"metro-marker"')
  assert.notEqual(at, -1)
  const before = code.slice(0, at).split("\n")
  const entry = new SourceMap(map).findEntry(before.length - 1, before.at(-1).length)
  assert.match(entry.originalSource, /src\/greet\.vibe$/)
  assert.equal(entry.originalLine + 1, markerLine)
  // Metro writes an indexed map, one section per module.
  const section = map.sections.find(({ map }) => map.sources.includes(entry.originalSource)).map
  assert.equal(section.sourcesContent[section.sources.indexOf(entry.originalSource)], greet)
})

test("withVibeLang keeps the app's transformer and config, and accepts a promise", async () => {
  const config = await withVibeLang(Promise.resolve({
    projectRoot: compilerPackage,
    resolver: { sourceExts: ["ts", "js"], extraNodeModules: { a: "b" } },
    transformer: { babelTransformerPath: "/app/transformer.js", minifierPath: "m" }
  }))
  assert.deepEqual(config.resolver, { sourceExts: ["ts", "js", "vibe"], extraNodeModules: { a: "b" } })
  assert.equal(config.transformer.babelTransformerPath, join(compilerPackage, "metro.cjs"))
  assert.equal(config.transformer.minifierPath, "m")
  assert.equal(process.env.VIBELANG_METRO_TRANSFORMER, "/app/transformer.js")
  assert.deepEqual((await withVibeLang(config)).resolver.sourceExts, ["ts", "js", "vibe"])
  assert.equal(process.env.VIBELANG_METRO_TRANSFORMER, "/app/transformer.js")
})
