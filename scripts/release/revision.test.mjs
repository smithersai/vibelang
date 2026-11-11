// node --test scripts/release/revision.test.mjs
// The release's source revision, read through stand-in jj and git commands.
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import { fixtureCheckout, fixtureRevision } from "./fixture-checkout.mjs"
import { templateExcluded, templateFilter, isTemplateFile } from "../template-files.mjs"

const fc = createRequire(new URL("../../packages/compiler/package.json", import.meta.url))("fast-check")
const script = fileURLToPath(new URL("./revision.mjs", import.meta.url))

function fixture(t, options) {
  const root = mkdtempSync(join(tmpdir(), "vibelang-revision-test-"))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  mkdirSync(join(root, "src/nested"), { recursive: true })
  mkdirSync(join(root, "node_modules/dependency"), { recursive: true })
  for (const file of ["src/index.js", "src/nested/deep.js", "src/.env", "node_modules/dependency/index.js", "README.md"]) writeFileSync(join(root, file), file)
  const checkout = options ? fixtureCheckout(root, options) : undefined
  // The module reads the tools from PATH, so each call runs it as a command.
  const call = (expression, ...args) => spawnSync(process.execPath, ["--input-type=module", "-e",
    `import * as revision from ${JSON.stringify(script)}; console.log(JSON.stringify(${expression}))`, root, ...args],
    { encoding: "utf8", env: { ...process.env, PATH: (checkout?.bin ?? join(root, "none")) + ":" + process.env.PATH } })
  const cli = (...args) => spawnSync(process.execPath, [script, ...args], { encoding: "utf8", env: { ...process.env, PATH: (checkout?.bin ?? join(root, "none")) + ":" + process.env.PATH } })
  return { root, checkout, call, cli, value: (expression) => JSON.parse(call(expression).stdout) }
}

for (const vcs of ["jj", "git"]) {
  test(`${vcs}: reports the revision, whether the tree is clean, and only tracked files`, (t) => {
    const f = fixture(t, { vcs, untracked: ["src/.env"] })
    assert.deepEqual(f.value("revision.sourceRevision(process.argv[1])"), { revision: fixtureRevision, clean: true })
    assert.deepEqual(f.value("revision.trackedFiles(process.argv[1])"), ["README.md", "src/index.js", "src/nested/deep.js"])
    assert.equal(f.cli(f.root).stdout, fixtureRevision + " true\n")
    f.checkout.set({ clean: false })
    assert.deepEqual(f.value("revision.sourceRevision(process.argv[1])"), { revision: fixtureRevision, clean: false })
    assert.equal(f.cli(f.root).stdout, fixtureRevision + " false\n")
  })

  test(`${vcs}: a revision that is not a commit id is refused`, (t) => {
    const f = fixture(t, { vcs, revision: "not a revision" })
    const result = f.cli(f.root)
    assert.equal(result.status, 1)
    assert.match(result.stderr, /unexpected source revision/)
  })
}

test("a tree without version control has no revision", (t) => {
  const f = fixture(t)
  const result = f.cli(f.root)
  assert.equal(result.status, 1)
  assert.equal(result.stdout, "")
  assert.match(result.stderr, /not a jj or git checkout/)
})

test("property: a manifest is publishable only from its own revision, with a clean tree and no rehearsal mark", (t) => {
  const f = fixture(t, {})
  const id = fc.constantFrom(fixtureRevision, "9c".repeat(20), undefined)
  fc.assert(fc.property(id, fc.constantFrom(fixtureRevision, "9c".repeat(20)), fc.boolean(), fc.constantFrom(undefined, [], ["--skip-build"], ["--skip-build", "--rehearsal"]),
    (recorded, checkedOut, clean, rehearsalOnly) => {
      f.checkout.set({ revision: checkedOut, clean })
      const manifest = join(f.root, "manifest.json")
      writeFileSync(manifest, JSON.stringify({ version: "0.0.1", revision: recorded, rehearsalOnly, packages: [] }))
      const result = f.cli("--manifest", manifest, f.root)
      const publishable = recorded === checkedOut && clean && !rehearsalOnly?.length
      assert.equal(result.status, publishable ? 0 : 1, result.stderr)
      assert.equal(result.stderr.includes("records no source revision"), recorded === undefined)
      assert.equal(result.stderr.includes("but this checkout is"), recorded !== undefined && recorded !== checkedOut)
      assert.equal(result.stderr.includes("not in a commit"), recorded !== undefined && !clean)
      assert.equal(result.stderr.includes("for rehearsal only"), Boolean(rehearsalOnly?.length))
    }), { numRuns: 30, seed: 544003 })
})

test("readRecord reads receipts and returns undefined for a missing file", (t) => {
  const f = fixture(t, {})
  writeFileSync(join(f.root, "receipt"), "platform=linux-x64\ncompleted=2026-11-08T05:00:00Z\nexit=0\n")
  assert.deepEqual(JSON.parse(f.call("revision.readRecord(process.argv[2])", join(f.root, "receipt")).stdout), { platform: "linux-x64", completed: "2026-11-08T05:00:00Z", exit: "0" })
  assert.equal(f.call("revision.readRecord(process.argv[2]) ?? null", join(f.root, "absent")).stdout, "null\n")
})

test("property: the shared exclusion list drops a path exactly when a segment is excluded", () => {
  const segment = fc.constantFrom(...templateExcluded, "src", "main.vibe", "lib", "bun.lockb", "dist-notes.md", ".vibes")
  fc.assert(fc.property(fc.array(segment, { minLength: 1, maxLength: 4 }), (segments) => {
    assert.equal(isTemplateFile(segments.join("/")), !segments.some((part) => templateExcluded.includes(part)))
    assert.equal(templateFilter(segments.join("/")), !templateExcluded.includes(segments.at(-1)))
  }), { numRuns: 200, seed: 544004 })
  for (const name of ["node_modules", "dist", ".prototype", ".vibe", "bun.lock", "package-lock.json", "pnpm-lock.yaml", "yarn.lock"]) assert.ok(templateExcluded.includes(name), name)
})
