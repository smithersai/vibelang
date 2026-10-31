// opencode-21: setup's Vite and Bun.build wiring reads through the type
// assertions, satisfies clauses, non-null assertions and parentheses that wrap
// a config object or its plugins array, and a config it cannot wire is a
// warning, never a stop.
import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { addBunBuildPlugin, addVitePlugin, toolchainSpecs, wireVite } from "../lib/wire.mjs"

const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const ts = require("typescript")
const fc = require("fast-check")
const quote = "is named in setup's warnings for a person to wire, the config the tests load included, and setup goes on."
const readme = new URL("../README.md", import.meta.url)

// Wrappers that leave the value a config reads unchanged.
const wrapper = fc.constantFrom(
  (e) => e, (e) => `(${e})`, (e) => `${e} as any`, (e) => `(${e} as any)`, (e) => `${e} satisfies unknown`,
  (e) => `<any>${e}`, (e) => `${e}!`, (e) => `((${e}))`, (e) => `${e} as unknown as PluginOption[]`
)
const element = fc.constantFrom("react()", "desktopPlugin", "icons(channel)", "...extra", "tsconfigPaths({ loose: true })")
const elements = fc.array(element, { maxLength: 3 })

// The plugins array of the object defineConfig's argument (or Bun.build's) reads, seen through the wrappers.
function pluginsOf(text, callee) {
  const source = ts.createSourceFile("config.ts", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const strip = (node) => {
    while (node && (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isTypeAssertionExpression(node) || ts.isSatisfiesExpression(node) || ts.isNonNullExpression(node))) node = node.expression
    return node
  }
  let found
  const visit = (node) => {
    if (!found && ts.isCallExpression(node) && node.expression.getText(source) === callee) {
      let object = strip(node.arguments[0])
      if (ts.isArrowFunction(object)) object = strip(object.body)
      const plugins = object.properties.find((p) => p.name?.getText(source) === "plugins")
      found = strip(plugins.initializer).elements.map((e) => e.getText(source))
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return { found, errors: source.parseDiagnostics?.length ?? 0 }
}

test("opencode-21: the repository's config wires through `as any`, and a config with no defineConfig is a warning", () => {
  assert.ok(readFileSync(readme, "utf8").includes(quote), "update the quoted setup rule")
  const corpus = JSON.parse(readFileSync(new URL("./corpus/opencode-vite-plugins-as-any.json", import.meta.url), "utf8"))
  assert.equal(addVitePlugin(corpus.before, ts), corpus.after, corpus.key)
  assert.equal(addVitePlugin(corpus.after, ts), corpus.after)
  const root = mkdtempSync(join(tmpdir(), "migrate-vite-wrappers-"))
  try {
    const files = {
      "package.json": "{}\n",
      "packages/app/package.json": "{}\n",
      [corpus.file]: corpus.before,
      "packages/desktop/package.json": JSON.stringify({ scripts: { test: `vitest run --config ${corpus.unwired.slice("packages/desktop/".length)}` } }) + "\n",
      [corpus.unwired]: corpus.unwiredText
    }
    for (const [file, text] of Object.entries(files)) {
      mkdirSync(dirname(join(root, file)), { recursive: true })
      writeFileSync(join(root, file), text)
    }
    const specsFor = (dir) => toolchainSpecs(dir, { vibelang: "vibelang-0.0.11.tgz", "vibelang-vite": "vibelang-vite-0.0.11.tgz" })
    const app = wireVite({ root, packages: [{ dir: "packages/app" }], test: { command: "vitest run", cwd: "packages/app" }, ts, specsFor })
    assert.deepEqual(app.warnings, [])
    // The config the tests load gains register: true (vibelang-vite starts node and bun children with the loader).
    assert.equal(readFileSync(join(root, corpus.file), "utf8"), corpus.after.replace("vibelang(), ", "vibelang({ register: true }), "))
    const desktop = wireVite({ root, packages: [{ dir: "packages/desktop" }], test: { command: "pnpm test", cwd: "packages/desktop" }, ts, specsFor })
    assert.deepEqual(desktop.changed, [])
    assert.equal(desktop.warnings.length, 1)
    assert.match(desktop.warnings[0], /^packages\/desktop\/electron\.vite\.config\.test\.ts: the config does not call defineConfig/)
    assert.equal(readFileSync(join(root, corpus.unwired), "utf8"), corpus.unwiredText)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("vite-plugin-wrappers: vibelang() goes first in the plugins a wrapped config reads, once", () => {
  fc.assert(fc.property(wrapper, wrapper, elements, fc.boolean(), (around, inside, list, arrow) => {
    const object = `{\n  plugins: ${inside(`[${list.join(", ")}]`)},\n  server: { port: 3000 },\n}`
    const argument = arrow ? `() => (${around(object)})` : around(object)
    const text = `import { defineConfig } from "vite"\n\nexport default defineConfig(${argument})\n`
    const wired = addVitePlugin(text, ts)
    const { found, errors } = pluginsOf(wired, "defineConfig")
    assert.equal(errors, 0, wired)
    assert.deepEqual(found, ["vibelang()", ...list], wired)
    assert.equal(wired.replace("vibelang(), ", "").replace("vibelang()", "").replace('import vibelang from "vibelang-vite"\n', ""), text)
    assert.equal(addVitePlugin(wired, ts), wired)
  }), { seed: 21021, numRuns: 300 })
})

test("bun-build-plugin-wrappers: vibelang() goes first in the plugins a wrapped Bun.build reads", () => {
  fc.assert(fc.property(wrapper, wrapper, elements, (around, inside, list) => {
    const text = `await Bun.build(${around(`{ entrypoints: ["./src/index.ts"], plugins: ${inside(`[${list.join(", ")}]`)} }`)})\n`
    const wired = addBunBuildPlugin(text, ts)
    const { found, errors } = pluginsOf(wired, "Bun.build")
    assert.equal(errors, 0, wired)
    assert.deepEqual(found, ["vibelang()", ...list], wired)
  }), { seed: 21022, numRuns: 200 })
})

test("a plugins value that is not an array, under any wrapper, is still refused", () => {
  fc.assert(fc.property(wrapper, fc.constantFrom("plugins", "makePlugins()", "[...a].concat(b)"), (around, value) => {
    assert.throws(() => addVitePlugin(`export default defineConfig({ plugins: ${around(value)} })\n`, ts), /not an array literal/)
  }), { seed: 21023, numRuns: 100 })
})
