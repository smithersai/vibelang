import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { test } from "node:test"
import { runInNewContext } from "node:vm"
import { addTsdownPlugin } from "../lib/tsdown.mjs"
const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const ts = require("typescript"), fc = require("fast-check")
const execute = (source, factory = false) => {
  const exports = {}
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText
  runInNewContext(js, {
    exports,
    require: name => name === "tsdown" ? { defineConfig: x => x } :
      name === "vibelang-unplugin/rolldown" ? { __esModule: true, default: () => ({ name: "native-vibelang" }) } :
      assert.fail("unexpected dependency " + name)
  }, { timeout: 1000 })
  return JSON.parse(JSON.stringify(factory ? exports.default(() => ({ name: "user-plugin" })) : exports.default))
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

// Chapter 7: "Existing tools work." Resolve the binding, not
// its spelling: every user plugin and user declaration survives setup.
test("RD-016: shadowed default, namespace and named plugin aliases keep their bindings", () => {
  const imports = [
    ['import native from "vibelang-unplugin/rolldown";', "native()"],
    ['import * as native from "vibelang-unplugin/rolldown";', "native.default()"],
    ['import { default as native } from "vibelang-unplugin/rolldown";', "native()"]
  ]
  for (const [head, call] of imports) {
    for (const scope of ["parameter", "destructured", "local", "block", "var", "catch", "loop", "function-name"]) {
      for (const existing of [false, true]) {
        const user = call.includes(".default") ? '{ default: () => ({ name: "user-plugin" }) }' : '() => ({ name: "user-plugin" })'
        const object = '{ entry: ["src/index.ts"], plugins: [' + (existing ? call + ", " : "") + '{name:"kept"}] }'
        let factory
        if (scope === "parameter") factory = '(native = ' + user + ') => (' + object + ')'
        if (scope === "destructured") factory = '({ native = ' + user + ' } = {}) => (' + object + ')'
        if (scope === "local") factory = '() => { const native = ' + user + '; return ' + object + '; }'
        if (scope === "block") factory = '() => { { const native = ' + user + '; return ' + object + '; } }'
        if (scope === "var") factory = '() => { if (true) { var native = ' + user + '; } return ' + object + '; }'
        if (scope === "catch") factory = '() => { try { throw ' + user + '; } catch (native) { return ' + object + '; } }'
        if (scope === "loop") factory = '() => { for (const native of [' + user + ']) return ' + object + '; }'
        if (scope === "function-name") factory = 'function native() { return ' + object + '; }'
        // A function's self binding is itself a valid user plugin here.
        if (scope === "function-name" && existing) continue
        const source = head + '\nconst make = ' + factory + '; export default () => make();'
        const result = addTsdownPlugin(source, ts, "tsdown.config.mjs")
        assert.deepEqual(result.refusals, [], scope)
        const before = execute(source, true), after = execute(result.text, true)
        assert.equal(after.plugins.filter(p => p.name === "native-vibelang").length, 1, scope + ": " + result.text)
        assert.deepEqual(after.plugins.filter(p => p.name !== "native-vibelang"), before.plugins)
        assert.equal(result.text.includes("const native = " + user), source.includes("const native = " + user))
        assert.equal(addTsdownPlugin(result.text, ts, "tsdown.config.mjs").text, result.text)
      }
    }
  }
})

test("RD-016 property: generated nested shadows preserve every existing plugin", () => {
  fc.assert(fc.property(
    fc.constantFrom("default", "namespace", "named"),
    fc.array(fc.constantFrom("parameter", "local", "block", "destructured", "var"), { minLength: 1, maxLength: 5 }),
    fc.array(fc.oneof(fc.string(), fc.constant("native-vibelang")), { maxLength: 6 }), fc.boolean(),
    (kind, scopes, plugins, existing) => {
      const head = kind === "namespace" ? 'import * as native from "vibelang-unplugin/rolldown";' :
        kind === "named" ? 'import { default as native } from "vibelang-unplugin/rolldown";' : 'import native from "vibelang-unplugin/rolldown";'
      const call = kind === "namespace" ? "native.default()" : "native()"
      const user = kind === "namespace" ? '{default:()=>({name:"user-plugin"})}' : '()=>({name:"user-plugin"})'
      // Generate lexical nesting with named local helpers that gather follows.
      let definition = 'const leaf = () => (' + '{plugins:[' + (existing ? call + "," : "") + plugins.map(name => JSON.stringify({name, user: true})).join(",") + ']}' + '); return leaf();'
      for (const scope of scopes) {
        const parameter = scope === "parameter" ? 'native=' + user : scope === "destructured" ? '{native=' + user + '}={}' : ""
        const local = parameter ? "" : (scope === "var" ? "var" : "let") + ' native=' + user + ';'
        definition = 'const nested = (' + parameter + ') => {' + (scope === "block" ? "{" : "") + local + definition + (scope === "block" ? "}" : "") + '}; return nested();'
      }
      const source = head + '\nconst vibelang=0, vibelangPlugin1=1; export default () => {' + definition + '};'
      const result = addTsdownPlugin(source, ts)
      assert.deepEqual(result.refusals, [])
      const before = execute(source, true), after = execute(result.text, true)
      assert.equal(after.plugins.filter(p => p.name === "native-vibelang" && !p.user).length, 1)
      assert.deepEqual(after.plugins.filter(p => p.name !== "native-vibelang" || p.user), before.plugins)
      assert.equal(addTsdownPlugin(result.text, ts).text, result.text)
    }), { seed: 16016, numRuns: 120 })
})

test("RD-016: every imported default binding is recognized, including combined import clauses", () => {
  for (const [head, call] of [
    ['import unused, * as native from "vibelang-unplugin/rolldown";', "native.default()"],
    ['import unused, { default as native } from "vibelang-unplugin/rolldown";', "native()"],
    ['import { default as unused, default as native } from "vibelang-unplugin/rolldown";', "native()"]
  ]) {
    const source = head + ' export default { plugins: [' + call + '] };'
    assert.equal(addTsdownPlugin(source, ts).text, source)
  }
})

test("RD-016: imported binding identity is stable for nested and normalized config filenames", () => {
  const source = 'import native from "vibelang-unplugin/rolldown"; export default (native) => ({plugins:[{name:"kept"}]});'
  for (const file of ["./tsdown.config.mjs", "packages/worker/tsdown.config.ts"]) {
    const result = addTsdownPlugin(source, ts, file)
    assert.deepEqual(result.refusals, [])
    const after = execute(result.text, true)
    assert.deepEqual(after.plugins.map(p => p.name), ["native-vibelang", "kept"])
    assert.equal(addTsdownPlugin(result.text, ts, file).text, result.text)
  }
})
