import assert from "node:assert/strict"
import { readFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { spawnSync } from "node:child_process"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { test } from "node:test"
import fc from "fast-check"
import { formatSource } from "../format.mjs"

// 007-tooling.md: "An unparsable file is reported and left unchanged; formatting is idempotent."
const corpus = JSON.parse(readFileSync(new URL("./format/corpus/smithers-conditional-returns.json", import.meta.url), "utf8"))
const style = { lineWidth: 120, quoteStyle: "alwaysDouble" }

test("adjacent conditional returns reach a fixed point with the bundled formatter", () => {
  const once = formatSource(corpus.source, corpus.file, style)
  assert.equal(formatSource(once, corpus.file, style), once)
})

test("conditional-return layout preserves tagged text across widths and branch counts", () => {
  fc.assert(fc.property(
    fc.integer({ min: 0, max: 8 }),
    fc.constantFrom(80, 100, 120),
    fc.constantFrom("authentication", "authorization_required", "not_found"),
    (extra, lineWidth, reason) => {
      const source = corpus.source
        .replaceAll('"authentication"', JSON.stringify(reason))
        .replace('if (Option.isNone(actor))', 'if (row.status === "retry") return refuse(fields, 409, "retry")\n'.repeat(extra) + 'if (Option.isNone(actor))')
      const once = formatSource(source, corpus.file, { ...style, lineWidth })
      assert.equal(formatSource(once, corpus.file, { ...style, lineWidth }), once)
      const taggedText = /\x60\n[\s\S]*?WHERE id = \$\{terminalId\.toLowerCase\(\)\}\x60/
      assert.equal(once.match(taggedText)?.[0], source.match(taggedText)?.[0], "tagged SQL retains its raw text")
    },
  ), { seed: 41421, numRuns: 24 })
})

test("the compatible JSX formatter preserves generic callbacks and raw child text", () => {
  for (const source of [
    "const el = <p>{x catch <E,>(e: E) => 1}</p>\n",
    "const el = <p> first  second\n third &nbsp; fourth </p>\n",
  ]) {
    for (const file of ["view.vibex", "view.tsx"]) {
      const input = file.endsWith(".tsx") ? "// @vibe\n" + source : source
      const once = formatSource(input, file, style)
      assert.equal(formatSource(once, file, style), once)
      if (source.includes(" first")) assert.ok(once.includes(" first  second\n third &nbsp; fourth "))
    }
  }
})

test("mixed plain and JSX batches retain their compatible formatter paths", () => {
  const dir = mkdtempSync(join(tmpdir(), "vibe-format-conditionals-"))
  try {
    mkdirSync(join(dir, ".jj"))
    writeFileSync(join(dir, "conditions.vibe"), corpus.source)
    writeFileSync(join(dir, "view.vibex"), "const el = <p>{x catch <E,>(e: E) => 1}</p>\n")
    const cli = fileURLToPath(new URL("../bin/vibelang-format", import.meta.url))
    for (const mode of ["--write", "--check"]) {
      const result = spawnSync(process.execPath, [cli, mode, "conditions.vibe", "view.vibex"], {
        cwd: dir, encoding: "utf8", env: { ...process.env, VIBELANG_DISABLE_CACHE: "1" },
      })
      assert.equal(result.status, 0, result.stderr)
    }
    assert.ok(readFileSync(join(dir, "view.vibex"), "utf8").includes("<E,>"))
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
