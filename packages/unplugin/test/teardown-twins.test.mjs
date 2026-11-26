// The teardown contract through the real esbuild and webpack APIs and the real
// compiler: esbuild's onDispose and webpack's shutdown hook end a build whose
// compile is running, and no compiler process or pipe outlives them.
// lifecycle.test.mjs covers the same contract through Rollup's hooks, with
// stub compilers for the termination cases a real compiler cannot reproduce.
// esbuild's dispose() waits for the build in flight, so a compiler that
// ignores SIGTERM would hang esbuild itself; that case stays in the stub suite.
import assert from "node:assert/strict"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { setTimeout as delay } from "node:timers/promises"
import esbuild from "esbuild"
import webpack from "webpack"
import { findBinary } from "../../compiler/binary.mjs"
import vibelangEsbuild from "../src/esbuild.js"
import vibelangWebpack from "../src/webpack.js"

const compiler = findBinary()
const running = () => process._getActiveHandles().filter((handle) => handle.spawnargs?.includes(compiler))

async function project(t) {
  const root = await mkdtemp(join(tmpdir(), "vibelang-teardown-"))
  t.after(() => rm(root, { recursive: true, force: true }))
  await writeFile(join(root, "tsconfig.json"), JSON.stringify({
    compilerOptions: { types: [], skipLibCheck: true, target: "esnext", module: "esnext", moduleResolution: "bundler" },
    files: ["main.vibe"]
  }))
  await writeFile(join(root, "main.vibe"), "export const answer = 42\n")
  return root
}

// Polls the event loop's handles, not the wall clock: the compile is observed
// as a live child process before teardown starts.
async function activeCompile() {
  for (;;) {
    const children = running()
    if (children.length) return children
    await delay(5)
  }
}

function released(children) {
  for (const child of children) {
    assert.ok(child.exitCode !== null || child.signalCode !== null, "teardown waited for the compiler to exit")
    assert.ok(child.stdout.destroyed && child.stderr.destroyed, "both compiler pipes are closed")
  }
  const handles = process._getActiveHandles()
  assert.ok(children.every((child) => !handles.includes(child) && !handles.includes(child.stdout) && !handles.includes(child.stderr)),
    "no compiler process or pipe handle remains")
  assert.deepEqual(running(), [])
}

test("esbuild dispose during a compile releases the compiler", { timeout: 120000 }, async (t) => {
  const root = await project(t)
  const context = await esbuild.context({
    absWorkingDir: root, entryPoints: [join(root, "main.vibe")], bundle: true, write: false, format: "esm",
    logLevel: "silent", plugins: [vibelangEsbuild({ root, compiler })]
  })
  t.after(() => context.dispose())
  const building = context.rebuild()
  const children = await activeCompile()
  await context.dispose()
  const result = await building
  assert.match(result.outputFiles[0].text, /answer = 42/)
  released(children)
})

test("webpack shutdown during a watched compile releases the compiler", { timeout: 120000 }, async (t) => {
  const root = await project(t)
  const bundler = webpack({
    context: root, mode: "development", devtool: false, target: "node", entry: join(root, "main.vibe"),
    output: { path: join(root, "out"), filename: "main.cjs", library: { type: "commonjs2" } },
    plugins: [vibelangWebpack({ root, compiler })]
  })
  let failure
  const watching = bundler.watch({}, (error, stats) => { failure ??= error ?? (stats?.hasErrors() ? stats.toString("errors-only") : undefined) })
  const children = await activeCompile()
  await new Promise((resolve) => watching.close(resolve))
  await new Promise((resolve, reject) => bundler.close((error) => (error ? reject(error) : resolve())))
  assert.equal(failure, undefined)
  assert.match(await readFile(join(root, "out/main.cjs"), "utf8"), /answer = 42/)
  released(children)
})
