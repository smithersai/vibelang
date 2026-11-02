import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import { EXEMPT, exemption, guard, literals, rewrite, stubVersion } from "../lib/literals.mjs"

test("a literal moves only as a whole version", () => {
  assert.equal(
    rewrite('effect@4.1.0 "4.1.0" Effect 4.1.0. ^4.1.0 v4.1.0 14.1.0 4.1.0.1 4.1.0-next.1 4.1.0x effect-4.1.0/', "4.1.0", "4.1.1"),
    'effect@4.1.1 "4.1.1" Effect 4.1.1. ^4.1.1 v4.1.1 14.1.0 4.1.0.1 4.1.0-next.1 4.1.0x effect-4.1.1/'
  )
})

test("the pin guards, lockfiles, manifests and fixtures keep the old version", () => {
  for (const file of ["package.json", "packages/runtime/package.json", "packages/runtime/bun.lock", "site/package-lock.json",
    ".smithers/flows/effect-bump/eval.ts", ".smithers/flows/migrate/test/corpus/x.json", "packages/runtime/tests/package.test.ts",
    "typescript/tsc/internal/vibelang/effect_pin_test.go", "typescript/tsc/internal/vibelang/testdata/effect-pin/effect-4.1.0/index.d.ts"]) {
    assert.ok(exemption(file), file)
  }
  for (const file of ["docs/user/src/setup/release-notes.md", "packages/runtime/tests/kernel.property.test.ts", "typescript/vibelang/cases/a/run.mjs",
    ".smithers/token-compare/README.md", "typescript/tsc/internal/vibelang/effect_pin_helper.go"]) {
    assert.equal(exemption(file), undefined, file)
  }
  assert.ok(EXEMPT.every(([, why]) => why.length > 10))
  assert.ok(guard(exemption("typescript/tsc/internal/vibelang/effect_pin_test.go")))
  assert.ok(!guard(exemption(".smithers/flows/migrate/test/corpus/x.json")) && !guard(exemption("packages/runtime/bun.lock")))
})

test("a stub of an Effect package moves its own version; other manifests stay", () => {
  assert.equal(stubVersion('{"name":"@effect/platform-bun","version":"4.1.0","type":"module"}', "4.1.0", "4.1.1"), '{"name":"@effect/platform-bun","version":"4.1.1","type":"module"}')
  assert.equal(stubVersion('{\n  "name": "effect",\n  "version": "4.1.0"\n}\n', "4.1.0", "4.1.1"), '{\n  "name": "effect",\n  "version": "4.1.1"\n}\n')
  assert.equal(stubVersion('{"name":"vitest","version":"4.1.0"}', "4.1.0", "4.1.1"), undefined)
  assert.equal(stubVersion('{"name":"@effect/language-service","version":"4.1.0"}', "4.1.0", "4.1.1"), undefined)
  assert.equal(stubVersion('{"name":"@effect/vitest","version":"4.0.6"}', "4.1.0", "4.1.1"), undefined)
  assert.equal(stubVersion("not json", "4.1.0", "4.1.1"), undefined)
})

test("literals rewrites the tracked text files it may and reports the exempt ones", (t) => {
  const repo = mkdtempSync(join(tmpdir(), "effect-bump-literals-"))
  t.after(() => rmSync(repo, { recursive: true, force: true }))
  const files = {
    "docs/install.md": "npm install effect@4.1.0\n",
    "packages/runtime/tests/kernel.property.test.ts": 'expect(version).toBe("4.1.0")\n',
    "packages/runtime/tests/package.test.ts": 'const rejected = ["4.1.0", "4.1.2"]\n',
    "cases/a/stubs/platform-node/package.json": '{"name":"@effect/platform-node","version":"4.1.0"}',
    "cases/a/package.json": '{"dependencies":{"vitest":"4.1.0"}}',
    "docs/other.md": "nothing to move\n",
    "binary.bin": "4.1.0\0"
  }
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(dirname(join(repo, file)), { recursive: true })
    writeFileSync(join(repo, file), text)
  }
  const result = literals(repo, "4.1.0", "4.1.1", [...Object.keys(files), "deleted.md"])
  assert.deepEqual(result.changed, ["docs/install.md", "packages/runtime/tests/kernel.property.test.ts", "cases/a/stubs/platform-node/package.json"])
  assert.deepEqual(result.kept.map((k) => k.file), ["packages/runtime/tests/package.test.ts", "cases/a/package.json"])
  assert.equal(readFileSync(join(repo, "docs/install.md"), "utf8"), "npm install effect@4.1.1\n")
  assert.equal(readFileSync(join(repo, "packages/runtime/tests/package.test.ts"), "utf8"), files["packages/runtime/tests/package.test.ts"])
  assert.equal(readFileSync(join(repo, "binary.bin"), "utf8"), files["binary.bin"])
})

// Walks the checkout rather than asking jj: //:release runs in a tree with no .jj.
const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url))
const SKIP = new Set(["node_modules", ".jj", ".git", ".flows", ".cache", "dist", "out", "built"])
function files(dir = "", out = []) {
  for (const entry of readdirSync(join(repoRoot, dir), { withFileTypes: true })) {
    if (SKIP.has(entry.name) || entry.name.startsWith(".smthrs")) continue
    const rel = dir ? `${dir}/${entry.name}` : entry.name
    if (entry.isDirectory()) files(rel, out)
    else out.push(rel)
  }
  return out
}

test("each exemption names files that exist, so a moved guard leaves no stale line", () => {
  const all = files()
  assert.deepEqual(EXEMPT.map(([glob]) => glob).filter((glob) => !all.some((file) => exemption(file) === glob)), [])
})
