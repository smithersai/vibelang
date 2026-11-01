// A property over the shapes of an esbuild call's options: the program setup
// wires, run against a stub esbuild, passes each call the plugins it passed
// before with vibelang() last and every other option as it was; or setup
// refuses the call, at its line, exactly when a spread it cannot see into
// could set plugins after (or instead of) the call's own. A second run
// changes nothing.
import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, posix } from "node:path"
import { createRequire } from "node:module"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import { loadTypeScript } from "../lib/declarations.mjs"
import { addEsbuildPlugin, wireEsbuildBuilds } from "../lib/esbuild-builds.mjs"

const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const fc = require("fast-check")
const ts = loadTypeScript([fileURLToPath(new URL("../../../../packages/runtime/", import.meta.url))])

// What a spread holds, as source, and whether setup can see it holds no plugins.
const spreads = {
  literal: { text: "...{ minify: true }", safe: true },
  conditional: { text: "...(flag ? { sourcemap: true } : {})", safe: true },
  guarded: { text: "...(flag && { target: \"es2022\" })", safe: true },
  constant: { text: "...base", safe: true },
  parameter: { text: "...given", safe: false },
  withPlugins: { text: "...{ plugins: [named(\"spread\")] }", safe: false },
  conditionalPlugins: { text: "...(flag ? { plugins: [named(\"branch\")] } : {})", safe: false }
}
const ownPlugins = {
  none: null,
  empty: "plugins: []",
  one: "plugins: [named(\"one\")]",
  two: "plugins: [named(\"one\"), named(\"two\")]",
  variable: "plugins: extra",
  shorthand: "plugins"
}

const shape = fc.record({
  callee: fc.constantFrom("build", "context", "esbuild.build", "bundle"),
  form: fc.constantFrom("inline", "constant", "helper", "arrow"),
  plugins: fc.constantFrom(...Object.keys(ownPlugins)),
  before: fc.subarray(Object.keys(spreads)),
  after: fc.subarray(Object.keys(spreads)),
  options: fc.subarray(["entryPoints: [\"src/index.ts\"]", "bundle: true", "platform: \"browser\"", "write: false", "external: [\"effect\"]"]),
  multiline: fc.boolean(),
  flag: fc.boolean(),
  given: fc.constantFrom("{}", "{ plugins: [named(\"given\")] }")
})

function program(s) {
  const own = ownPlugins[s.plugins]
  const parts = [...s.before.map((k) => spreads[k].text), ...s.options, ...(own ? [own] : []), ...s.after.map((k) => spreads[k].text)]
  const object = parts.length === 0 ? "{}" : s.multiline ? `{\n    ${parts.join(",\n    ")},\n  }` : `{ ${parts.join(", ")} }`
  const call = (arg) => `${s.callee}(${arg})`
  const body = {
    inline: `  ${call(object)}`,
    constant: `  const options = ${object}\n  ${call("options")}`,
    helper: `  function optionsOf() {\n    return ${object}\n  }\n  ${call("optionsOf()")}`,
    arrow: `  const optionsOf = () => (${object})\n  ${call("optionsOf()")}`
  }[s.form]
  return `import { build, context } from "esbuild"
import * as esbuild from "esbuild"
import { build as bundle } from "esbuild"

const base = { format: "esm" }
export function run(given: object, flag: boolean, extra: object[], plugins: object[]) {
${body}
}
`
}

// Runs a program's run() against a stub esbuild and returns the options its call received.
function evaluate(text, s) {
  const { outputText } = ts.transpileModule(text, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } })
  const calls = []
  const stub = { build: (options) => calls.push(options), context: (options) => calls.push(options) }
  const modules = { esbuild: stub, "vibelang-unplugin/esbuild": { default: () => ({ name: "vibelang" }) } }
  const exports = {}
  new Function("require", "exports", "named", outputText)((id) => modules[id], exports, (name) => ({ name }))
  const named = (name) => ({ name })
  exports.run(new Function("named", `return (${s.given})`)(named), s.flag, [named("extra")], [named("shorthand")])
  assert.equal(calls.length, 1)
  return calls[0]
}

const names = (plugins) => (plugins ?? []).map((plugin) => plugin.name)

