// vibelang/metro: a real Metro bundle of an app that imports a .vibe module.
import { strict as assert } from "node:assert"
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { createRequire, SourceMap } from "node:module"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { setTimeout as delay } from "node:timers/promises"
import { runInNewContext } from "node:vm"
import { compilerPackage, documentedConfigs, project, tools } from "./helpers.mjs"

const require = createRequire(import.meta.url)
const Metro = require("metro")
const Server = require("metro/private/Server").default
const { getDefaultConfig, loadConfig, mergeConfig } = require("metro-config")
const { FileStore } = require("metro-cache")
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

const linked = ["metro", "metro-config", "metro-runtime", "metro-transform-worker", "metro-babel-transformer"]

// Metro's config for root, without a cache unless cacheStores names one,
// through the app transformer at babelTransformerPath.
async function metroConfig(root, { cacheStores = [], babelTransformerPath } = {}) {
  return mergeConfig(await getDefaultConfig(root), {
    projectRoot: root,
    // Metro and its runtime are installed beside the test, outside the app.
    watchFolders: [root, realpathSync(tools)],
    cacheStores,
    resetCache: cacheStores.length === 0,
    maxWorkers: 2,
    reporter: { update() {} },
    transformer: {
      ...(babelTransformerPath && { babelTransformerPath }),
      getTransformOptions: async () => ({ transform: { experimentalImportSupport: true, inlineRequires: false } })
    }
  })
}

// Metro's production bundle of root's index.js.
async function build(root, wrap, options) {
  const config = wrap(await metroConfig(root, options))
  const { code, map } = await Metro.runBuild(await config, { entry: "./index.js", dev: false, minify: false, platform: "ios", sourceMap: true })
  return { code, map: JSON.parse(map) }
}

async function bundle(t, wrap, files = {
  "src/greet.vibe": greet,
  "index.js": 'import { greet } from "./src/greet.vibe"\nglobalThis.result = greet("metro")\n'
}, options) {
  return build(project(t, files, linked), wrap, options)
}

// An app transformer that lists the filename of each module it transforms in
// the file VIBELANG_TEST_TRANSFORMED names. Metro's workers inherit it.
const recordingTransformer = `const upstream = require("metro-babel-transformer")
module.exports = { ...upstream, transform(args) {
  require("node:fs").appendFileSync(process.env.VIBELANG_TEST_TRANSFORMED, args.filename + "\\n")
  return upstream.transform(args)
} }
`

// The bundle's result, copied out of the bundle's realm.
const run = (code) => {
  const context = {}
  runInNewContext(code, Object.assign(context, { globalThis: context }))
  return Array.isArray(context.result) ? [...context.result] : context.result
}

test("Metro bundles a .vibe module through the app's transformer", async (t) => {
  const { code } = await bundle(t, withVibeLang)
  assert.equal(run(code), "metro-marker:metro")
})

test("Metro bundles a .vibex module and its relative imports", async (t) => {
  const { code } = await bundle(t, withVibeLang, {
    "src/greet.vibex": greet,
    "src/use.vibe": 'import { greet } from "./greet.vibex"\n\nexport const name: string = greet("metro")\n',
    "index.js": 'import { name } from "./src/use.vibe"\nglobalThis.result = name\n'
  })
  assert.equal(run(code), "metro-marker:metro")
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
  assert.equal(run(code), "import")
})

