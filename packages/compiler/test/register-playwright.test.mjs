import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"

const repo = fileURLToPath(new URL("../../../", import.meta.url))
const register = fileURLToPath(new URL("../register.mjs", import.meta.url))
const native = process.env.VIBELANG_BINARY || join(repo, "typescript/built/local/tsc")
const modules = process.env.EFFECT_NODE_MODULES || join(repo, "experiments/node_modules")
const tooling = createRequire(join(process.env.PLAYWRIGHT_NODE_MODULES || join(repo, "packages/runtime/node_modules"), "_resolve.cjs"))
const missing = [native, join(modules, "effect"), join(repo, "packages/runtime/dist/index.js")].find(path => !existsSync(path))
const skip = missing && `build the compiler and runtime first; missing ${missing}`
const source = readFileSync(new URL("./fixtures/alchemy-tool-entry-loaders/answer.vibe", import.meta.url), "utf8")

function fixture(t, extra = {}) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "vibelang-playwright-")))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const files = {
    "package.json": '{"type":"module"}',
    "tsconfig.json": JSON.stringify({
      compilerOptions: { target: "ES2022", module: "NodeNext", moduleResolution: "NodeNext", strict: true,
        types: [], skipLibCheck: true, allowImportingTsExtensions: true, noEmit: true },
      include: ["src/**/*"]
    }),
    "src/answer.vibe": source,
    ...extra
  }
  for (const [name, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, name)), { recursive: true })
    writeFileSync(join(root, name), content)
  }
  mkdirSync(join(root, "node_modules"))
  symlinkSync(realpathSync(join(modules, "effect")), join(root, "node_modules/effect"))
  // Install the runtime's published files: a source-checkout symlink makes
  // Playwright transform its already-built JS as application code.
  const runtime = join(root, "node_modules/vibelang-runtime")
  mkdirSync(runtime)
  cpSync(join(repo, "packages/runtime/package.json"), join(runtime, "package.json"))
  cpSync(join(repo, "packages/runtime/dist"), join(runtime, "dist"), { recursive: true })
  symlinkSync(join(repo, "packages/compiler"), join(root, "node_modules/vibelang"))
  const run = (args, env = {}) => spawnSync(process.execPath, args, {
    cwd: root, encoding: "utf8", timeout: 120000,
    env: { ...process.env, NODE_OPTIONS: "", VIBELANG_BINARY: native, VIBELANG_PROJECT: "",
      VIBELANG_CACHE_DIR: join(root, ".cache"), ...env }
  })
  return { root, run }
}

test("a later JavaScript loader delegates native modules using their custom format", { skip }, t => {
  const { run } = fixture(t, {
    "later.mjs": `import { registerHooks } from "node:module"
registerHooks({
  load(url, context, nextLoad) {
    if (url.includes(".vibe") && [undefined, null, "module", "commonjs"].includes(context.format)) {
      throw new Error("JavaScript parser received native source")
    }
    return nextLoad(url, context)
  }
})
`,
    "entry.mjs": `import { Effect } from "effect"
import { answer, boom } from "./src/answer.vibe"
import assert from "node:assert/strict"
assert.equal(Effect.runSync(answer), 42)
assert.throws(boom, error => /answer\\.vibe:5:/.test(error.stack))
console.log("native-loaded")
`
  })
  const result = run(["--import", register, "--import", "./later.mjs", "entry.mjs"])
  assert.equal(result.status, 0, result.stdout + result.stderr)
  assert.equal(result.stdout, "native-loaded\n")
})

for (const configExtension of ["ts", "vibe"]) {
  test(`Playwright loads a .${configExtension} config and native test dependencies in workers`, { skip }, t => {
    const config = `import { Effect } from "effect"
import { answer } from "./src/answer.vibe"
export default { testDir: "./tests", metadata: { answer: Effect.runSync(answer) }, workers: 1, reporter: "line" }
`
    const { root, run } = fixture(t, {
      [`playwright.config.${configExtension}`]: config,
      ...(configExtension === "vibe" ? { "tsconfig.json": JSON.stringify({
        compilerOptions: { target: "ES2022", module: "NodeNext", moduleResolution: "NodeNext", strict: true,
          types: [], skipLibCheck: true, allowImportingTsExtensions: true, noEmit: true },
        include: ["src/**/*", "playwright.config.vibe"]
      }) } : {}),
      "tests/entry.spec.ts": `import { test, expect } from "playwright/test"
import { Effect } from "effect"
import { answer, boom } from "../src/answer.vibe"
test("native value and source map", () => {
  expect(Effect.runSync(answer)).toBe(42)
  let stack = ""
  try { boom() } catch (error) { stack = String(error.stack) }
  expect(stack).toMatch(/answer\\.vibe:5:/)
})
`
    })
    const playwright = dirname(tooling.resolve("playwright/package.json"))
    symlinkSync(playwright, join(root, "node_modules/playwright"))
    const result = run([join(playwright, "cli.js"), "test", "--config", `playwright.config.${configExtension}`],
      { NODE_OPTIONS: "--import=vibelang/register" })
    assert.equal(result.status, 0, result.stdout + result.stderr)
    assert.match(result.stdout, /1 passed/)
  })
}

