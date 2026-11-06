// What an error tracker such as Sentry does with a production stack: it holds
// a minified bundle's map, and resolves each frame of a stack the bundle
// printed to a .vibe line and the source context around it, with a real
// consumer. The stack comes from running the minified bundle.
import { strict as assert } from "node:assert"
import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import { SourceMapConsumer } from "source-map"
import { minify } from "terser"
import { frames, locate, mainVibe, project, readJSON, succeed } from "./helpers.mjs"

const bundle = fileURLToPath(new URL("./bundle.mjs", import.meta.url))
const stacks = (result) => JSON.parse(result.stdout.trim().split("\n").pop())

/** Each frame of `stack` in `bundle`, as the tracker resolves it: file, line, and the source line it shows. */
async function resolveStack(stack, map, name) {
  const consumer = await new SourceMapConsumer(map)
  try {
    return frames(stack).filter((frame) => frame.file.endsWith(name)).map((frame) => {
      const original = consumer.originalPositionFor({ line: frame.line, column: frame.column - 1 })
      const content = original.source && consumer.sourceContentFor(original.source, true)
      return { ...original, context: content?.split(/\r\n|\n/)[original.line - 1] }
    })
  } finally {
    consumer.destroy()
  }
}

function assertResolved(resolved, needle) {
  const { line } = locate(mainVibe, needle, "main.vibe")
  const frame = resolved.find((candidate) => candidate.line === line)
  assert.ok(frame, `no frame at .vibe line ${line} (${needle}): ${JSON.stringify(resolved)}`)
  assert.ok(frame.source.endsWith("main.vibe"), frame.source)
  assert.ok(frame.context.includes(needle), `the tracker shows ${JSON.stringify(frame.context)}`)
}

test("a minified esbuild stack resolves to .vibe lines and their source context", async (t) => {
  const root = project(t)
  await succeed(process.execPath, [bundle, "esbuild-minify"], { cwd: root })
  const file = join(root, "out/main.js")
  const { plain } = stacks(await succeed(process.execPath, [file], { cwd: root }))
  const resolved = await resolveStack(plain, readJSON(file + ".map"), "main.js")
  assertResolved(resolved, 'new Error("MARK_LEAF"')
  assertResolved(resolved, 'leaf(label + "-m")')
  assertResolved(resolved, 'middle("p")')
})

test("rollup, then terser, keeps three maps' worth of .vibe lines", async (t) => {
  const root = project(t)
  await succeed(process.execPath, [bundle, "rollup"], { cwd: root })
  const file = join(root, "out/main.js")
  const minified = await minify(readFileSync(file, "utf8").replace(/\/\/# sourceMappingURL=.*$/m, ""), {
    module: true, compress: false, mangle: true,
    sourceMap: { content: readFileSync(file + ".map", "utf8"), url: "main.js.map" }
  })
  writeFileSync(file, minified.code)
  writeFileSync(file + ".map", minified.map)
  const { plain } = stacks(await succeed(process.execPath, [file], { cwd: root }))
  const resolved = await resolveStack(plain, JSON.parse(minified.map), "main.js")
  assertResolved(resolved, 'new Error("MARK_LEAF"')
  assertResolved(resolved, 'leaf(label + "-m")')
  assertResolved(resolved, 'middle("p")')
})

test("Sentry's Vite plugin keeps the map through its debug ID injection", async (t) => {
  const root = project(t)
  await succeed(process.execPath, [bundle, "vite-sentry"], { cwd: root })
  const file = join(root, "out/main.js")
  const code = readFileSync(file, "utf8")
  assert.match(code, /_sentryDebugIds/, "the plugin injected its debug ID")
  const { plain } = stacks(await succeed(process.execPath, [file], { cwd: root }))
  const resolved = await resolveStack(plain, readJSON(file + ".map"), "main.js")
  assertResolved(resolved, 'new Error("MARK_LEAF"')
  assertResolved(resolved, 'middle("p")')
})
