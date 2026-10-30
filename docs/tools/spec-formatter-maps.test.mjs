import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { chapter, repo } from "./spec-witness.mjs"

test("the formatter contract preserves code and diagnostics, and refreshes source-map provenance", () => {
  const text = chapter("007-tooling")
  for (const term of ["diagnostic codes", "compiler-generated source-map", "`sourcesContent`", "unparsable"]) {
    assert.ok(text.includes(term), `the formatter contract omits ${term}`)
  }
})

// This runs the TypeScript source-map witness. It establishes the counterpart,
// not conformance of the VibeLang formatter or its migration rules.
const compiler = process.env.VIBELANG_TSC || join(repo, "packages/compiler/native/vibelang")
test("inline maps must change after layout changes even when executable emission is identical", {
  skip: !existsSync(compiler) && "build the native compiler with sh scripts/build-vibelang.sh",
}, () => {
  const directory = mkdtempSync(join(tmpdir(), "vibe-formatter-map-"))
  const source = join(directory, "input.ts")
  const out = join(directory, "out")
  try {
    const emit = (text) => {
      writeFileSync(source, text)
      const result = spawnSync(compiler, ["--ignoreConfig", "--pretty", "false", "--strict", "--target", "es2022", "--module", "esnext", "--inlineSourceMap", "--inlineSources", "--outDir", out, source], { encoding: "utf8" })
      assert.equal(result.status, 0, result.stdout + result.stderr)
      const javascript = readFileSync(join(out, "input.js"), "utf8")
      const trailer = /\/\/# sourceMappingURL=data:application\/json;base64,([^\r\n]+)\r?\n?$/
      const match = trailer.exec(javascript)
      assert.ok(match, "missing compiler-generated inline map")
      const map = JSON.parse(Buffer.from(match[1], "base64").toString("utf8"))
      assert.deepEqual(map.sourcesContent, [text])
      return { javascript, code: javascript.slice(0, match.index), map }
    }
    const before = emit("export const n=1\n")
    const after = emit("export const n = 1;\n")
    assert.equal(before.code, after.code)
    assert.notEqual(before.javascript, after.javascript)
    assert.notEqual(before.map.mappings, after.map.mappings)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
