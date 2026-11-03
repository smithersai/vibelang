import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { wireVite } from "../lib/wire.mjs"

const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const ts = require("typescript"), fc = require("fast-check")
const corpus = JSON.parse(readFileSync(new URL("./corpus/alchemy-workflows-shared-project.json", import.meta.url)))
const specsFor = () => ({ vibelang: "0.0.11", "vibelang-vite": "0.0.11" })
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "alchemy-vitest-projects-"))
  const put = (file, text) => { mkdirSync(dirname(join(root, file)), { recursive: true }); writeFileSync(join(root, file), text) }
  put("package.json", '{"private":true,"type":"module"}')
  put("vitest.config.ts", corpus.config)
  put("src/internal/workflows-shared/test/a.test.ts", corpus.test)
  put("src/internal/workflows-shared/value.ts", corpus.source)
  put("src/internal/workflows-shared/test/global-setup.ts", "export default () => {};\n")
  put("src/plain/a.test.ts", "export const value = 1;\n")
  return { root, put, read: file => readFileSync(join(root, file), "utf8"), dispose: () => rmSync(root, { recursive: true, force: true }) }
}
const wire = f => wireVite({ root: f.root, packages: [{ dir: ".", sources: ["src/internal/workflows-shared"] }], test: { command: "vitest run", cwd: "." }, ts, specsFor })
const loader = "vibelang({ register: true }), "

test("alchemy workflows-shared gets its own native plugin without changing test options or unrelated projects", () => {
  const f = fixture()
  try {
    const result = wire(f), after = f.read("vitest.config.ts")
    assert.deepEqual(result.warnings, [])
    assert.ok(after.includes("plugins: [" + loader + "cloudflareTest("), after)
    assert.equal(after.replace("plugins: [" + loader + "cloudflareTest(", "plugins: [cloudflareTest("), corpus.config)
    assert.ok(result.changed.includes("vitest.config.ts"), "receipt must name written configs")
    assert.deepEqual(wire(f).changed, [], "setup is idempotent")
    assert.equal(f.read("src/internal/workflows-shared/test/a.test.ts"), corpus.test)
    assert.equal(f.read("src/plain/a.test.ts"), "export const value = 1;\n")
  } finally { f.dispose() }
})

test("projects with no converted or selected source in reach keep their own plugins byte-identical", () => {
  const f = fixture()
  try {
    f.put("src/internal/workflows-shared/test/a.test.ts", "export const value = 1;\n")
    const result = wireVite({ root: f.root, packages: [{ dir: ".", sources: ["elsewhere"] }], test: { command: "vitest run", cwd: "." }, ts, specsFor })
    assert.deepEqual(result.warnings, [])
    assert.equal(f.read("vitest.config.ts"), corpus.config)
  } finally { f.dispose() }
})

test("a setup file reaching a converted module also needs the project loader", () => {
  const f = fixture()
  try {
    f.put("src/internal/workflows-shared/test/a.test.ts", "export const value = 1;\n")
    f.put("src/internal/workflows-shared/test/global-setup.ts", corpus.test)
    wire(f)
    assert.ok(f.read("vitest.config.ts").includes("plugins: [" + loader + "cloudflareTest("))
  } finally { f.dispose() }
})

test("property: literal and computed roots, plugin aliases, comments and quote styles preserve project options", () => {
  fc.assert(fc.property(fc.boolean(), fc.boolean(), fc.boolean(), fc.integer({min:0,max:9}), (computed, single, empty, suffix) => {
    const f = fixture()
    try {
      const name = "native" + suffix, plugin = "nativePlugin" + suffix
      const quoted = value => single ? "'" + value + "'" : JSON.stringify(value)
      const root = computed ? 'sourceRoot(' + quoted(name) + ')' : quoted("./src/" + name)
      const original = 'import path from "node:path";\nimport {defineConfig} from "vitest/config";\nimport ' + plugin + ' from "vibelang-vite";\nconst sourceRoot = (...parts) => path.resolve(import.meta.dirname, "src", ...parts);\nexport default defineConfig({plugins:[' + plugin + '({register:true})],test:{projects:[{root:' + root + ',plugins:[' + (empty ? "" : "/* retain plugin */ existing()") + '],test:{include:["**/*.test.ts"],pool:"forks",retry:2,testTimeout:50000}}]}});\n'
      f.put("vitest.config.ts", original)
      f.put("src/" + name + "/a.test.ts", 'import "./value.ts";\n')
      f.put("src/" + name + "/value.ts", corpus.source)
      const result = wireVite({ root: f.root, packages: [{dir:".",sources:["src/" + name]}], test: {command:"vitest",cwd:"."},ts,specsFor })
      assert.deepEqual(result.warnings, [])
      const after = f.read("vitest.config.ts")
      assert.equal((after.match(new RegExp(plugin + "\\(", "g")) ?? []).length, 2, after)
      assert.ok(after.includes('pool:"forks",retry:2,testTimeout:50000'))
      assert.deepEqual(wireVite({ root:f.root,packages:[{dir:".",sources:["src/" + name]}],test:{command:"vitest",cwd:"."},ts,specsFor }).changed, [])
      assert.deepEqual(ts.createSourceFile("vitest.config.ts", after, ts.ScriptTarget.Latest, true).parseDiagnostics, [])
    } finally { f.dispose() }
  }), {seed:561168,numRuns:40})
})

test("an unsupported sibling reports a located warning while the native project is still wired", () => {
  const f = fixture()
  try {
    f.put("vitest.config.ts", corpus.config.replace('root: "./src/plain"', 'root: dynamicRoot()'))
    const result = wire(f)
    assert.ok(f.read("vitest.config.ts").includes("plugins: [" + loader + "cloudflareTest("))
    assert.deepEqual(result.warnings, ['vitest.config.ts: Vitest project "plain": root is not a static path; wire its loader by hand'])
  } finally { f.dispose() }
})

test("native projects without their own plugin array gain one; existing native plugin calls stay single", () => {
  for (const plugins of ["", "plugins: [],", "plugins: [vibelang({ register: true })],"]) {
    const f = fixture()
    try {
      f.put("vitest.config.ts", corpus.config.replace('plugins: [cloudflareTest({ wrangler: { configPath: "wrangler.jsonc" } })],', plugins))
      wire(f)
      const after = f.read("vitest.config.ts")
      assert.equal((after.match(/vibelang\(/g) ?? []).length, 2)
      assert.deepEqual(wire(f).changed, [])
    } finally { f.dispose() }
  }
})

test("a conditional exclude in an earlier project cannot hide the later workflows-shared project", () => {
  const f = fixture()
  try {
    const prefix = '{root:"./src/plain",test:{name:"conditional",include:["**/*.test.ts"],exclude:process.env.CI ? ["slow.test.ts"] : []}},'
    f.put("vitest.config.ts", corpus.config.replace("test: { projects: [", "test: { projects: [" + prefix))
    const result = wire(f)
    assert.ok(f.read("vitest.config.ts").includes("plugins: [" + loader + "cloudflareTest("))
    assert.ok(f.read("vitest.config.ts").includes(prefix))
    assert.equal(result.warnings.length, 1)
  } finally { f.dispose() }
})
