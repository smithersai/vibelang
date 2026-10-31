import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { trackedLeaks, upstreamFixture } from "./check-tracked-leaks.mjs"

test("scans all tracked source, including new files and VibeLang cases, with local private patterns", (t) => {
  const root = mkdtempSync(join(tmpdir(), "tracked-leaks-"))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  execFileSync("jj", ["git", "init", root], { stdio: "pipe" })
  const put = (path, text) => {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), text)
  }
  const previous = process.env.VIBELANG_LEAK_PATTERNS
  process.env.VIBELANG_LEAK_PATTERNS = JSON.stringify(["private-build\\.example"])
  t.after(() => {
    if (previous === undefined) delete process.env.VIBELANG_LEAK_PATTERNS
    else process.env.VIBELANG_LEAK_PATTERNS = previous
  })
  put("README.md", "Public documentation")
  put("typescript/tests/cases/upstream.ts", "private-build.example")
  put("typescript/tsc/testdata/baselines/output.txt", "private-build.example")
  put("typescript/tsc/internal/fourslash/tests/fixture_test.go", "private-build.example")
  assert.deepEqual(trackedLeaks(root), [])
  put("docs/research/new.md", "private-build.example")
  put("typescript/vibelang/cases/private/main.vibe", "private-build.example")
  put("typescript/tsc/internal/vibelang/new_test.go", "private-build.example")
  const found = trackedLeaks(root)
  assert.equal(found.length, 3)
  assert.ok(found.some(p => p.startsWith("docs/research/new.md:")))
  assert.ok(found.some(p => p.startsWith("typescript/vibelang/cases/private/main.vibe:")))
  assert.ok(found.some(p => p.startsWith("typescript/tsc/internal/vibelang/new_test.go:")))
  assert.ok(found.every(p => !p.includes("private-build.example")))
})

// A hosted //:docs-check failed with ENOENT on packages/runtime/tests/.experimental-node-9951.mjs,
// which //packages:runtime-test wrote and removed while this check read the snapshot.
test("a listed file another target removed is skipped", () => {
  const root = mkdtempSync(join(tmpdir(), "tracked-leaks-"))
  try {
    assert.deepEqual(trackedLeaks(root, ["gone.mjs"]), [])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("fixture exclusions are limited to upstream tests and generated baselines", () => {
  assert.equal(upstreamFixture("typescript/tsc/internal/checker/checker_test.go"), true)
  for (const path of ["docs/test.md", "typescript/VIBELANG.md", "typescript/tsc/internal/checker/vibelang_test.go",
    "typescript/tsc/internal/vibelang/entry_test.go", "typescript/vibelang/cases/test/main.vibe"]) {
    assert.equal(upstreamFixture(path), false, path)
  }
})
