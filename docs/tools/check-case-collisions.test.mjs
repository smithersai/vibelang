import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { test } from "node:test"
import { caseCollisions } from "./check-case-collisions.mjs"

test("files that differ only by case collide; files that differ by more do not", () => {
  const seeds = "typescript/tsc/internal/vibelangfuzz/testdata/fuzz/FuzzBrandedPrimitiveMatchDomain/"
  assert.deepEqual(caseCollisions([seeds + "boolean-0", seeds + "Boolean-0", seeds + "boolean-1"]),
    [[seeds + "Boolean-0", seeds + "boolean-0"]])
  assert.deepEqual(caseCollisions([seeds + "boolean-0", seeds + "boxed-Boolean-0", "README.md", "readme"]), [])
})

test("a directory that differs only by case collides even when the files under it differ", () => {
  assert.deepEqual(caseCollisions(["docs/Guide/a.md", "docs/guide/b.md"]), [["docs/Guide", "docs/guide"]])
  assert.deepEqual(caseCollisions(["src/Main", "src/main/index.ts"]), [["src/Main", "src/main"]])
})

test("three spellings form one group and each group is reported once", () => {
  assert.deepEqual(caseCollisions(["a/X", "a/x", "b/Readme", "b/README", "b/readme", "b/readme"]),
    [["a/X", "a/x"], ["b/README", "b/Readme", "b/readme"]])
})

test("the command lists the jj snapshot, so a newly added file is checked", (t) => {
  const root = mkdtempSync(join(tmpdir(), "case-collisions-"))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  execFileSync("jj", ["git", "init", root], { stdio: "pipe" })
  mkdirSync(join(root, "docs/tools"), { recursive: true })
  writeFileSync(join(root, "docs/tools/check-case-collisions.mjs"),
    readFileSync(fileURLToPath(new URL("./check-case-collisions.mjs", import.meta.url))))
  writeFileSync(join(root, "number-0"), "")
  const out = execFileSync(process.execPath, ["docs/tools/check-case-collisions.mjs"], { cwd: root, encoding: "utf8" })
  assert.match(out, /no two tracked paths differ only by letter case/)
})
