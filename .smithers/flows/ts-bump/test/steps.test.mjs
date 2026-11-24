import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, existsSync, writeFileSync, chmodSync, readlinkSync, rmSync, statSync, symlinkSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { test } from "node:test"
import { classify, download, failures, merge, paths, report, pinned, repin, seams, start } from "../lib/steps.mjs"

const OLD = "1".repeat(40), NEW = "2".repeat(40)
const pin = (sha) => [
  "# VibeLang in TypeScript",
  "",
  "| | |",
  "| --- | --- |",
  `| Upstream commit | \`${sha}\`, "old title", 2026-10-14 |`,
  "| Why that commit | It is the `gitHead` of npm `typescript@next` 7.1.0-dev.20261015.1 (`npm view typescript@next gitHead version`) |",
  "",
  "## Seams in upstream files",
  "",
  "| Upstream file | Change | Lines (+/-) |",
  "| --- | --- | --- |",
  "| `tsc/internal/parser/parser.go` | Hand a short form to `vibelang.go` | +64 / -1 |",
  ""
].join("\n")

const tree = (root, files) => {
  for (const [p, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, p)), { recursive: true })
    writeFileSync(path.join(root, p), text)
  }
  return root
}
const lines = (...l) => l.join("\n") + "\n"

// A fork and two upstream trees that exercise every case the merge handles.
function fixture() {
  const dir = mkdtempSync(path.join(tmpdir(), "ts-bump-"))
  const run = path.join(dir, "run"), repo = path.join(dir, "repo")
  const base = {
    "tsc/go.mod": "module example.invalid/typescript\n",
    "tsc/a.go": lines("a1", "a2", "a3"),
    "tsc/internal/parser/parser.go": lines("p1", "p2", "p3", "p4", "p5", "p6"),
    "tsc/conflict.go": lines("c1", "c2", "c3"),
    "tsc/gone.go": lines("g"),
    "tsc/replaced/child": lines("g"),
    "tsc/kept.go": lines("k"),
    "tsc/same.go": lines("s")
  }
  tree(path.join(run, "upstream", OLD), base)
  const { "tsc/gone.go": _gone, "tsc/kept.go": _kept, "tsc/replaced/child": _child, ...remaining } = base
  tree(path.join(run, "upstream", NEW), {
    ...remaining,
    "tsc/a.go": lines("a1", "a2 upstream", "a3"),
    "tsc/internal/parser/parser.go": lines("p1 upstream", "p2", "p3", "p4", "p5", "p6"),
    "tsc/conflict.go": lines("c1", "c2 upstream", "c3"),
    "tsc/new.go": lines("n"),
    "tsc/testdata/baseline.txt": lines("never copied")
  })
  for (const sha of [OLD, NEW]) writeFileSync(path.join(run, "upstream", sha + ".complete"), sha + "\n")
  return { dir, run, repo, base }
}

test("merge applies upstream's changes, keeps the fork's, marks conflicts and moves the pin", (t) => {
  const { dir, run, repo, base } = fixture()
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const upstream = path.join(run, "upstream", NEW, "tsc")
  chmodSync(path.join(upstream, "new.go"), 0o755)
  chmodSync(path.join(upstream, "same.go"), 0o755)
  symlinkSync("new.go", path.join(upstream, "link"))
  symlinkSync(".", path.join(upstream, "replaced"))
  writeFileSync(path.join(upstream, "child"), "must survive replay")
  tree(path.join(repo, "typescript"), {
    ...base,
    "tsc/internal/parser/parser.go": lines("p1", "p2", "p3", "p4", "p5 vibelang", "p6"),
    "tsc/conflict.go": lines("c1", "c2 vibelang", "c3"),
    "tsc/kept.go": lines("k vibelang"),
    "tsc/internal/vibelang/lower.go": lines("ours"),
    "VIBELANG.md": pin(OLD)
  })
  start(run, { repo, to: "beta" })
  writeFileSync(path.join(run, "fetch.json"), JSON.stringify({ ok: true, from: OLD, to: NEW, version: "7.1.0-dev.20261022.1", title: "new title", date: "2026-10-21", same: false }))
  const m = merge(run)
  const read = (p) => readFileSync(path.join(repo, "typescript", p), "utf8")
  assert.equal(read("tsc/a.go"), lines("a1", "a2 upstream", "a3"))
  assert.equal(read("tsc/new.go"), lines("n"))
  assert.equal(existsSync(path.join(repo, "typescript/tsc/gone.go")), false)
  assert.equal(existsSync(path.join(repo, "typescript/tsc/testdata")), false)
  assert.equal(read("tsc/internal/parser/parser.go"), lines("p1 upstream", "p2", "p3", "p4", "p5 vibelang", "p6"))
  assert.equal(read("tsc/kept.go"), lines("k vibelang"))
  assert.equal(read("tsc/internal/vibelang/lower.go"), lines("ours"))
  assert.match(read("tsc/conflict.go"), /<<<<<<< vibelang\nc2 vibelang\n\|\|\|\|\|\|\| upstream-pinned\nc2\n=======\nc2 upstream\n>>>>>>> upstream-target\n/)
  assert.deepEqual(m.conflicts, [{ file: "tsc/conflict.go", hunks: 1, seam: null }])
  assert.deepEqual(m.merged, [{ file: "tsc/internal/parser/parser.go", seam: "Hand a short form to `vibelang.go`" }])
  assert.deepEqual(m.deleteModify, ["tsc/kept.go"])
  assert.equal(m.ok, false)
  assert.equal(pinned(repo), NEW)
  assert.match(read("VIBELANG.md"), new RegExp(`\\| Upstream commit \\| \`${NEW}\`, "new title", 2026-10-21 \\|`))
  assert.match(read("VIBELANG.md"), /\| Why that commit \| It is the `gitHead` of npm `typescript@beta` 7\.1\.0-dev\.20261022\.1 /)
  // A second execution returns the recorded result instead of merging again.
  assert.deepEqual(merge(run), m)
  assert.equal(statSync(path.join(repo, "typescript/tsc/new.go")).mode & 0o777, 0o755)
  assert.equal(statSync(path.join(repo, "typescript/tsc/same.go")).mode & 0o777, 0o755)
  assert.equal(readlinkSync(path.join(repo, "typescript/tsc/link")), "new.go")
  rmSync(paths(run).merge)
  assert.deepEqual(merge(run), m)
  assert.equal(read("tsc/child"), "must survive replay")
})

