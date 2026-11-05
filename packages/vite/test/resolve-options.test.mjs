import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import test from "node:test"
import { build } from "vite7"
import fc from "fast-check"
import vibelang from "../src/index.js"

const corpus = JSON.parse(readFileSync(new URL("./corpus/opencode-optional-commonjs-peer.json", import.meta.url), "utf8"))

// Vite's resolveId hook inherits Rollup's options contract. Its custom metadata
// carries the CommonJS resolver's import/require context through this.resolve.
test("delegated bare imports retain resolver options and leave the caller's object unchanged", async () => {
  const options = Object.freeze({ custom: { commonjs: { isRequire: true } }, ssr: true, isEntry: false, attributes: { type: "json" }, scan: true })
  const resolved = { id: "native-module", meta: { kept: true }, moduleSideEffects: false }
  let forwarded
  const result = await vibelang().resolveId.call({ async resolve(source, importer, next) {
    assert.equal(source, "native-module")
    assert.equal(importer, "entry.ts")
    forwarded = next
    return resolved
  } }, "native-module", "entry.ts", options)
  assert.deepEqual(forwarded, { ...options, skipSelf: true })
  assert.equal(forwarded.custom, options.custom)
  assert.equal(forwarded.attributes, options.attributes)
  assert.equal(result, resolved)
})

test("property: resolver flags and plugin metadata survive bare-import delegation", async () => {
  await fc.assert(fc.asyncProperty(fc.record({
    ssr: fc.boolean(), isEntry: fc.boolean(), scan: fc.boolean(),
    require: fc.boolean(), condition: fc.constantFrom("node", "browser", "worker"),
    attribute: fc.constantFrom("json", "css"), extra: fc.integer(),
  }), async input => {
    const options = Object.freeze({
      ssr: input.ssr, isEntry: input.isEntry, scan: input.scan,
      custom: { commonjs: { isRequire: input.require }, resolver: { condition: input.condition } },
      attributes: { type: input.attribute }, pluginFlag: input.extra, skipSelf: false,
    })
    const result = await vibelang().resolveId.call({ async resolve(_source, _importer, forwarded) {
      assert.deepEqual(forwarded, { ...options, skipSelf: true })
      assert.equal(forwarded.custom, options.custom)
      return null
    } }, "optional-native-binding", "entry.cjs", options)
    assert.equal(result, null)
    assert.equal(options.skipSelf, false)
  }), { seed: 272, numRuns: 80 })
})

test("Vite 7 preserves the optional CommonJS peer's native branch with the plugin enabled", async t => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "vite-optional-peer-")))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  writeFileSync(join(root, "package.json"), '{"type":"module"}')
  for (const [file, text] of Object.entries(corpus.files)) {
    mkdirSync(dirname(join(root, file)), { recursive: true })
    writeFileSync(join(root, file), text)
  }
  for (const enabled of [false, true]) {
    const warnings = []
    const outDir = join(root, enabled ? "with-plugin" : "native-control")
    await build({
      root, configFile: false, logLevel: "silent", plugins: enabled ? [vibelang()] : [],
      ssr: { noExternal: true },
      build: { ssr: "entry.mjs", outDir, minify: false,
        rollupOptions: { output: { format: "es", entryFileNames: "entry.mjs" }, onwarn(warning) { warnings.push(warning.message) } },
      },
    })
    const executed = spawnSync(process.execPath, [join(outDir, "entry.mjs")], { encoding: "utf8", timeout: 10000 })
    assert.equal(executed.status, 0, JSON.stringify({ enabled, stderr: executed.stderr }))
    assert.equal(executed.stdout, corpus.stdout)
    assert.deepEqual(warnings.filter(message => message.includes('without forwarding the third "options"')), [])
  }
})