test("generated native paths retain URL identity through later hooks", { skip }, async t => {
  const fc = tooling("fast-check")
  // Node's load context accepts any format string; the load hook translates it
  // to a supported final format (node:module, Synchronous load documentation).
  await fc.assert(fc.asyncProperty(fc.uniqueArray(fc.tuple(
    fc.constantFrom("space name", "hash#name", "accent-é", "percent%name"),
    fc.integer({ min: 0, max: 100000 })).map(([name, suffix]) => `${name}-${suffix}`),
    { minLength: 2, maxLength: 4 }), fc.integer({ min: 0, max: 12 }), async (names, padding) => {
  const files = Object.fromEntries(names.map(name => [`src/${name}.vibe`, "\n".repeat(padding) + source]))
  const { run } = fixture(t, {
    ...files,
    "later.mjs": `import { registerHooks } from "node:module"
registerHooks({ load(url, context, nextLoad) {
  if (url.includes(".vibe") && [undefined, null, "module", "commonjs"].includes(context.format)) throw new Error("missing native format")
  return nextLoad(url, context)
} })
`,
    "entry.mjs": `import assert from "node:assert/strict"
import { Effect } from "effect"
import "vibelang-runtime"
Error.prepareStackTrace = (error, frames) => frames.map(frame => ({ file: frame.getFileName(), line: frame.getLineNumber() }))
for (const name of ${JSON.stringify(names)}) {
  const url = new URL("./src/" + encodeURIComponent(name) + ".vibe?version=1#same", import.meta.url)
  const a = await import(url.href)
  const b = await import(url.href)
  assert.equal(a, b)
  assert.equal(Effect.runSync(a.answer), 42)
  let frames
  try { a.boom() } catch (error) { frames = error.stack }
  assert.equal(frames[0].line, ${padding + 5})
  assert.equal(frames[0].file, new URL("./src/" + encodeURIComponent(name) + ".vibe", import.meta.url).href)
}
console.log("generated-loaded")
`
  })
  const result = run(["--import", register, "--import", "./later.mjs", "entry.mjs"])
  assert.equal(result.status, 0, result.stdout + result.stderr)
  assert.equal(result.stdout, "generated-loaded\n")
  }), { seed: 513051, numRuns: 8 })
})


test("NODE_OPTIONS serves a direct native Node entry and inherited child processes", { skip }, t => {
  const { run } = fixture(t, {
    "src/entry.vibe": 'await runPromise(Console.log("native-entry"))\n',
    "entry.cjs": `const { spawnSync } = require("node:child_process")
const result = spawnSync(process.execPath, ["src/entry.vibe"], { encoding: "utf8" })
process.stdout.write(result.stdout)
process.stderr.write(result.stderr)
process.exitCode = result.status ?? 1
`
  })
  for (const entry of ["src/entry.vibe", "entry.cjs"]) {
    const result = run([entry], { NODE_OPTIONS: "--import=vibelang/register" })
    assert.equal(result.status, 0, result.stdout + result.stderr)
    assert.equal(result.stdout, "native-entry\n")
  }
})


test("custom stack formatters keep structured results and native source locations", { skip }, t => {
  const { run } = fixture(t, {
    "entry.mjs": `import assert from "node:assert/strict"
import "vibelang-runtime"
Error.prepareStackTrace = (error, frames) => ({
  message: error.message,
  frames: frames.map(frame => ({
    file: frame.getFileName(), line: frame.getLineNumber(),
    column: frame.getColumnNumber(), text: frame.toString(), name: frame.getFunctionName()
  }))
})
const { boom } = await import("./src/answer.vibe")
let stack
try { boom() } catch (error) { stack = error.stack }
assert.equal(typeof stack, "object")
assert.match(stack.message, /length/)
assert.equal(stack.frames[0].line, 5)
assert.match(stack.frames[0].file, /answer\\.vibe$/)
assert.match(stack.frames[0].text, /answer\\.vibe:5:/)
assert.equal(stack.frames[0].name, "boom")
assert.match(stack.frames[1].file, /entry\\.mjs$/)
console.log("custom-mapped")
`
  })
  const result = run(["--import", register, "entry.mjs"])
  assert.equal(result.status, 0, result.stdout + result.stderr)
  assert.equal(result.stdout, "custom-mapped\n")
})
