import assert from "node:assert/strict"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import fc from "fast-check"
import { projects, projectImports } from "../project.mjs"
import { checkProperty } from "../../../scripts/testing/property.mjs"

const repo = fileURLToPath(new URL("../../../", import.meta.url))
const compiler = process.env.VIBELANG_BINARY || join(repo, "packages/compiler/native/vibelang")
const options = { target: "ES2022", module: "ESNext", moduleResolution: "Bundler", strict: true, skipLibCheck: true, types: [] }

test("project diagnostics distinguish included sources outside the compilation root from missing includes", async () => {
  async function check(name) {
    const root = await mkdtemp(join(tmpdir(), "vibelang-root-guidance-"))
    try {
    const app = join(root, "app"), shared = join(root, name), project = join(root, "tsconfig.json")
    await mkdir(app); await mkdir(shared)
    await writeFile(join(root, "package.json"), '{"type":"module"}')
    await writeFile(project, JSON.stringify({ compilerOptions: options, include: ["app/main.vibe", name] }))
    const source = join(shared, "value.vibe"), excluded = join(app, "excluded.vibe")
    await writeFile(source, "export const value = 42\n")
    await writeFile(join(app, "main.vibe"), "export const main = 1\n")
    await writeFile(excluded, "export const excluded = 1\n")
    const listing = projectImports({ root, project, compiler })
    assert.ok(listing.files.includes(source), "the native compiler already includes the outside source")
    assert.ok(!listing.files.includes(excluded), "the inside witness really is excluded")
    const trace = []
    const narrow = projects({ root: app, project, compiler, cache: false, debug: line => trace.push(line) })
    try {
      const result = await narrow.load(source)
      assert.equal(result.errors.length, 0)
      assert.ok(result.error, "the documented root boundary remains enforced")
      assert.match(result.error.message, /outside the compilation root/)
      assert.ok(result.error.message.includes(app), result.error.message)
      assert.doesNotMatch(result.error.message, /Add it to the tsconfig's include/)
      assert.ok(result.error.message.includes("root") && result.error.message.includes("package"), "guidance names both supported remedies")
      assert.ok(trace.some(line => line.includes("outsideRoot=true") && line.includes("listed=")), trace.join("\n"))
      const missing = await narrow.load(excluded)
      assert.match(missing.error.message, /Add it to the tsconfig's include/, "an actually excluded source keeps its include guidance")
    } finally { await narrow.close() }
    const wide = projects({ root, project, compiler, cache: false })
    try {
      const result = await wide.load(source)
      assert.ok(!result.error, "a containing compilation root serves the source")
      assert.match(result.code, /value = 42/)
    } finally { await wide.close() }
    await writeFile(join(shared, "package.json"), '{"type":"module"}')
    await writeFile(join(shared, "tsconfig.json"), JSON.stringify({ compilerOptions: options, include: ["."] }))
    const separate = projects({ root: app, project, compiler, cache: false })
    try {
      const result = await separate.load(source)
      assert.ok(!result.error, "an external package with its own project serves the source")
      assert.match(result.code, /value = 42/)
    } finally {
      await separate.close()
    }
    } finally { await rm(root, { recursive: true, force: true }) }
  }
  for (const name of ["shared", "shared space", "shared-é%20"]) await check(name)
  await checkProperty(fc, {
    name: "project-outside-root-guidance",
    rule: "packages/vite/README.md: The Vite root must contain the project's source files",
    arbitrary: fc.array(fc.constantFrom("a", "é", "日", " ", "%", "2", "0"), { minLength: 1, maxLength: 8 }).map(chars => "shared-" + chars.join("")),
    numRuns: 12, check, command: "node --test test/project-root-diagnostics.property.test.mjs"
  })
})