test("a .vibe module's relative imports reach the sources beside it", async (t) => {
  const { code } = await bundle(t, withVibeLang, {
    "src/helper.ts": 'export const ts = "ts"\n',
    "src/other.vibe": 'export const vibe: string = "vibe"\n',
    "src/use.vibe": `import { ts } from "./helper.ts"
import { vibe } from "./other.vibe"

export const name: string = ts + ":" + vibe
`,
    "index.js": 'import { name } from "./src/use.vibe"\nglobalThis.result = name\n'
  })
  assert.equal(run(code), "ts:vibe")
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

// VIP-40: a module body compiles to a module of its own beside its file's,
// with-body.vibe.words.js for `module words`, which is not on disk.
const withBody = `module words {
  import { suffix } from "./suffix.ts"

  export function label(): string {
    return "from a module body" + suffix
  }
}

import { label } from words

export const message: string = label()
`
const bodyMarkerLine = 5

test("Metro bundles a module body, and the body's own imports resolve beside its file (VIP-40)", async (t) => {
  const root = project(t, {
    "src/suffix.ts": 'export const suffix = "!"\n',
    "src/with-body.vibe": withBody,
    "transformer.cjs": recordingTransformer,
    "index.js": 'import { message } from "./src/with-body.vibe"\nglobalThis.result = message\n'
  }, linked)
  process.env.VIBELANG_TEST_TRANSFORMED = join(root, "transformed.txt")
  t.after(() => delete process.env.VIBELANG_TEST_TRANSFORMED)
  const { code, map } = await build(root, withVibeLang, { babelTransformerPath: join(root, "transformer.cjs") })
  assert.equal(run(code), "from a module body!")
  // The app's transformer reads the body as the file it compiles to, beside
  // its .vibe file, as it would read a sibling .ts file.
  const transformed = readFileSync(join(root, "transformed.txt"), "utf8").split("\n").filter((name) => name.startsWith("src/")).sort()
  assert.deepEqual(transformed, ["src/suffix.ts", "src/with-body.vibe", "src/with-body.vibe.words.js"])
  // The body's positions are its .vibe file's lines, beside that file's text.
  const at = code.indexOf('"from a module body"')
  const before = code.slice(0, at).split("\n")
  const entry = new SourceMap(map).findEntry(before.length - 1, before.at(-1).length)
  assert.match(entry.originalSource, /src\/with-body\.vibe\.words\.js$/)
  assert.equal(entry.originalLine + 1, bodyMarkerLine)
  const section = map.sections.find(({ map }) => map.sources.includes(entry.originalSource)).map
  assert.equal(section.sourcesContent[section.sources.indexOf(entry.originalSource)], withBody)
  // The body is the app's code, as a sibling .ts file would be, not a dependency's.
  assert.deepEqual(section.x_google_ignoreList ?? [], [])
})

test("another module that imports a body's exports through its file shares the one body (VIP-40)", async (t) => {
  const { code } = await bundle(t, withVibeLang, {
    "src/counter.vibe": `module counter {
  export let count = 0

  export function bump(): number {
    count += 1
    return count
  }
}

export { bump, count } from counter
`,
    "src/use.vibe": 'import { bump } from "./counter.vibe"\n\nexport const first: number = bump()\n',
    "index.js": 'import { first } from "./src/use.vibe"\nimport { bump } from "./src/counter.vibe"\nglobalThis.result = [first, bump()]\n'
  })
  // The body evaluates once: both importers bump one count.
  assert.deepEqual(run(code), [1, 2])
})

test("Metro bundles a module body of a .vibex module (VIP-40)", async (t) => {
  const { code } = await bundle(t, withVibeLang, {
    "src/view.vibex": 'module view {\n  export const label = "from a .vibex body"\n}\n\nimport { label } from view\n\nexport const text: string = label\n',
    "index.js": 'import { text } from "./src/view.vibex"\nglobalThis.result = text\n'
  })
  assert.equal(run(code), "from a .vibex body")
})

// rule-evidence: docs/design/vips/0040-module-declarations.md#f7120f477684687d
const bodyRule = "**Loaders and bundlers.** `vibelang/register`, the Bun plugin, Vite and unplugin serve each body's canonical filename from the compiled parent, using the same source basename, encoded name and output suffix as the compiler, cached by the parent's version."

test("Metro bundles each body under the compiler's canonical filename, cached by the parent's version (VIP-40)", async (t) => {
  assert.ok(bodyRule.includes("canonical filename"))
  // Names that keep, encode or mix characters: Text -> -54-ext, Über -> -dc-ber, $x -> -24-x.
  const parent = (n) => [
    `module Über { export const n = ${n} }`,
    "module $x { export const n = 2 }",
    "module Text { export const n = 3 }",
    "module snake_case9 { export const n = 4 }",
    "import { n as a } from Über",
    "import { n as b } from $x",
    "import { n as c } from Text",
    "import { n as d } from snake_case9",
    "export const all: number[] = [a, b, c, d]",
    ""
  ].join("\n")
  const root = project(t, {
    "src/names.vibe": parent(1),
    "index.js": 'import { all } from "./src/names.vibe"\nglobalThis.result = all\n'
  }, linked)
  const cacheStores = [new FileStore({ root: join(root, ".metro-cache") })]
  const bodies = (map) => map.sections.map(({ map }) => map.sources[0].split("/").at(-1)).filter((name) => name.startsWith("names.vibe.")).sort()
  const first = await build(root, withVibeLang, { cacheStores })
  assert.deepEqual(run(first.code), [1, 2, 3, 4])
  assert.deepEqual(bodies(first.map), ["names.vibe.-24-x.js", "names.vibe.-54-ext.js", "names.vibe.-dc-ber.js", "names.vibe.snake_case9.js"])
  writeFileSync(join(root, "src/names.vibe"), parent(10))
  assert.deepEqual(run((await build(root, withVibeLang, { cacheStores })).code), [10, 2, 3, 4])
})

test("a watching Metro serves the body of a file's earlier, cached text when the file returns to it (VIP-40)", async (t) => {
  const parent = (n) => `module words {\n  export const n = ${n}\n}\n\nimport { n as fromBody } from words\n\nexport const pair: number[] = [${n}, fromBody]\n`
  const root = project(t, {
    "src/pair.vibe": parent(1),
    "index.js": 'import { pair } from "./src/pair.vibe"\nglobalThis.result = pair\n'
  }, linked)
  const config = withVibeLang(mergeConfig(await metroConfig(root, { cacheStores: [new FileStore({ root: join(root, ".metro-cache") })] }), {
    resolver: { useWatchman: false }
  }))
  const server = await Metro.runMetro(config, { watch: true })
  t.after(() => server.end())
  const request = { ...Server.DEFAULT_BUNDLE_OPTIONS, bundleType: "bundle", entryFile: "./index.js", dev: false, minify: false, platform: "ios" }
  // Builds until the bundle gives `expected`: the watcher reports an edit, and
  // a stand-in the edit rewrites, a moment after the write.
  const settles = async (expected) => {
    let result
    for (const end = Date.now() + 30_000; Date.now() < end; await delay(250)) {
      result = run((await server.build(request)).code)
      if (JSON.stringify(result) === JSON.stringify(expected)) return
    }
    assert.deepEqual(result, expected)
  }
  await settles([1, 1])
  writeFileSync(join(root, "src/pair.vibe"), parent(2))
  await settles([2, 2])
  // An undo: Metro's cache holds the file's transform for this text, so no
  // transform runs for it, and its body still follows it.
  writeFileSync(join(root, "src/pair.vibe"), parent(1))
  await settles([1, 1])
})

test("a body Metro did not see when it started fails with its stand-in written, and bundles after a restart (VIP-40)", async (t) => {
  const root = project(t, { "index.js": 'import { message } from "./src/with-body.vibe"\nglobalThis.result = message\n' }, linked)
  // The module appears after withVibeLang wrote the stand-ins and before Metro's file map is built.
  const late = (config) => {
    const wrapped = withVibeLang(config)
    mkdirSync(join(root, "src"))
    writeFileSync(join(root, "src/suffix.ts"), 'export const suffix = "!"\n')
    writeFileSync(join(root, "src/with-body.vibe"), withBody)
    return wrapped
  }
  await assert.rejects(build(root, late), /with-body\.vibe\.words\.js in .*with-body\.vibe is a module declaration of .* that Metro did not see when it started\. Its stand-in .* is now written; restart Metro\./)
  assert.equal(run((await build(root, withVibeLang)).code), "from a module body!")
})

test("withVibeLang keeps the app's transformer and config, and accepts a promise", async (t) => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "vibelang-metro-config-")))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const config = await withVibeLang(Promise.resolve({
    projectRoot: root,
    resolver: { sourceExts: ["ts", "js"], extraNodeModules: { a: "b" } },
    transformer: { babelTransformerPath: "/app/transformer.js", minifierPath: "m" }
  }))
  const { resolveRequest, ...resolver } = config.resolver
  assert.equal(typeof resolveRequest, "function")
  assert.deepEqual(resolver, { sourceExts: ["ts", "js", "vibe", "vibex"], extraNodeModules: { a: "b" } })
  assert.equal(config.transformer.babelTransformerPath, join(compilerPackage, "metro.cjs"))
  assert.equal(config.transformer.minifierPath, "m")
  assert.equal(process.env.VIBELANG_METRO_TRANSFORMER, "/app/transformer.js")
  assert.deepEqual((await withVibeLang(config)).resolver.sourceExts, ["ts", "js", "vibe", "vibex"])
  assert.equal(process.env.VIBELANG_METRO_TRANSFORMER, "/app/transformer.js")
})