test("property: wired esbuild options keep their plugins and options and add vibelang() last, or are refused with the call's line", () => {
  fc.assert(fc.property(shape, (s) => {
    const text = program(s)
    const { text: wired, refusals } = addEsbuildPlugin(text, ts)
    // A spread setup cannot see into is unsafe where it can set the plugins the call ends with.
    const unsafe = (s.plugins === "none" ? [...s.before, ...s.after] : s.after).some((k) => !spreads[k].safe)
    const before = evaluate(text, s)
    if (unsafe) {
      assert.equal(wired, text, "a refused call is left as it was")
      assert.equal(refusals.length, 1)
      const callLine = text.split("\n").findIndex((line) => line.includes(`${s.callee}(`)) + 1
      assert.equal(refusals[0].line, callLine)
      return
    }
    assert.deepEqual(refusals, [], text)
    const after = evaluate(wired, s)
    assert.deepEqual(names(after.plugins), [...names(before.plugins), "vibelang"], wired)
    const { plugins: _a, ...restAfter } = after
    const { plugins: _b, ...restBefore } = before
    assert.deepEqual(restAfter, restBefore)
    assert.equal(addEsbuildPlugin(wired, ts).text, wired, "a second run changes nothing")
  }), { numRuns: 400 })
})

// Decided detail 272 as a property over package layouts: whatever mix of
// tests, fixtures, helpers and sources a package has, wiring changes no test,
// no fixture and no file only they import, and wires every other file that
// calls build.
test("wireEsbuildBuilds never edits a test, a fixture or a file only tests import (property)", () => {
  const call = 'import { build } from "esbuild"\nawait build({ entryPoints: ["x.ts"] })\n'
  // A role: where the file sits, and whether setup may edit it.
  const roles = {
    testDir: { path: (i) => `test/case${i}.ts`, test: true },
    testsDir: { path: (i) => `tests/case${i}.ts`, test: true },
    suffix: { path: (i) => `src/case${i}.test.ts`, test: true },
    spec: { path: (i) => `src/case${i}.spec.mts`, test: true },
    jestDir: { path: (i) => `src/__tests__/case${i}.ts`, test: true },
    fixture: { path: (i) => `test/fixtures/case${i}.ts`, test: true },
    topFixture: { path: (i) => `fixtures/case${i}/build.mjs`, test: true },
    onlyTests: { path: (i) => `src/helper${i}.ts`, test: true, importedBy: "test" },
    shared: { path: (i) => `src/shared${i}.ts`, test: false, importedBy: "both" },
    exported: { path: (i) => `src/exported${i}.ts`, test: false, importedBy: "test", exported: true },
    script: { path: (i) => `scripts/build${i}.mjs`, test: false },
    source: { path: (i) => `src/bundle${i}.ts`, test: false }
  }
  const root = mkdtempSync(join(tmpdir(), "migrate-esbuild-layouts-"))
  try {
    fc.assert(fc.property(fc.array(fc.constantFrom(...Object.keys(roles)), { minLength: 1, maxLength: 8 }), (picked) => {
      rmSync(join(root, "packages"), { recursive: true, force: true })
      const put = (file, text) => {
        mkdirSync(join(root, file, ".."), { recursive: true })
        writeFileSync(join(root, file), text)
      }
      const files = picked.map((role, i) => ({ role: roles[role], path: `packages/app/${roles[role].path(i)}` }))
      const rel = (from, to) => { const r = posix.relative(posix.dirname(from), to); return r.startsWith(".") ? r : `./${r}` }
      const exportsMap = Object.fromEntries(files.filter((f) => f.role.exported).map((f) => [`./${f.path.slice(13)}`, `./${f.path.slice(13).replace(/^src\//, "dist/").replace(/\.ts$/, ".js")}`]))
      put("package.json", JSON.stringify({ name: "root", private: true, workspaces: ["packages/*"] }))
      put("packages/core/package.json", JSON.stringify({ name: "core" }))
      put("packages/app/package.json", JSON.stringify({ name: "app", exports: exportsMap, dependencies: { core: "workspace:*" } }))
      const importer = (who) => files.filter((f) => f.role.importedBy === who || f.role.importedBy === "both")
      put("packages/app/test/uses.test.ts", importer("test").map((f) => `import ${JSON.stringify(rel("packages/app/test/uses.test.ts", f.path))}\n`).join(""))
      put("packages/app/src/index.ts", files.filter((f) => f.role.importedBy === "both").map((f) => `export * from ${JSON.stringify(rel("packages/app/src/index.ts", f.path))}\n`).join(""))
      for (const f of files) put(f.path, call)
      wireEsbuildBuilds({ root, packages: [{ dir: "packages/core" }], ts, specsFor: () => ({ vibelang: "file:/v.tgz", "vibelang-unplugin": "file:/u.tgz" }) })
      for (const f of files) {
        const text = readFileSync(join(root, f.path), "utf8")
        if (f.role.test) assert.equal(text, call, `${f.path} is a test's and changed`)
        else assert.match(text, /plugins: \[vibelang\(\)\]/, `${f.path} is a source and was not wired`)
      }
    }), { numRuns: 200 })
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
