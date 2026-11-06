// Bun as a runtime. Bun reads a source map only from a file marked `// @bun`:
// vibelang/bun marks the modules it can, and packages/compiler/test/bun-source-map.test.mjs
// holds the modules it cannot. docs/maintainers/source-maps.md.
import { strict as assert } from "node:assert"
import { test } from "node:test"
import { assertFrameLine, compiler, entry, frames, mainVibe, project, succeed } from "./helpers.mjs"

const stacks = (result) => JSON.parse(result.stdout.trim().split("\n").pop())
const ascii = mainVibe.replaceAll("\u{1F600}", "e")

test("vibelang/bun gives an ASCII .vibe module's frames their .vibe lines", async (t) => {
  const root = project(t, { "src/main.vibe": ascii })
  const { plain, effect } = stacks(await succeed("bun", ["--preload", "vibelang/bun", "src/entry.mjs"], { cwd: root }))
  assertFrameLine(plain, ascii, 'new Error("MARK_LEAF"')
  assertFrameLine(plain, ascii, 'leaf(label + "-m")')
  assertFrameLine(plain, ascii, 'middle("p")')
  assertFrameLine(effect, ascii, 'new Error("MARK_DIE"')
})

test("bun reads no map beside plain JavaScript: a stack names the emitted file", async (t) => {
  const root = project(t, { "entry.mjs": entry("./out/main.js") })
  await succeed(compiler, ["-p", "tsconfig.json"], { cwd: root })
  const { plain } = stacks(await succeed("bun", ["entry.mjs"], { cwd: root }))
  // A named limitation. When this fails Bun reads such maps: update the docs.
  assert.ok(frames(plain).some((frame) => frame.file.endsWith("main.js")), plain)
  assert.ok(!frames(plain).some((frame) => frame.file.endsWith("main.vibe")), plain)
})
