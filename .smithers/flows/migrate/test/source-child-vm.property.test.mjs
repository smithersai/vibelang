import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import * as NodePath from "node:path"
import { test } from "node:test"
import { Script } from "node:vm"
import { pathToFileURL } from "node:url"
import { addSourceChildLoaders, wireSourceChildren } from "../lib/source-children.mjs"
import { checkProperty } from "../../../../scripts/testing/property.mjs"

const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const ts = require("typescript"), fc = require("fast-check")
const corpus = JSON.parse(readFileSync(new URL("./corpus/t3code-electron-launcher-vm.json", import.meta.url), "utf8"))
const file = "apps/desktop/scripts/dev-electron.mjs"

async function startup(text) {
  const calls = []
  const child = Object.fromEntries(["execFileSync", "spawnSync"].map(method => [method, (...args) => { calls.push([method, ...args]) }]))
  // This is the import-removal and Script context used by the native test.
  const code = "(async () => { " + text.replace(/^import\s[\s\S]*?;\n/gm, "") + " })()"
  await new Script(code).runInNewContext({ NodeChildProcess: child, NodePath, process: { execPath: "node" } })
  return JSON.parse(JSON.stringify(calls))
}

test("t3code: built JavaScript children preserve VM startup cleanup and original script bytes", async () => {
  const before = await startup(corpus.source)
  assert.equal(before.length, 2)
  const result = addSourceChildLoaders(corpus.source, ts, { file })
  assert.deepEqual(await startup(result.text), before)
  assert.equal(result.text, corpus.source)
  assert.equal(result.usesChild, false)
  assert.deepEqual(result.refusals, [])
})

