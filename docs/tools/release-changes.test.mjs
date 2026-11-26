import { test } from "node:test"
import assert from "node:assert/strict"
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { execFileSync } from "node:child_process"
import { fileURLToPath } from "node:url"

import { assembleReleaseNotes, changesDir, foldChanges, notesPath, parseChange, readChanges, readReleaseNotes } from "./release-changes.mjs"
import { assertReleasePublication, assertReleaseStructure } from "./release-publication-checks.mjs"

const notes = [
  "# Release notes", "", "Intro.", "",
  "## 9.8.8 (unreleased)", "", "### Bugs fixed since 9.8.7", "",
  "- An older fix.", "",
  "### Upgrade from 9.8.7", "", "| Before | After and repair |", "| --- | --- |", "| `a` | `b` |", "",
  "## 9.8.7", "", "### Bugs fixed since 9.8.6", "", "- A shipped fix.", ""
].join("\n")

function repository(changes = {}) {
  const root = mkdtempSync(join(tmpdir(), "release-changes-"))
  mkdirSync(join(root, "docs/user/src/setup"), { recursive: true })
  mkdirSync(join(root, changesDir), { recursive: true })
  writeFileSync(join(root, notesPath), notes)
  writeFileSync(join(root, changesDir, "README.md"), "# Unreleased changes\n")
  for (const [name, text] of Object.entries(changes)) writeFileSync(join(root, changesDir, name), text)
  return root
}

test("a fix entry ends the top release's bug list as one bullet", () => {
  const out = assembleReleaseNotes(notes, [parseChange("b-fix.md", "Second fix.\n"), parseChange("a-fix.md", "Builds failed\nwith `X`. They pass now.\n")])
  assert.equal(out, notes.replace("- An older fix.\n", "- An older fix.\n\n- Builds failed with `X`. They pass now.\n\n- Second fix.\n"))
})

test("upgrade rows end the top release's upgrade table", () => {
  const out = assembleReleaseNotes(notes, [parseChange("rename.upgrade.md", "| `c` | `d` |\n| `e` | `f` |\n")])
  assert.equal(out, notes.replace("| `a` | `b` |\n", "| `a` | `b` |\n| `c` | `d` |\n| `e` | `f` |\n"))
})

test("no entries leave the notes byte for byte", () => {
  assert.equal(assembleReleaseNotes(notes, []), notes)
})

test("malformed entries name the file and the repair", () => {
  for (const [name, text, message] of [
    ["Fix.md", "A fix.", /lowercase kebab case/],
    ["fix.txt.md", "A fix.", /lowercase kebab case/],
    ["fix.md", "  \n", /empty/],
    ["fix.md", "- A fix.", /plain sentences/],
    ["fix.md", "### A fix", /plain sentences/],
    ["fix.md", "A fix.\n\nMore.", /one paragraph/],
    ["fix.upgrade.md", "| single cell |", /rows of the upgrade table/],
    ["fix.upgrade.md", "A fix.", /rows of the upgrade table/],
    ["fix.upgrade.md", "| Before | After |\n| --- | --- |", /rows of the upgrade table/]
  ]) assert.throws(() => parseChange(name, text), error => error.message.startsWith(changesDir + "/" + name) && message.test(error.message), name + ": " + text)
})

test("an entry with no list or table to join is refused", () => {
  const bare = "## 9.8.8 (unreleased)\n\n## 9.8.7\n"
  assert.throws(() => assembleReleaseNotes(bare, [parseChange("fix.md", "A fix.")]), /no `### Bugs fixed since` list for docs\/user\/changes\/fix\.md/)
  assert.throws(() => assembleReleaseNotes(bare, [parseChange("x.upgrade.md", "| a | b |")]), /no `### Upgrade from` table/)
  assert.throws(() => assembleReleaseNotes("# Release notes\n", [parseChange("fix.md", "A fix.")]), /no release section/)
})

test("the publication guard sees entries: a duplicated fix and internal wording fail", () => {
  const root = repository({ "dup.md": "An older fix." })
  try {
    assert.throws(() => assertReleasePublication(readReleaseNotes(root), "9.8.8"), /each user-facing fix appears once/)
    writeFileSync(join(root, changesDir, "dup.md"), "The post-merge check timed out. It passes now.")
    assert.throws(() => assertReleasePublication(readReleaseNotes(root), "9.8.8"), /internal bookkeeping/)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test("folding writes the published notes and removes only the entries", () => {
  const root = repository({ "a.md": "A fix.", "b.upgrade.md": "| `x` | `y` |" })
  try {
    const published = readReleaseNotes(root)
    const output = execFileSync("node", [fileURLToPath(new URL("./release-changes.mjs", import.meta.url)), "--check"], { encoding: "utf8" })
    assert.match(output, /unreleased entries/)
    assert.equal(foldChanges(root).length, 2)
    assert.equal(readFileSync(join(root, notesPath), "utf8"), published)
    assert.deepEqual(readdirSync(join(root, changesDir)), ["README.md"])
    assert.equal(readReleaseNotes(root), published)
    assertReleaseStructure(published, "9.8.8")
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test("the command refuses a malformed entry with its path", () => {
  const root = repository({ "Bad.md": "A fix." })
  try {
    assert.throws(() => readChanges(root), /docs\/user\/changes\/Bad\.md: name a change file/)
    assert.ok(existsSync(join(root, changesDir, "Bad.md")))
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test("this repository's entries parse and pass the publication guard", () => {
  const version = JSON.parse(readFileSync(new URL("../../packages/compiler/package.json", import.meta.url), "utf8")).version
  readChanges()
  assertReleaseStructure(readReleaseNotes(), version)
})

test("a stray entry blocks the fold before the notes change", () => {
  const root = repository({ "draft.txt": "An unfinished change." })
  try {
    assert.throws(() => foldChanges(root), /draft.txt/)
    assert.equal(readFileSync(join(root, notesPath), "utf8"), notes)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test("release preflight identifies an outstanding entry and passes after folding", t => {
  const root = repository({ "watch-mode.md": "Watch mode detects the new source." })
  t.after(() => rmSync(root, { recursive: true, force: true }))
  mkdirSync(join(root, "docs/tools"))
  for (const name of ["release-changes.mjs", "release-publication-checks.mjs"]) {
    copyFileSync(new URL(name, import.meta.url), join(root, "docs/tools", name))
  }
  const run = flag => execFileSync(process.execPath, ["docs/tools/release-changes.mjs", flag], {
    cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"]
  })
  assert.throws(() => run("--check-empty"), /Fold outstanding changes before release: watch-mode.md/)
  run("--fold")
  assert.match(run("--check-empty"), /0 unreleased entries/)
})
