// vibelang/babel: Babel, with the React Compiler, reads .vibe modules.
import { strict as assert } from "node:assert"
import { createRequire } from "node:module"
import { join } from "node:path"
import { test } from "node:test"
import { compilerPackage, hooks, project, refReadLine } from "./helpers.mjs"

const require = createRequire(import.meta.url)
const babel = require("@babel/core")
const reactCompiler = require.resolve("babel-plugin-react-compiler")

function compile(root, file, presets = [join(compilerPackage, "babel.cjs")]) {
  const events = []
  const result = babel.transformFileSync(join(root, file), {
    babelrc: false, configFile: false, cwd: root, presets,
    plugins: [[reactCompiler, { logger: { logEvent: (_, event) => events.push(event) } }]]
  })
  const bailouts = events
    .filter((event) => event.kind === "CompileError" || event.kind === "CompileSkip")
    .map((event) => ({ line: (event.detail?.options?.loc ?? event.detail?.options?.details?.[0]?.loc ?? event.detail?.loc)?.start?.line, reason: event.detail?.options?.reason ?? event.detail?.reason }))
  return { code: result.code, bailouts }
}

test("without the preset Babel cannot parse a .vibe module", (t) => {
  const root = project(t, hooks, ["react", "@types/react"])
  assert.throws(() => compile(root, "src/useLabel.vibe", []), SyntaxError)
})

test("the React Compiler memoizes a clean .vibe hook", (t) => {
  const root = project(t, hooks, ["react", "@types/react"])
  const { code, bailouts } = compile(root, "src/useLabel.vibe")
  assert.deepEqual(bailouts, [])
  assert.match(code, /react\/compiler-runtime/)
})

test("the React Compiler reports a .vibe hook's violation at its .vibe line", (t) => {
  const root = project(t, hooks, ["react", "@types/react"])
  const { code, bailouts } = compile(root, "src/useLatest.vibe")
  assert.equal(bailouts.length, 1, JSON.stringify(bailouts))
  assert.equal(bailouts[0].line, refReadLine)
  assert.doesNotMatch(code, /react\/compiler-runtime/)
})

test("JavaScript already compiled from a .vibe module parses as it is", (t) => {
  const root = project(t, hooks, ["react", "@types/react"])
  const { code } = babel.transformSync("export const n = 1\n", {
    babelrc: false, configFile: false, cwd: root, filename: join(root, "src/useLabel.vibe"), presets: [join(compilerPackage, "babel.cjs")]
  })
  assert.equal(code, "export const n = 1;")
})
