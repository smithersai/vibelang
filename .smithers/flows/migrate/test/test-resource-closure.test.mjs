// #71: a test bundle must carry the repository resources its tests read. A
// t3code server test read docs/user/t3-connect-troubleshooting.md with a
// string-literal readFile, and a bundle of scripts alone failed it. The
// closure reads each selected test for literal readFile/readFileSync paths and
// new URL(..., import.meta.url) paths inside the repository, and records each
// resource's digest.
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { testResourceClosure } from "../lib/test-bundles.mjs"

const sha = text => createHash("sha256").update(text).digest("hex")
const guide = "# Troubleshooting\nreconnect the relay\n"
const playbook = "# Playbook\ntriage first\n"
const fixtureJson = '{"answer":42}\n'
function repo(t) {
  const root = mkdtempSync(join(tmpdir(), "migrate-resource-closure-"))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const files = {
    "package.json": JSON.stringify({ name: "server", private: true, type: "module" }),
    "docs/x.md": guide,
    ".github/triage/PLAYBOOK.md": playbook,
    "test/fixtures/data.json": fixtureJson,
    "test/guide.test.mjs": [
      'import assert from "node:assert/strict"',
      'import { readFileSync } from "node:fs"',
      'import { readFile } from "node:fs/promises"',
      'import * as fs from "node:fs"',
      'import { test } from "node:test"',
      'test("reads its resources", async () => {',
      '  const text = await readFile("docs/x.md", "utf8")',
      '  assert.match(text, /reconnect the relay/)',
      '  assert.match(readFileSync(".github/triage/PLAYBOOK.md", "utf8"), /triage first/)',
      '  assert.equal(JSON.parse(fs.readFileSync(new URL("./fixtures/data.json", import.meta.url), "utf8")).answer, 42)',
      '  assert.throws(() => readFileSync("docs/missing.md"))',
      '})',
      ""
    ].join("\n"),
    // Outside the repository, and a computed path: neither is a resource the closure can name.
    "test/other.test.mjs": 'import { readFileSync } from "node:fs"\nexport const read = name => readFileSync("docs/" + name)\nexport const outside = () => readFileSync("../../etc/hosts")\n'
  }
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, file)), { recursive: true })
    writeFileSync(join(root, file), text)
  }
  return root
}
function bundle(t, root, files) {
  const out = mkdtempSync(join(tmpdir(), "migrate-resource-bundle-"))
  t.after(() => rmSync(out, { recursive: true, force: true }))
  for (const file of ["package.json", ...files]) {
    mkdirSync(dirname(join(out, file)), { recursive: true })
    copyFileSync(join(root, file), join(out, file))
  }
  // The outer runner's NODE_TEST_CONTEXT would make the inner run report to it and exit 0.
  const env = { ...process.env }
  delete env.NODE_TEST_CONTEXT
  return spawnSync(process.execPath, ["--test", "test/guide.test.mjs"], { cwd: out, encoding: "utf8", env })
}

test("the closure names each literal resource a selected test reads, with its digest", t => {
  const root = repo(t)
  const closure = testResourceClosure(root, ["test/guide.test.mjs", "test/other.test.mjs"])
  assert.deepEqual(closure.resources.map(r => [r.path, r.digest, r.test]), [
    [".github/triage/PLAYBOOK.md", sha(playbook), "test/guide.test.mjs"],
    ["docs/x.md", sha(guide), "test/guide.test.mjs"],
    ["test/fixtures/data.json", sha(fixtureJson), "test/guide.test.mjs"]
  ])
  assert.deepEqual(closure.files, [".github/triage/PLAYBOOK.md", "docs/x.md", "test/fixtures/data.json", "test/guide.test.mjs", "test/other.test.mjs"])
  for (const r of closure.resources) assert.ok(r.line > 0)
})

test("a test reading docs/x.md fails in a bundle without the closure and passes with it", t => {
  const root = repo(t)
  const without = bundle(t, root, ["test/guide.test.mjs"])
  assert.notEqual(without.status, 0)
  assert.match(without.stdout + without.stderr, /ENOENT/)
  const closure = testResourceClosure(root, ["test/guide.test.mjs"])
  const withClosure = bundle(t, root, closure.files)
  assert.equal(withClosure.status, 0, withClosure.stdout + withClosure.stderr)
  for (const r of closure.resources) assert.equal(sha(readFileSync(join(root, r.path))), r.digest)
})
