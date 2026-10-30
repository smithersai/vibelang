import assert from "node:assert/strict"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import vibelang from "../src/index.js"

test("each Vite hook returns a source map owned by its caller", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "vibelang-map-"))
  t.after(() => rm(root, { recursive: true, force: true }))
  const source = join(root, "main.vibe")
  await writeFile(source, "export const answer = 42\n")
  const backend = join(root, "node_modules/vibelang")
  await mkdir(backend, { recursive: true })
  await writeFile(join(root, "package.json"), "{}")
  await writeFile(join(backend, "package.json"), JSON.stringify({
    type: "module", exports: { "./project": "./project.mjs" }
  }))
  // The compile backend owns one map per output, reused across hook calls.
  // This fixture only supplies that ownership boundary, without a Go build.
  const expected = { version: 3, sourceRoot: "", sources: [source],
    sourcesContent: ["export const answer = 42\n"], names: [], mappings: "AAAA" }
  await writeFile(join(backend, "project.mjs"), `
const map = ${JSON.stringify(expected)}
export const findCompiler = () => "unused"
export const projects = () => ({
  load: async () => ({ project: "tsconfig.json", code: "export const answer = 42", map, errors: [], warnings: [] }),
  close: async () => {}
})
`)
  const plugin = vibelang()
  plugin.configResolved({ root, logger: { warn: assert.fail } })
  t.after(() => plugin.closeBundle())
  const context = { addWatchFile() {}, error: assert.fail }
  for (const hook of ["transform", "load"]) {
    const request = () => hook === "transform"
      ? plugin.transform.call(context, "", source)
      : plugin.load.call(context, source + ".text.js")
    const result = await request()
    assert.deepEqual(result.map, expected, hook)
    // Vite relativizes sources in place and annotates/deletes map fields.
    result.map.sources[0] = "main.vibe"
    result.map.names.push("consumer")
    delete result.map.sourcesContent
    result.map.ignoreList = [0]
    assert.deepEqual((await request()).map, expected, hook + ": compiler map survives consumer edits")
  }
})