test("full setup leaves the JavaScript path launcher and manifest byte-identical", () => {
  const root = mkdtempSync(NodePath.join(tmpdir(), "source-child-vm-"))
  try {
    const manifest = JSON.stringify({ name: "desktop-fixture", private: true, type: "module", scripts: { dev: "node scripts/dev-electron.mjs" } })
    mkdirSync(NodePath.join(root, "scripts"), { recursive: true })
    writeFileSync(NodePath.join(root, "package.json"), manifest)
    writeFileSync(NodePath.join(root, "scripts/dev-electron.mjs"), corpus.source)
    const writes = []
    const options = { root, all: ["package.json", "scripts/dev-electron.mjs"], manifests: ["package.json"], ts,
      specsFor: () => ({ vibelang: "0.0.11", effect: "4.1.1" }),
      write: (path, text) => { writes.push(path); writeFileSync(NodePath.join(root, path), text) } }
    assert.deepEqual(wireSourceChildren(options).warnings, [])
    assert.deepEqual(writes, [])
    assert.equal(readFileSync(NodePath.join(root, "scripts/dev-electron.mjs"), "utf8"), corpus.source)
    assert.equal(readFileSync(NodePath.join(root, "package.json"), "utf8"), manifest)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test("repeated setup removes the canonical helper previously added to a JavaScript path child", () => {
  const dynamic = corpus.source.replace('NodePath.join(desktopDir, "scripts/build-browser-secret.mjs")', "entry")
  const previous = addSourceChildLoaders(dynamic, ts, { file }).text.replace(
    "__vibelangSourceChild(process.execPath, [entry])",
    '__vibelangSourceChild(process.execPath, [NodePath.join(desktopDir, "scripts/build-browser-secret.mjs")])')
  const result = addSourceChildLoaders(previous, ts, { file })
  assert.equal(result.text, corpus.source)
  assert.equal(result.usesChild, false)
  assert.deepEqual(result.refusals, [])
  assert.equal(addSourceChildLoaders(result.text, ts, { file }).text, result.text)
})

test("typed paths, shadowed methods and observable path imports keep conservative wiring", () => {
  const sources = [
    corpus.source.replace("build-browser-secret.mjs", "entry.ts"),
    corpus.source.replace("build-browser-secret.mjs", "entry.vibe"),
    corpus.source.replace("build-browser-secret.mjs", "entry.mjs/../entry.ts"),
    corpus.source.replace('"scripts/build-browser-secret.mjs"', "entry"),
    corpus.source.replace('import * as NodePath from "node:path";', "const NodePath = { join: () => 'entry.ts' };"),
    corpus.source.replace('from "node:path"', 'from "./path.mjs"'),
    corpus.source.replace("NodePath.join(desktopDir,", "NodePath.basename(desktopDir,"),
    corpus.source.replace('const desktopDir', 'mutate(NodePath);\nconst desktopDir'),
    corpus.source + '\nexport { NodePath };\n',
    corpus.source + '\nexport const observed = { NodePath };\n',
    corpus.source.replace('const desktopDir', 'import pathAlias from "node:path";\npathAlias.join = () => "entry.ts";\nconst desktopDir'),
    corpus.source.replace('const desktopDir', 'const alias = NodePath;\nalias.join = () => "entry.ts";\nconst desktopDir'),
    corpus.source.replace('const desktopDir', 'NodePath.join = () => "entry.ts";\nconst desktopDir'),
    corpus.source.replace('const desktopDir', 'Object.assign(NodePath, { join: () => "entry.ts" });\nconst desktopDir'),
    corpus.source.replace("NodePath.join(desktopDir,", "NodePath.join(...prefix, desktopDir,"),
    corpus.source.replace('], { stdio: "inherit" }', ', ...args], { stdio: "inherit" }'),
    corpus.source.replace("const desktopDir", 'Array.prototype.slice = () => ["entry.ts"];\nconst desktopDir')
  ]
  for (const source of sources) {
    const result = addSourceChildLoaders(source, ts, { file })
    assert.equal(result.usesChild, true, source)
    assert.notEqual(result.text, source)
  }
})

test("property: native JavaScript path entries preserve script bytes across imports, flags and dynamic tails", async () => {
  await checkProperty(fc, {
    name: "t3code-source-child-javascript-path",
    rule: "Setup preserves native launcher bytes when an unmodified node:path join or resolve proves a JavaScript runtime entry; program arguments do not require a source loader.",
    command: "node --test .smithers/flows/migrate/test/source-child-vm.property.test.mjs",
    arbitrary: fc.record({ method: fc.constantFrom("join", "resolve"), style: fc.constantFrom("namespace", "default", "named"),
      module: fc.constantFrom("path", "node:path"), entry: fc.constantFrom("entry.js", "scripts/entry.mjs", "worker.cjs"),
      flags: fc.constantFrom([], ["--watch"], ["--import", "preload.mjs"], ["--require=preload.cjs"], ["--"]),
      methodName: fc.constantFrom("makePath", "joinPath", "entryPath"), directory: fc.string({ maxLength: 30 }) }),
    numRuns: 240,
    check: input => {
      const imports = input.style === "named" ? "import { " + input.method + " as " + input.methodName + " }"
        : input.style === "default" ? "import NodePath" : "import * as NodePath"
      const callee = input.style === "named" ? input.methodName : "NodePath." + input.method
      const source = 'import { spawnSync } from "node:child_process";\n' + imports + " from " + JSON.stringify(input.module) + ";\n" +
        "export function launch(directory, args) { return spawnSync(process.execPath, [" +
        input.flags.map(JSON.stringify).map(s => s + ", ").join("") + callee + "(directory, " + JSON.stringify(input.entry) + ")" + (input.method === "resolve" ? ", ...args" : ', "--native-option", "entry.js"') + "]); }\n"
      const result = addSourceChildLoaders(source, ts, { file })
      assert.equal(result.text, source)
      assert.equal(result.usesChild, false)
      assert.deepEqual(result.refusals, [])
      assert.match(NodePath[input.method](input.directory, input.entry), /\.(?:[cm]?js)$/)
    }
  })
})

test("property: native path construction never suppresses typed source loaders", async () => {
  await checkProperty(fc, {
    name: "t3code-source-child-typed-path",
    rule: "A path join or resolve ending in typed source still needs the native source-child loader.",
    command: "node --test .smithers/flows/migrate/test/source-child-vm.property.test.mjs",
    arbitrary: fc.record({ method: fc.constantFrom("join", "resolve"), entry: fc.constantFrom("entry.ts", "entry.mts", "entry.cts", "entry.tsx", "entry.vibe", "entry.vibex") }),
    numRuns: 80,
    check: input => {
      const source = corpus.source.replace("NodePath.join(", "NodePath." + input.method + "(").replace("scripts/build-browser-secret.mjs", input.entry)
      const result = addSourceChildLoaders(source, ts, { file })
      assert.equal(result.usesChild, true)
      assert.deepEqual(result.refusals, [])
      assert.equal(addSourceChildLoaders(result.text, ts, { file }).text, result.text)
    }
  })
})

test("property: omitted path wrappers agree with the runtime helper for adversarial directories and tails", async () => {
  const template = readFileSync(new URL("../templates/source-child.ts", import.meta.url), "utf8")
  const schema = pathToFileURL(require.resolve("effect/Schema")).href
  const js = ts.transpileModule(template + "\nexport { __vibelangSourceChild }", {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 }
  }).outputText.replaceAll('"effect/Schema"', JSON.stringify(schema))
  const helper = (await import("data:text/javascript;base64," + Buffer.from(js).toString("base64"))).__vibelangSourceChild
  const token = fc.constantFrom("--import", "--require", "--watch", "--", "entry.ts", "entry.vibe", "entry.js", "--import=preload.js")
  await checkProperty(fc, {
    name: "t3code-source-child-path-runtime-oracle",
    rule: "Every omitted path wrapper preserves the actual runtime helper's command and argv, including paths that could be parsed as runtime options.",
    command: "node --test .smithers/flows/migrate/test/source-child-vm.property.test.mjs",
    arbitrary: fc.record({ method: fc.constantFrom("join", "resolve"),
      directory: fc.oneof(fc.string({ maxLength: 32 }), fc.constantFrom("", ".", "--import=x", "--require=x", "--conditions=x", "--watch")),
      entry: fc.constantFrom("entry.js", "scripts/entry.mjs", "worker.cjs"), runtime: fc.constantFrom("node", "bun"),
      prefix: fc.array(token, { maxLength: 5 }), tail: fc.array(token, { maxLength: 5 }) }),
    numRuns: 600,
    check: input => {
      const tokens = list => list.map(JSON.stringify).map(s => s + ", ").join("")
      const source = 'import { spawnSync } from "node:child_process";\nimport * as NodePath from "node:path";\n' +
        'export function launch(directory) { return spawnSync(' + JSON.stringify(input.runtime) + ", [" +
        tokens(input.prefix) + "NodePath." + input.method + "(directory, " + JSON.stringify(input.entry) + ")" +
        input.tail.map(s => ", " + JSON.stringify(s)).join("") + "]); }\n"
      const result = addSourceChildLoaders(source, ts, { file })
      if (result.usesChild) return
      const args = [...input.prefix, NodePath[input.method](input.directory, input.entry), ...input.tail]
      const actual = helper(input.runtime, args, () => { throw new Error("omitted path wrapper needed a native loader") })
      assert.equal(actual[0], input.runtime)
      assert.equal(actual[1], args)
      assert.equal(result.text, source)
    }
  })
})
