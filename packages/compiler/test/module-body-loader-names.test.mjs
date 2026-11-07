// VIP-40: a loader serves each module body under the filename the compiler
// gives it, from the compiled parent, and serves a new body after the parent
// changes. Node (vibelang/register) and Bun (vibelang/bun) are checked here;
// Vite and unplugin check the same names in their own packages.
import { strict as assert } from "node:assert"
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"

// rule-evidence: docs/design/vips/0040-module-declarations.md#f7120f477684687d
const rule = "**Loaders and bundlers.** `vibelang/register`, the Bun plugin, Vite and unplugin serve each body's canonical filename from the compiled parent, using the same source basename, encoded name and output suffix as the compiler, cached by the parent's version."
const repo = fileURLToPath(new URL("../../../", import.meta.url))
const register = fileURLToPath(new URL("../register.mjs", import.meta.url))
const preload = fileURLToPath(new URL("../bun.mjs", import.meta.url))
const native = process.env.VIBELANG_BINARY || join(repo, "typescript/built/local/tsc")
const effect = join(process.env.EFFECT_NODE_MODULES || join(repo, "experiments/node_modules"), "effect")
const runtime = join(repo, "packages/runtime")
const bun = process.env.VIBELANG_TEST_BUN || "bun"
const missing = [native, effect, join(runtime, "dist/index.js")].find((path) => !existsSync(path))
const skip = missing !== undefined && `run typescript/vibelang/smoke.sh first; missing ${missing}`
const skipBun = skip || (spawnSync(bun, ["--version"]).status !== 0 && "Bun is required")

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
  "export const all = [a, b, c, d]",
  ""
].join("\n")

function project(t, files) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "vibelang-body-names-")))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  mkdirSync(join(root, "node_modules"))
  symlinkSync(realpathSync(effect), join(root, "node_modules/effect"))
  symlinkSync(runtime, join(root, "node_modules/vibelang-runtime"))
  const compilerOptions = {
    target: "ES2022", module: "NodeNext", moduleResolution: "NodeNext", strict: true, types: [], skipLibCheck: true,
    allowImportingTsExtensions: true, rewriteRelativeImportExtensions: true, noEmit: true, jsx: "react"
  }
  for (const [path, text] of Object.entries({ "package.json": '{"type":"module"}',
    "tsconfig.json": JSON.stringify({ compilerOptions, include: ["src/**/*"] }), ...files })) {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), text)
  }
  return root
}

// The body filenames the compiler itself writes for this project.
function compilerNames(root) {
  const r = spawnSync(native, ["-p", "tsconfig.json", "--noEmit", "false", "--rootDir", "src", "--outDir", "names", "--pretty", "false"], { cwd: root, encoding: "utf8" })
  assert.equal(r.status, 0, r.stdout + r.stderr)
  const names = readdirSync(join(root, "names")).filter((name) => /^(?:main\.vibe|view\.vibex)\./.test(name) && /\.jsx?$/.test(name)).sort()
  rmSync(join(root, "names"), { recursive: true, force: true })
  return names
}

// Records the body URLs the compiled parent requests, and, where the loader
// serves them to any importer (Bun), imports each by its canonical name.
const entry = (names, direct) => [
  "import * as hooks from \"node:module\"",
  "(globalThis as any).React = { createElement: (tag: unknown) => ({ tag }) }",
  "const requested: string[] = []",
  "if (!process.versions.bun) hooks.registerHooks({ resolve(specifier, context, next) { const r = next(specifier, context); if (/\\/src\\/(?:main\\.vibe|view\\.vibex)\\./.test(r.url)) requested.push(r.url.replace(/^.*\\/src\\//, \"\")); return r } })",
  "const parent = await import(\"./main.vibe\")",
  "const view = await import(\"./view.vibex\").catch(() => undefined)",
  "const served: Record<string, unknown> = {}",
  `if (${direct}) for (const name of ${JSON.stringify(names)}) served[name] = { ...(await import("./" + name)) }`,
  "console.log(JSON.stringify({ all: parent.all, view: view && { ...view }, requested: [...new Set(requested)].sort(), served }))",
  ""
].join("\n")

const values = { "main.vibe.-dc-ber.js": { n: 1 }, "main.vibe.-24-x.js": { n: 2 }, "main.vibe.-54-ext.js": { n: 3 },
  "main.vibe.snake_case9.js": { n: 4 }, "view.vibex.parse.js": { element: { tag: "b" } }, "view.vibex.-dc-ber.js": { n: 5 } }

// Runs the entry, edits the body inside the parent, and runs it again with the
// same cache directory: the second run must see the parent's new version.
function runTwice(root, command) {
  const env = { ...process.env, VIBELANG_BINARY: native, VIBELANG_PROJECT: "", VIBELANG_CACHE_DIR: join(root, ".cache") }
  const once = () => {
    const result = spawnSync(command[0], [...command.slice(1), "src/entry.ts"], { cwd: root, encoding: "utf8", env })
    assert.equal(result.status, 0, result.stderr)
    return JSON.parse(result.stdout)
  }
  const first = once()
  writeFileSync(join(root, "src/main.vibe"), parent(10))
  return { first, second: once() }
}

test("vibelang/register serves each body's canonical filename, cached by the parent's version (VIP-40)", { skip }, (t) => {
  assert.ok(rule.includes("`vibelang/register`"))
  const root = project(t, { "src/main.vibe": parent(1), "src/entry.ts": "" })
  const names = compilerNames(root)
  assert.deepEqual(names, ["main.vibe.-24-x.js", "main.vibe.-54-ext.js", "main.vibe.-dc-ber.js", "main.vibe.snake_case9.js"])
  writeFileSync(join(root, "src/entry.ts"), entry(names, false))
  const { first, second } = runTwice(root, [process.execPath, "--import", register])
  assert.deepEqual(first, { all: [1, 2, 3, 4], requested: names, served: {} })
  assert.deepEqual(second, { all: [10, 2, 3, 4], requested: names, served: {} })
})

test("the Bun plugin serves each .vibe and .vibex body's canonical filename, cached by the parent's version (VIP-40)", { skip: skipBun }, (t) => {
  assert.ok(rule.includes("the Bun plugin"))
  const root = project(t, {
    "src/main.vibe": parent(1),
    "src/view.vibex": "module parse { export const element = <b /> }\nmodule Über { export const n = 5 }\nexport { element } from parse\nexport { n } from Über\n",
    "src/jsx.d.ts": "declare namespace JSX { interface Element { tag: unknown } interface IntrinsicElements { b: {} } }\ndeclare namespace React { function createElement(tag: unknown, props: unknown, ...children: unknown[]): JSX.Element }\n",
    "src/entry.ts": ""
  })
  const names = compilerNames(root)
  assert.deepEqual(names.filter((name) => name.startsWith("view.")), ["view.vibex.-dc-ber.js", "view.vibex.parse.js"])
  writeFileSync(join(root, "src/entry.ts"), entry(names, true))
  const { first, second } = runTwice(root, [bun, "--preload", preload])
  const served = Object.fromEntries(names.map((name) => [name, values[name]]))
  assert.deepEqual(first, { all: [1, 2, 3, 4], view: { element: { tag: "b" }, n: 5 }, requested: [], served })
  assert.deepEqual(second, { all: [10, 2, 3, 4], view: { element: { tag: "b" }, n: 5 }, requested: [],
    served: { ...served, "main.vibe.-dc-ber.js": { n: 10 } } })
})