// A VibeLang app's package.json has "type": "module"
// (docs/user/src/setup/existing-project.md), so the CommonJS config these
// pages show loads only under a .cjs name.
for (const page of ["packages/compiler/README.md", "docs/user/src/setup/react-native.md"]) {
  test(`${page}: the documented Metro config loads in a "type": "module" app`, async (t) => {
    const configs = documentedConfigs(page, "metro.config")
    assert.equal(configs.length, 1)
    const [{ name, text }] = configs
    const root = project(t, {
      "package.json": '{"name":"app","private":true,"type":"module"}',
      [name]: text,
      // The guide's Expo import; Expo's getDefaultConfig wraps Metro's own.
      "node_modules/expo/package.json": '{"name":"expo","version":"0.0.0"}',
      "node_modules/expo/metro-config.js": 'module.exports = { getDefaultConfig: root => require("metro-config").getDefaultConfig(root) }\n'
    }, ["metro", "metro-config", "metro-runtime", "metro-transform-worker", "metro-babel-transformer"])
    const config = await loadConfig({ cwd: root })
    assert.ok(config.resolver.sourceExts.includes("vibe"), String(config.resolver.sourceExts))
    assert.equal(config.transformer.babelTransformerPath, join(compilerPackage, "metro.cjs"))
  })
}
