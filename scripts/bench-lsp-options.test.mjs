import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"

const script = process.env.VIBELANG_LSP_BENCH_SCRIPT ?? fileURLToPath(new URL("./bench/lsp.mjs", import.meta.url))

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "vibelang-lsp-options-"))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  // Missing paths make every old input safe, even Infinity: directory
  // discovery fails before a child can be spawned or the hover loop starts.
  const server = join(root, "missing-server")
  const project = join(root, "missing-project")
  return { server, project, run(args, invalid = true) {
    const result = spawnSync(process.execPath, [script, ...args], { cwd: root, encoding: "utf8", timeout: 10_000 })
    const context = JSON.stringify(args) + "\n" + result.stdout + result.stderr
    assert.equal(result.error, undefined, context)
    assert.equal(result.status, invalid ? 2 : 1, context)
    if (invalid) {
      assert.match(result.stderr, /usage: lsp.mjs/, context)
      assert.match(result.stderr, /positive safe integer/, context)
      assert.doesNotMatch(result.stderr, /ENOENT|TypeError/, context)
      assert.equal(result.stdout, "", context)
    } else {
      assert.match(result.stderr, /ENOENT/, context)
      assert.doesNotMatch(result.stderr, /usage: lsp.mjs/, context)
    }
  } }
}

for (const value of ["NaN", "Infinity", "-Infinity", "1e309", "no", "", " ", "-1", "0", "0.5", "1.5", "9007199254740992"]) {
  test("LSP benchmark rejects invalid hover count before project discovery: " + JSON.stringify(value), t => {
    const f = fixture(t)
    f.run([f.server, f.project, value])
  })
}

for (const kind of ["none", "server only", "empty server", "empty project", "extra argument"]) {
  test("LSP benchmark reports invalid positional arguments: " + kind, t => {
    const f = fixture(t)
    const args = {
      none: [], "server only": [f.server], "empty server": ["", f.project],
      "empty project": [f.server, ""], "extra argument": [f.server, f.project, "2", "unexpected"]
    }[kind]
    f.run(args)
  })
}

test("LSP benchmark accepts its default and positive safe integer hover counts", t => {
  const f = fixture(t)
  f.run([f.server, f.project], false)
  for (const value of ["1", "3", "20", "1e2", "9007199254740991"]) f.run([f.server, f.project, value], false)
})

test("LSP benchmark rejects generated fractional hover counts before project discovery", t => {
  const f = fixture(t)
  let seed = 0x18b57
  for (let i = 0; i < 64; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    f.run([f.server, f.project, String(seed % 10000 + 0.25)])
  }
})