test("classify leaves out tsc/testdata and build outputs on every side", () => {
  const { run, dir } = fixture()
  const ours = tree(path.join(dir, "ours"), { "tsc/a.go": lines("a1", "a2", "a3"), "built/local/tsc": "bin", "tsc/testdata/x": "x" })
  const c = classify(path.join(run, "upstream", OLD), ours, path.join(run, "upstream", NEW))
  assert.ok(!c.theirsAdded.some((p) => p.startsWith("tsc/testdata/")))
  assert.equal(c.oursAdded, 0)
})

test("repin rewrites the commit row and says when no npm version names the commit", () => {
  const repo = tree(mkdtempSync(path.join(tmpdir(), "ts-bump-pin-")), { "typescript/VIBELANG.md": pin(OLD) })
  repin(repo, NEW, null, "a title", "2026-10-22")
  const text = readFileSync(path.join(repo, "typescript/VIBELANG.md"), "utf8")
  assert.match(text, new RegExp(`\\| Upstream commit \\| \`${NEW}\`, "a title", 2026-10-22 \\|`))
  assert.match(text, /\| Why that commit \| A ts-bump run named it/)
  assert.deepEqual(seams(repo), { "tsc/internal/parser/parser.go": "Hand a short form to `vibelang.go`" })
})

test("the pin parses from the real VIBELANG.md", () => {
  const repo = path.resolve(import.meta.dirname, "../../../..")
  assert.match(pinned(repo), /^[0-9a-f]{40}$/)
})

test("failures names compile errors, failing tests and failing targets", () => {
  const output = [
    "# github.com/microsoft/TypeScript/tsc/internal/vibelang",
    "internal/vibelang/hooks.go:12:3: undefined: checker.OldName",
    "    --- FAIL: TestLowering/case (0.01s)",
    '  "//typescript/vibelang:hello",Shell.Test,failed,1234,abc',
    "//:go-vibelang  failed  156.0s  command failed (exit 1)"
  ].join("\n")
  assert.deepEqual(failures(output), [
    "internal/vibelang/hooks.go:12:3: undefined: checker.OldName",
    "TestLowering/case",
    "//typescript/vibelang:hello",
    "//:go-vibelang"
  ])
})

test("a failed curl cannot cache an empty download even if tar succeeds", (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), "ts-bump-download-"))
  const oldPath = process.env.PATH
  t.after(() => {
    process.env.PATH = oldPath
    rmSync(dir, { recursive: true, force: true })
  })
  for (const [bin, code] of [["curl", 22], ["tar", 0]]) {
    writeFileSync(path.join(dir, bin), `#!/bin/sh\nexit ${code}\n`, { mode: 0o755 })
  }
  process.env.PATH = `${dir}:${oldPath}`
  const target = path.join(dir, "upstream")
  writeFileSync(target + ".complete", NEW + "\n")
  assert.throws(() => download(NEW, target), /download/)
  assert.equal(existsSync(target + ".complete"), false)
  writeFileSync(path.join(dir, "curl"), "#!/bin/sh\nexit 0\n")
  assert.throws(() => download(NEW, target), /tsc\/go.mod/)
  assert.equal(existsSync(target + ".complete"), false)
})

test("repin keeps dollar sequences literal and records the requested npm tag", (t) => {
  const repo = tree(mkdtempSync(path.join(tmpdir(), "ts-bump-pin-")), { "typescript/VIBELANG.md": pin(OLD) })
  t.after(() => rmSync(repo, { recursive: true, force: true }))
  const title = "Fix $` handling in $& and $1 templates"
  repin(repo, NEW, "7.1.0", title, "2026-10-22", "beta")
  const text = readFileSync(path.join(repo, "typescript/VIBELANG.md"), "utf8")
  assert.ok(text.includes(JSON.stringify(title)))
  assert.match(text, /typescript@beta/)
})

test("checks can pass while the bump still needs manual merges", (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), "ts-bump-report-"))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const files = {
    fetch: { from: OLD, to: NEW },
    options: {},
    merge: { summary: "2 need a hand", deleteModify: ["tsc/kept.go"], bothAdded: ["tsc/new.go"] },
    regenerate: { code: 0 },
    build: { results: [] },
    probe: { results: [] }
  }
  for (const [step, data] of Object.entries(files)) writeFileSync(paths(dir)[step], JSON.stringify(data))
  assert.equal(report(dir).ok, false)
  assert.deepEqual(report(dir).failing, ["tsc/kept.go", "tsc/new.go"])
})
