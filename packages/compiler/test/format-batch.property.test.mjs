import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { existsSync, globSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { createHash } from "node:crypto"
import { createRequire } from "node:module"
import { fileURLToPath } from "node:url"
import fc from "fast-check"
import { repositoryStyle, typescriptPlugin } from "../format.mjs"

const native = fileURLToPath(new URL("../native/vibelang", import.meta.url))
const skip = !existsSync(native) && "run sh scripts/build-vibelang.sh"
const cli = fileURLToPath(new URL("../bin/vibelang-format", import.meta.url))

const write = (root, file, text) => {
  mkdirSync(dirname(join(root, file)), { recursive: true })
  writeFileSync(join(root, file), text)
}
const tree = root => {
  const all = {}
  const walk = dir => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name)
      if (name === ".git") continue
      if (statSync(path).isDirectory()) walk(path)
      else all[path.slice(root.length + 1)] = readFileSync(path, "latin1")
    }
  }
  walk(root)
  return all
}
const repository = files => {
  const root = mkdtempSync(join(tmpdir(), "vibe-format-batch-"))
  mkdirSync(join(root, ".git"))
  for (const [file, text] of Object.entries(files)) write(root, file, text)
  return root
}
// Each test sees its own cache, or none, so one test's clean texts reach no other.
const noCache = { ...process.env, VIBELANG_DISABLE_CACHE: "1" }
const run = (root, ...args) => spawnSync(process.execPath, [cli, ...args], { cwd: root, encoding: "utf8", env: noCache })

// The per-file behaviour formatFiles had before it batched, one dprint process
// for each file through --stdin, without --no-gitignore: the oracle.
function perFile(root, args) {
  const check = args.includes("--check")
  const dprint = createDprint()
  const files = globSync("**/*.vibe", { cwd: root, exclude: path => /(^|[/\\])(?:node_modules|dist|build|coverage|\.git|\.jj)([/\\]|$)/.test(path) })
  let status = 0
  const needs = []
  for (const file of files) {
    const before = readFileSync(join(root, file), "utf8")
    const after = dprint(root, file, before)
    if (after === null) return { status: 2, needs }
    if (before === after) continue
    if (check) { needs.push(file); status = 1 }
    else writeFileSync(join(root, file), after)
  }
  return { status, needs }
}
const manifest = fileURLToPath(new URL("../dprint-plugin.json", import.meta.url))
const dprintBin = createRequire(import.meta.url).resolve("dprint/bin.cjs")
function createDprint() {
  return (root, file, text) => {
    const style = repositoryStyle(join(root, file))
    const dir = mkdtempSync(join(tmpdir(), "vibe-format-oracle-"))
    try {
      const config = join(dir, "dprint.json")
      writeFileSync(config, JSON.stringify({ lineWidth: style.lineWidth, plugins: [typescriptPlugin, manifest + "@" + createHash("sha256").update(readFileSync(manifest)).digest("hex")], typescript: { semiColons: "asi", quoteStyle: style.quoteStyle } }))
      const result = spawnSync(process.execPath, [dprintBin, "fmt", "--config", config, "--stdin", join(root, file)], { input: text, cwd: root, encoding: "utf8" })
      return result.status === 0 ? result.stdout : null
    } finally { rmSync(dir, { recursive: true, force: true }) }
  }
}

const bodies = fc.constantFrom(
  "export   const   value=1;\n",
  "export const value = 1\n",
  "export const quoted = 'it'\n",
  "export const é   = \"ü\"",
  "﻿export   const   b=1;\r\nexport  const c=2\r\n",
  "",
  "\n\n",
  "// only a comment",
  "export effect function f() {\n      return 1\n}\n",
  `export const sizes = [111111, 222222, 333333, 444444, 555555, 666666, 777777, 888888, 999999, 101010]\n`,
)
const paths = fc.constantFrom("a.vibe", "b.vibe", "src/c.vibe", "gen/g.vibe", "app/[id]/p.vibe", "app/(g)/q.vibe", "sp ace/s.vibe", "!bang/b.vibe", ".hidden/h.vibe", "st*r.vibe", "sub/gen2/x.vibe", "pkg/z.vibe")
const configs = fc.constantFrom(
  {},
  { ".gitignore": "gen/\n" },
  { ".gitignore": "gen/\nsub/gen2/\n", "pkg/.oxfmtrc.json": '{"singleQuote":true,"printWidth":40}' },
  { "dprint.json": '{"lineWidth":40,"typescript":{"quoteStyle":"alwaysSingle"}}', "sub/.gitignore": "gen2/\n" },
)
const case_ = fc.record({ files: fc.dictionary(paths, bodies, { minKeys: 1, maxKeys: 6 }), config: configs })

