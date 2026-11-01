// vibelang/emit's toolArguments: oxc-transform-react's React Compiler checks
// a .vibe module's emitted JavaScript, as it checks the TypeScript twin.
import { strict as assert } from "node:assert"
import { cpSync, readFileSync, realpathSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { test } from "node:test"
import { pathToFileURL } from "node:url"
import { transform } from "oxc-transform-react"
import { compilerPackage, hooks, project, tools } from "./helpers.mjs"

const { toolArguments } = await import(join(compilerPackage, "emit.mjs"))
// apps/web/src/reactCompilerCoverage.test.ts's options in t3code.
const options = { jsx: { runtime: "automatic", development: false, refresh: false }, reactCompiler: { reportDiagnostics: true } }
const messages = (result) => result.errors.map((error) => error.message)

test("the React Compiler cannot parse a .vibe module's source", async (t) => {
  const root = project(t, hooks, ["react", "@types/react"])
  const file = join(root, "src/useLabel.vibe")
  assert.notDeepEqual(messages(await transform(file, readFileSync(file, "utf8"), options)), [])
})

for (const [name, expected] of [["useLabel", []], ["useLatest", ["Cannot access refs during render"]]]) {
  test(`the React Compiler checks ${name}.vibe as it checks ${name}.ts`, async (t) => {
    const root = project(t, hooks, ["react", "@types/react"])
    const file = join(root, `src/${name}.vibe`)
    const vibe = await transform(...toolArguments(file, readFileSync(file, "utf8"), options))
    const twin = await transform(file.replace(/\.vibe$/, ".ts"), hooks[`src/${name}.vibe`], options)
    assert.deepEqual(messages(vibe), expected)
    assert.deepEqual(messages(vibe), messages(twin))
    assert.equal(vibe.code, twin.code)
  })
}

test("toolArguments passes other files and compiled text through", (t) => {
  const root = project(t, hooks, ["react", "@types/react"])
  const file = join(root, "src/useLabel.vibe")
  assert.deepEqual(toolArguments(file, "export const n = 1\n", options), [file, "export const n = 1\n", options])
  assert.deepEqual(toolArguments(join(root, "a.ts"), "x", options), [join(root, "a.ts"), "x", options])
})

// The migrate flow's patch of oxc-transform-react (lib/react-tools.mjs), on
// the release package.json pins: t3code's coverage test, unchanged, passes a
// .vibe module's source text, and the React Compiler checks its JavaScript.
test("the patched oxc-transform-react checks a .vibe module that a test reads from disk", async (t) => {
  const root = project(t, hooks, ["react", "@types/react", "@oxc-transform-react"])
  const { patchTransformEntry } = await import(join(compilerPackage, "../../.smithers/flows/migrate/lib/react-tools.mjs"))
  const installed = join(tools, "oxc-transform-react")
  const copy = join(root, "node_modules/oxc-transform-react")
  cpSync(realpathSync(installed), copy, { recursive: true })
  writeFileSync(join(copy, "index.js"), patchTransformEntry(readFileSync(join(copy, "index.js"), "utf8")))
  const patched = await import(pathToFileURL(join(copy, "index.js")))
  for (const [name, expected] of [["useLabel", []], ["useLatest", ["Cannot access refs during render"]]]) {
    const file = join(root, `src/${name}.vibe`)
    const result = await patched.transform(file, readFileSync(file, "utf8"), options)
    assert.deepEqual(messages(result), expected)
    assert.deepEqual(messages(patched.transformSync(file, readFileSync(file, "utf8"), options)), expected)
  }
})
