// Node's own source map support: --enable-source-maps over the compiler's
// output, and vibelang/register, which turns it on for .vibe modules.
import { strict as assert } from "node:assert"
import { join } from "node:path"
import { test } from "node:test"
import { assertFrame, compiler, entry, frames, mainVibe, project, succeed, textVariants } from "./helpers.mjs"

const stacks = (result) => JSON.parse(result.stdout.trim().split("\n").pop())

function assertStacks({ plain, effect }, source = mainVibe) {
  assertFrame(plain, source, 'new Error("MARK_LEAF"')
  assertFrame(plain, source, 'leaf(label + "-m")')
  assertFrame(plain, source, 'middle("p")')
  assertFrame(effect, source, 'new Error("MARK_DIE"')
}

test("node --enable-source-maps reads the compiler's output at .vibe lines and UTF-16 columns", async (t) => {
  const root = project(t, { "entry.mjs": entry("./out/main.js") })
  await succeed(compiler, ["-p", "tsconfig.json"], { cwd: root })
  const result = await succeed(process.execPath, ["--enable-source-maps", "entry.mjs"], { cwd: root })
  assertStacks(stacks(result))
})

test("without the flag the same stack names the emitted JavaScript, so the test above can fail", async (t) => {
  const root = project(t, { "entry.mjs": entry("./out/main.js") })
  await succeed(compiler, ["-p", "tsconfig.json"], { cwd: root })
  const { plain } = stacks(await succeed(process.execPath, ["entry.mjs"], { cwd: root }))
  assert.ok(frames(plain).some((frame) => frame.file.endsWith("main.js")), plain)
  assert.ok(!frames(plain).some((frame) => frame.file.endsWith("main.vibe")), plain)
})

test("vibelang/register gives a .vibe module's frames their .vibe lines", async (t) => {
  const root = project(t)
  const result = await succeed(process.execPath, ["--import", "vibelang/register", join("src", "entry.mjs")], { cwd: root })
  assertStacks(stacks(result))
})

for (const [name, { text, file = text }] of Object.entries(textVariants)) {
  test(`node --enable-source-maps: ${name}`, async (t) => {
    const root = project(t, { "entry.mjs": entry("./out/main.js"), "src/main.vibe": file })
    await succeed(compiler, ["-p", "tsconfig.json"], { cwd: root })
    assertStacks(stacks(await succeed(process.execPath, ["--enable-source-maps", "entry.mjs"], { cwd: root })), text)
  })
  test(`vibelang/register: ${name}`, async (t) => {
    const root = project(t, { "src/main.vibe": file })
    assertStacks(stacks(await succeed(process.execPath, ["--import", "vibelang/register", join("src", "entry.mjs")], { cwd: root })), text)
  })
}
