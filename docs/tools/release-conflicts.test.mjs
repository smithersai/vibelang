import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { test } from "node:test"
import fc from "fast-check"
import { releaseDocsProblems } from "./release-docs.mjs"

const source = "docs/user/src/setup/release-notes.md"
const deployed = "site/src/pages/setup/release-notes.mdx"
const notes = bullet => "# Release notes\n\n## 9.8.7 (unreleased)\n\n### Bugs fixed since 9.8.6\n\n" +
  bullet + "\n\n## 9.8.6\n\n- An earlier fix.\n"

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "release-conflicts-"))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const put = (path, text) => {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), text)
  }
  put("packages/compiler/package.json", JSON.stringify({ version: "9.8.7" }))
  return { root, put, read: path => readFileSync(join(root, path), "utf8") }
}

test("release checks reject native jj conflicts and accept resolved notes in every marker style", t => {
  const { root, put, read } = fixture(t)
  const jj = (...args) => {
    const result = spawnSync("jj", ["--config", 'user.name="Documentation test"',
      "--config", 'user.email="docs@example.test"', ...args], {
      cwd: root, encoding: "utf8", timeout: 15_000
    })
    assert.ifError(result.error)
    assert.equal(result.status, 0, result.stdout + result.stderr)
    return result.stdout.trim()
  }
  jj("git", "init")
  put(source, notes("- The original note."))
  jj("describe", "-m", "base")
  const base = jj("log", "-r", "@", "--no-graph", "-T", "commit_id")
  jj("new", base, "-m", "first note")
  put(source, notes("- The first fix."))
  const first = jj("log", "-r", "@", "--no-graph", "-T", "commit_id")
  jj("new", base, "-m", "second note")
  put(source, notes("- The second fix."))
  const second = jj("log", "-r", "@", "--no-graph", "-T", "commit_id")
  for (const style of ["diff", "snapshot", "git"]) {
    jj("--config", "ui.conflict-marker-style=" + style, "new", first, second, "-m", "conflicted notes")
    assert.ok(jj("resolve", "--list").includes(source), style + " must exercise an actual unresolved conflict")
    const conflicted = read(source)
    put(deployed, conflicted)
    for (const write of [false, true]) {
      const problems = releaseDocsProblems(root, write)
      for (const path of [source, deployed]) {
        assert.ok(problems.some(problem => problem.startsWith(path + ":") &&
          problem.includes("unresolved merge conflict marker")), style + ": " + problems.join("\n"))
        assert.equal(read(path), conflicted, "generation must leave conflicted text for manual resolution")
      }
    }
    const resolved = notes("- The first fix.\n- The second fix.")
    put(source, resolved)
    put(deployed, resolved)
    assert.equal(jj("log", "-r", "@", "--no-graph", "-T", "conflict"), "false", "both sides must be retained in a native resolution")
    for (const write of [false, true]) assert.deepEqual(releaseDocsProblems(root, write), [])
    assert.equal(read(source), resolved)
    assert.equal(read(deployed), resolved)
  }
})

test("release checks reject isolated conflict boundaries without treating Markdown underlines as conflicts", t => {
  const { root, put, read } = fixture(t)
  for (const marker of ["<<<<<<<", ">>>>>>>", "||||||| base", "<<<<<<<<<<<< left", ">>>>>>>>>>>> right"]) {
    const text = notes("- A fix.\n" + marker)
    put(source, text)
    for (const write of [false, true]) {
      const problems = releaseDocsProblems(root, write)
      assert.equal(problems.length, 1, marker)
      assert.match(problems[0], /release-notes\.md:\d+: unresolved merge conflict marker/)
      assert.equal(read(source), text)
    }
  }
  for (const text of [
    "A heading\n=======\n\nA shorter underline\n------\n",
    notes("- Compare " + "<<<<<<<" + " and " + ">>>>>>>" + " as inline text."),
    notes("- A fix.") + "\n" + String.fromCharCode(96).repeat(3) + "text\n> A quotation\n+++++++\n" +
      String.fromCharCode(96).repeat(3) + "\n"
  ]) {
    put(source, text)
    assert.deepEqual(releaseDocsProblems(root), [])
  }
})

test("conflicts inside generated compatibility boxes cannot disappear during regeneration", t => {
  const { root, put, read } = fixture(t)
  put("packages/runtime/package.json", JSON.stringify({ peerDependencies: { effect: "4.0.6" } }))
  const text = "<!-- compatibility:start -->\n<<<<<<< first\nold\n=======\nnew\n>>>>>>> second\n<!-- compatibility:end -->\n"
  put("README.md", text)
  assert.equal(releaseDocsProblems(root, true).length, 1)
  assert.equal(read("README.md"), text)
})

test("generated marker widths, labels, line endings and page locations retain the source guard", t => {
  const { root, put, read } = fixture(t)
  const paths = [source, deployed, "docs/design/src/release-test.md",
    "site/src/pages/vips/0010-release-test.mdx", "README.md", "packages/compiler/README.md"]
  fc.assert(fc.property(fc.constantFrom(...paths), fc.integer({ min: 7, max: 32 }),
    fc.constantFrom("\n", "\r\n"), fc.constantFrom("left", "conflict 1 of 2", "feature/release"),
    fc.integer({ min: 0, max: 8 }), (path, width, eol, label, prefix) => {
      const lines = ["Release prose", ...Array(prefix).fill("- A preserved note."),
        "<".repeat(width) + " " + label, "- The first fix.", "=".repeat(width),
        "- The second fix.", ">".repeat(width) + " " + label, "- A preserved suffix."]
      const text = lines.join(eol)
      put(path, text)
      for (const write of [false, true]) {
        assert.deepEqual(releaseDocsProblems(root, write),
          [path + ":" + (prefix + 2) + ": unresolved merge conflict marker; resolve it before regenerating docs"])
        assert.equal(read(path), text)
      }
      const resolved = ["Release prose", ...Array(prefix).fill("- A preserved note."),
        "- The first fix.", "- The second fix.", "- A preserved suffix."].join(eol)
      put(path, resolved)
      for (const write of [false, true]) assert.deepEqual(releaseDocsProblems(root, write), [])
      assert.equal(read(path), resolved)
    }), { numRuns: 96, seed: 20261105 })
})

test("the release CLI fails in check and write modes and reports locations without conflict contents", t => {
  const { root, put, read } = fixture(t)
  put("docs/tools/release-docs.mjs", readFileSync(fileURLToPath(new URL("./release-docs.mjs", import.meta.url)), "utf8"))
  const text = notes("- A fix.\n<<<<<<< private-branch-label\nleft\n=======\nright\n>>>>>>> other-label")
  put(source, text)
  for (const mode of ["--check", "--write"]) {
    const result = spawnSync(process.execPath, [join(root, "docs/tools/release-docs.mjs"), mode], {
      encoding: "utf8", timeout: 15_000
    })
    assert.ifError(result.error)
    assert.equal(result.status, 1, result.stdout + result.stderr)
    assert.match(result.stderr, /docs\/user\/src\/setup\/release-notes\.md:\d+: unresolved merge conflict marker/)
    assert.doesNotMatch(result.stderr, /private-branch-label|other-label/)
    assert.equal(read(source), text)
  }
})