test("one dprint run gives each file the output and the status of one run per file", { skip, timeout: 900_000 }, () => {
  fc.assert(fc.property(case_, fc.constantFrom("--check", "--write"), ({ files, config }, mode) => {
    const batch = repository({ ...config, ...files }), single = repository({ ...config, ...files })
    try {
      const got = run(batch, mode)
      const want = perFile(single, [mode])
      assert.equal(got.status, want.status, got.stderr)
      assert.deepEqual(tree(batch), tree(single))
      if (mode === "--check") assert.deepEqual(got.stderr.split("\n").filter(Boolean).sort(), want.needs.map(file => file + ": needs formatting").sort())
    } finally {
      rmSync(batch, { recursive: true, force: true })
      rmSync(single, { recursive: true, force: true })
    }
  }), { numRuns: 25 })
})

test("a file dprint refuses gives the per-file error and status, in order", { skip }, () => {
  const root = repository({
    "a.vibe": "export   const   a=1;\n",
    "b.vibe": "const broken = ;\n",
    "c.vibe": "export   const   c=1;\n",
    "d.vibe": "const broken2 = ;\n",
  })
  try {
    const check = run(root, "--check")
    assert.equal(check.status, 2)
    assert.match(check.stderr, /a\.vibe: needs formatting/)
    assert.doesNotMatch(check.stderr, /c\.vibe: needs formatting/, "the loop stops at the first refusal")
    assert.match(check.stderr, /vibelang format: 1:16: Expression expected\./)
    assert.doesNotMatch(check.stderr, /\d{7}\.vibe/, "no scratch name reaches the user")
    assert.equal(readFileSync(join(root, "c.vibe"), "utf8"), "export   const   c=1;\n", "a check writes nothing")
    const written = run(root, "--write")
    assert.equal(written.status, 2)
    assert.equal(readFileSync(join(root, "a.vibe"), "utf8"), "export const a = 1\n")
    assert.equal(readFileSync(join(root, "c.vibe"), "utf8"), "export   const   c=1;\n", "files after the refusal stay as they were")
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test("the file count does not change the number of dprint processes", { skip, timeout: 300_000 }, () => {
  const files = Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`src/m${i}.vibe`, `export   const   v${i}=1;\n`]))
  const root = repository(files)
  try {
    // dprint runs fmt once in a batch: 40 per-file runs on one core take many seconds.
    const shim = mkdtempSync(join(tmpdir(), "vibe-format-count-"))
    const log = join(shim, "runs.log")
    const preload = join(shim, "count.cjs")
    writeFileSync(preload, `const cp = require("node:child_process"), fs = require("node:fs"); const spawnSync = cp.spawnSync;
      cp.spawnSync = function (cmd, args, options) { if (String(args?.[0]).endsWith("bin.cjs")) fs.appendFileSync(${JSON.stringify(log)}, (args[1] ?? "") + "\\n"); return spawnSync.apply(this, arguments) }
      require("node:module").syncBuiltinESMExports()`)
    const result = spawnSync(process.execPath, ["--require", preload, cli, "--write"], { cwd: root, encoding: "utf8", env: noCache })
    assert.equal(result.status, 0, result.stderr)
    const runs = existsSync(log) ? readFileSync(log, "utf8").split("\n").filter(Boolean) : []
    // A batch this small runs in one child, which counts as the one fmt: no per-file fmt reaches this spawnSync.
    assert.deepEqual(runs.filter(run => run === "fmt"), [], "no fmt per file")
    for (let i = 0; i < 40; i++) assert.equal(readFileSync(join(root, `src/m${i}.vibe`), "utf8"), `export const v${i} = 1\n`)
    rmSync(shim, { recursive: true, force: true })
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test("an explicit path stays as it was outside what dprint discovers", { skip }, () => {
  const root = repository({
    ".gitignore": "gen/\n",
    "up.vibe": "export   const   up=1;\n",
    "gen/g.vibe": "export   const   g=1;\n",
    "sub/s.vibe": "export   const   s=1;\n",
    "lit/[id].vibe": "export   const   lit=1;\n",
  })
  try {
    const sub = join(root, "sub")
    const check = spawnSync(process.execPath, [cli, "--check", "../up.vibe", "../gen/g.vibe", "s.vibe"], { cwd: sub, encoding: "utf8", env: noCache })
    assert.equal(check.status, 1, check.stderr)
    assert.deepEqual(check.stderr.split("\n").filter(Boolean).sort(), ["../up.vibe: needs formatting", "s.vibe: needs formatting"], "a gitignored file passes unchanged, as with --stdin")
    assert.equal(spawnSync(process.execPath, [cli, "--write", "../up.vibe", "s.vibe"], { cwd: sub, encoding: "utf8", env: noCache }).status, 0)
    assert.equal(readFileSync(join(root, "up.vibe"), "utf8"), "export const up = 1\n")
    assert.equal(readFileSync(join(sub, "s.vibe"), "utf8"), "export const s = 1\n")
  } finally { rmSync(root, { recursive: true, force: true }) }
})

const cachedRun = (root, cache, ...args) => spawnSync(process.execPath, [cli, ...args], { cwd: root, encoding: "utf8", env: { ...process.env, VIBELANG_CACHE_DIR: cache } })

test("a second run reports what the first did, and an edit or a new setting misses the cache", { skip }, () => {
  const clean = "export const a = 1\n", wide = "export const sizes = [111111, 222222, 333333, 444444, 555555, 666666, 777777]\n"
  const root = repository({ "a.vibe": clean, "b.vibe": wide, "gen/g.vibe": "export   const   g=1;\n", ".gitignore": "gen/\n" })
  const cache = mkdtempSync(join(tmpdir(), "vibe-format-cache-"))
  try {
    assert.equal(cachedRun(root, cache, "--check").status, 0)
    assert.equal(cachedRun(root, cache, "--check").status, 0)
    writeFileSync(join(root, "a.vibe"), "export   const   a=1;\n")
    const edited = cachedRun(root, cache, "--check")
    assert.equal(edited.status, 1)
    assert.match(edited.stderr, /a\.vibe: needs formatting/)
    assert.equal(cachedRun(root, cache, "--write").status, 0)
    assert.equal(readFileSync(join(root, "a.vibe"), "utf8"), clean)
    assert.equal(cachedRun(root, cache, "--check").status, 0)
    writeFileSync(join(root, "dprint.json"), '{"lineWidth":40}')
    const narrowed = cachedRun(root, cache, "--check")
    assert.equal(narrowed.status, 1)
    assert.match(narrowed.stderr, /b\.vibe: needs formatting/)
    rmSync(join(root, "dprint.json"))
    // gen/g.vibe passed unformatted because it is ignored: its text is not clean elsewhere.
    writeFileSync(join(root, "c.vibe"), "export   const   g=1;\n")
    const twin = cachedRun(root, cache, "--check")
    assert.equal(twin.status, 1)
    assert.match(twin.stderr, /c\.vibe: needs formatting/)
  } finally {
    rmSync(root, { recursive: true, force: true })
    rmSync(cache, { recursive: true, force: true })
  }
})

// toolcover-alchemy: 8,595 files took 403 to 600 s at one Node and one dprint
// per file, about 64 ms each, so 1,000 files took over 60 s even unloaded. The
// budgets hold on a loaded host and fail a return to one process per file.
const coldBudget = 30_000, warmBudget = 10_000
test(`1,000 files stay within ${coldBudget} ms, and ${warmBudget} ms once clean`, { skip, timeout: 300_000 }, () => {
  const files = Object.fromEntries(Array.from({ length: 1000 }, (_, i) => [`src/d${i % 37}/m${i}.vibe`, `export const v${i} = ${i}\n\nexport function f${i}() {\n  return v${i} + 1\n}\n`]))
  const root = repository(files)
  const cache = mkdtempSync(join(tmpdir(), "vibe-format-budget-"))
  const timed = (budget, name) => {
    const started = performance.now()
    const result = spawnSync(process.execPath, [cli, "--check"], { cwd: root, encoding: "utf8", timeout: budget, env: { ...process.env, VIBELANG_CACHE_DIR: cache } })
    const elapsed = Math.round(performance.now() - started)
    assert.equal(result.status, 0, `${name}: status ${result.status} after ${elapsed} ms against a budget of ${budget} ms\n${result.stderr}`)
    return elapsed
  }
  try {
    const cold = timed(coldBudget, "cold")
    const warm = timed(warmBudget, "warm")
    assert.ok(warm <= cold, `a clean tree must not cost more than a cold one: ${warm} ms, ${cold} ms`)
  } finally {
    rmSync(root, { recursive: true, force: true })
    rmSync(cache, { recursive: true, force: true })
  }
})

test("a batch across shards gives the output of one run", { skip, timeout: 300_000 }, () => {
  // 600 files is more than one shard. Odd names land in different shards, so a refusal is told by file.
  const files = {}
  for (let i = 0; i < 600; i++) files[`s/m${i}.vibe`] = `export   const   v${i}=${i};\n`
  files["s/m300.vibe"] = "const broken = ;\n"
  const root = repository(files)
  try {
    const check = run(root, "--check")
    assert.equal(check.status, 2, "the first refusal stops the run")
    assert.match(check.stderr, /vibelang format: 1:16: Expression expected\./)
    rmSync(join(root, "s", "m300.vibe"))
    assert.equal(run(root, "--write").status, 0)
    for (let i = 0; i < 600; i++) if (i !== 300) assert.equal(readFileSync(join(root, "s", `m${i}.vibe`), "utf8"), `export const v${i} = ${i}\n`)
    assert.equal(run(root, "--check").status, 0)
  } finally { rmSync(root, { recursive: true, force: true }) }
})
