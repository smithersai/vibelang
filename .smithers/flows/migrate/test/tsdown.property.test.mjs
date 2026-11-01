import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { test } from "node:test"
import { runInNewContext } from "node:vm"
import { addTsdownPlugin } from "../lib/tsdown.mjs"
const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const ts = require("typescript"), fc = require("fast-check")
const execute = source => {
  const exports = {}
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText
  runInNewContext(js, {
    exports,
    require: name => name === "tsdown" ? { defineConfig: x => x } :
      name === "vibelang-unplugin/rolldown" ? { __esModule: true, default: () => ({ name: "native-vibelang" }) } :
      assert.fail("unexpected dependency " + name)
  }, { timeout: 1000 })
  return JSON.parse(JSON.stringify(exports.default))
}
const withoutNative = configs => configs.map(config => {
  const result = { ...config }
  if (result.plugins) result.plugins = result.plugins.filter(plugin => plugin.name !== "native-vibelang")
  if (result.plugins?.length === 0) delete result.plugins
  return result
})

test("property: tsdown arrays and local factories preserve every option and existing plugin", () => {
  fc.assert(fc.property(fc.array(fc.record({
    entry: fc.string(), minify: fc.boolean(), dts: fc.boolean(), helper: fc.boolean(), plugin: fc.boolean()
  }), { minLength: 1, maxLength: 8 }), fc.boolean(), (configs, collision) => {
    const source = [
      'import { defineConfig as config, type UserConfig } from "tsdown";',
      collision ? "const vibelang = 7;" : "",
      ...configs.flatMap((config, i) => config.helper ? [
        "const make" + i + " = (entry: string): UserConfig => ({ entry, minify: " + config.minify + ", dts: " + config.dts +
          (config.plugin ? ', plugins: [{ name: "kept", id: ' + i + ' }] as unknown as UserConfig["plugins"]' : "") + " });"
      ] : []),
      "export default config([" + configs.map((config, i) => config.helper ? "make" + i + "(" + JSON.stringify(config.entry) + ")" :
        JSON.stringify({ entry: config.entry, minify: config.minify, dts: config.dts, ...(config.plugin ? { plugins: [{ name: "kept", id: i }] } : {}) })).join(",") + "]);"
    ].join("\n")
    const result = addTsdownPlugin(source, ts)
    assert.deepEqual(result.refusals, [])
    const before = execute(source), after = execute(result.text)
    assert.equal(after.length, before.length)
    for (const config of after) {
      assert.equal(config.plugins[0].name, "native-vibelang")
      assert.equal(config.plugins.filter(plugin => plugin.name === "native-vibelang").length, 1)
    }
    assert.deepEqual(withoutNative(after), before)
    assert.deepEqual(addTsdownPlugin(result.text, ts), { text: result.text, refusals: [], usesPlugin: true })
  }), { seed: 46051, numRuns: 300 })
})

test("unknown spreads and destructured parameter shadows remain unchanged with a precise warning", () => {
  for (const source of [
    'import { defineConfig } from "tsdown"; export default defineConfig({ ...unknown });',
    'import { defineConfig } from "tsdown"; const plugins = []; export default defineConfig(({ plugins }) => ({ plugins }));'
  ]) {
    const result = addTsdownPlugin(source, ts, "tsdown.config.ts")
    assert.equal(result.text, source)
    assert.ok(result.refusals.length > 0)
    assert.ok(result.refusals.every(refusal => refusal.line >= 1))
  }
})

test("an existing aliased Rolldown plugin stays single and unrelated local names stay intact", () => {
  const source = 'import native from "vibelang-unplugin/rolldown";\nimport * as down from "tsdown";\nexport default down.defineConfig([{plugins:[native()]}]);\n'
  assert.equal(addTsdownPlugin(source, ts).text, source)
})

test("property: a reused config factory installs one plugin in every returned config", () => {
  fc.assert(fc.property(fc.array(fc.string(), { minLength: 2, maxLength: 8 }), entries => {
    const source = [
      'import { defineConfig } from "tsdown";',
      'const make = (entry: string) => ({ entry, plugins: [{ name: "kept" }] });',
      "export default defineConfig([" + entries.map(entry => "make(" + JSON.stringify(entry) + ")").join(",") + "]);"
    ].join("\n")
    const result = addTsdownPlugin(source, ts)
    assert.deepEqual(result.refusals, [])
    const after = execute(result.text)
    assert.equal(after.length, entries.length)
    assert.deepEqual(withoutNative(after), execute(source))
    for (const config of after) assert.equal(config.plugins.filter(p => p.name === "native-vibelang").length, 1)
  }), { seed: 46052, numRuns: 100 })
})

test("static computed plugin keys work, while unknown overriding keys remain explicit", () => {
  const source = 'import { defineConfig } from "tsdown"; export default defineConfig([{ ["plugins"]: [{ name: "kept" }] }]);'
  const result = addTsdownPlugin(source, ts)
  assert.deepEqual(result.refusals, [])
  assert.equal(execute(result.text)[0].plugins[0].name, "native-vibelang")
  const unknown = 'import { defineConfig } from "tsdown"; export default defineConfig({ [unknown]: [] });'
  assert.equal(addTsdownPlugin(unknown, ts).text, unknown)
  assert.equal(addTsdownPlugin(unknown, ts).refusals.length, 1)
})
