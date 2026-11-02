import assert from "node:assert/strict"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { after, test } from "node:test"
import * as Jj from "../lib/jj.mjs"
import { renameBatch } from "../lib/codemod.mjs"
import { must } from "../lib/util.mjs"

const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const fc = require("fast-check")
const corpus = JSON.parse(readFileSync(new URL("./corpus/alchemy-ignored-source-rename.json", import.meta.url), "utf8"))
const contract = readFileSync(new URL("../README.md", import.meta.url), "utf8")
const raw = process.env.VIBELANG_IGNORED_RENAMES_RAW === "1"
// Fixture repositories live outside the source tree: //packages:compiler-test
// keys every file under the flow, and a jj workspace would snapshot them.
const fixtures = mkdtempSync(join(tmpdir(), "ignored-rename-fixtures-"))
after(() => rmSync(fixtures, { recursive: true, force: true }))
const put = (root, path, text) => {
  mkdirSync(dirname(join(root, path)), { recursive: true })
  writeFileSync(join(root, path), text)
}

test("fixture repositories live outside the flow's source tree", () => {
  // //packages:compiler-test keys every file under the flow, hidden directories
  // included, while //packages:migrate-test runs this file beside it.
  const flow = fileURLToPath(new URL("..", import.meta.url))
  assert.ok(!fixtures.startsWith(flow), fixtures)
})

test("the migration contract records the files the batch renamed", () => {
  assert.ok(contract.includes("Renames the batch to `.vibe`"))
  assert.ok(contract.includes("Commits the batch with jj, naming its files"))
})

function refusalReason(error, root, from, to) {
  const reason = String(error.message).replaceAll(root, "<root>").replaceAll(from, "<source>").replaceAll(to, "<target>")
  return /\bignor(?:ed|e)\b|\btrack(?:ed|ing)?\b/i.test(reason)
}

function missingRecordedTarget(tracked, recorded, to, source) {
  if (!tracked.includes(to) && recorded === null) return true
  assert.ok(tracked.includes(to), "recorded source and tracked set must agree")
  assert.equal(recorded, source, "record must preserve every source byte")
  return false
}

test("pending guards reject path-only error matches and changed recorded bytes", () => {
  const root = "/scratch/ignored-rename/case"
  assert.equal(refusalReason(new Error("ENOENT: no such file " + root + "/src/lib/a.ts"), root, "src/lib/a.ts", "src/lib/a.vibe"), false)
  assert.equal(refusalReason(new Error("Cannot rename an ignored target: " + root + "/src/lib/a.vibe"), root, "src/lib/a.ts", "src/lib/a.vibe"), true)
  assert.equal(missingRecordedTarget([], null, "a.vibe", "same"), true)
  assert.throws(() => missingRecordedTarget(["a.vibe"], "changed", "a.vibe", "same"), /preserve every source byte/)
  assert.throws(() => missingRecordedTarget([], "same", "a.vibe", "same"), /tracked set must agree/)
})

async function inspect(input) {
  const root = mkdtempSync(join(fixtures, "case-"))
  try {
    await must("jj git init", { cwd: root })
    await must("jj config set --repo user.name test", { cwd: root })
    await must("jj config set --repo user.email test@localhost", { cwd: root })
    const from = input.directory + "/" + input.stem + ".ts"
    const to = from.replace(/\.ts$/, ".vibe")
    const source = input.body.replaceAll("\\n", "\n")
    put(root, from, source)
    put(root, "unrelated.ts", "export const unrelated = 2\n")
    await Jj.commit(root, "tracked source")
    // Adding the ignore after the first snapshot models an already tracked
    // source under an ignored directory without a force-track workaround.
    const ignored = input.ignored
      ? input.ignore === "directory" ? input.directory.split("/").at(-1) + "/\n"
        : input.ignore === "extension" ? "*.vibe\n" : "/" + to + "\n"
      : "# no ignored source targets\n"
    put(root, ".gitignore", ignored)
    await Jj.commit(root, "ignore generated paths")
    const base = await Jj.commitId(root)
    assert.ok((await Jj.trackedFiles(root)).includes(from), "setup must track the original")
    let refusal
    try {
      const renames = renameBatch(root, [from])
      assert.deepEqual(renames, [{ from, to }])
    } catch (error) {
      if (!refusalReason(error, root, from, to)) throw error
      refusal = error.message
    }
    if (refusal) {
      assert.ok(input.ignored, "ordinary source must not be refused")
      assert.equal(readFileSync(join(root, from), "utf8"), source, "refusal preserves source")
      assert.ok(!existsSync(join(root, to)), "refusal must happen before renaming")
      assert.equal(readFileSync(join(root, "unrelated.ts"), "utf8"), "export const unrelated = 2\n")
      return { issues: [], refused: true }
    }
    assert.equal(readFileSync(join(root, to), "utf8"), source, "rename preserves source bytes")
    assert.ok(!existsSync(join(root, from)), "accepted rename removes only the old name")
    await Jj.commit(root, "record renamed batch")
    const tracked = await Jj.trackedFiles(root)
    const issues = []
    if (missingRecordedTarget(tracked, await Jj.fileAt(root, "@-", to), to, source)) issues.push("record-drops-target")
    assert.ok(!tracked.includes(from), "record must not retain the removed source path")
    await Jj.restore(root, base, [from, to])
    assert.equal(readFileSync(join(root, from), "utf8"), source, "restore must recover original bytes")
    if (existsSync(join(root, to))) {
      assert.equal(readFileSync(join(root, to), "utf8"), source, "ignored residue must still preserve source bytes")
      issues.push("restore-keeps-target")
    }
    assert.equal(readFileSync(join(root, "unrelated.ts"), "utf8"), "export const unrelated = 2\n")
    return { issues, refused: false }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

async function check(input) {
  const result = await inspect(input)
  if (input.ignored && corpus.knownFailure && !raw) {
    assert.ok(result.issues.length > 0, "XPASS " + corpus.knownFailure.key + ": remove the retired knownFailure")
    assert.deepEqual(result.issues, corpus.knownFailure.issues, "only the exact recorded omission and ignored restore residue are pending")
  } else {
    assert.deepEqual(result.issues, [], "record and revert preserve a renamed source: " + JSON.stringify(input))
  }
}

test("alchemy-45: a tracked source in an ignored directory is recorded and restored safely", async () => {
  await check(corpus.input)
  await check({ ...corpus.input, ignored: false })
})

test("ignored rename neighbourhood preserves every source or refuses before mutation", async () => {
  await fc.assert(fc.asyncProperty(fc.record({
    directory: fc.tuple(fc.constantFrom("src", "packages/pkg/src"), fc.constantFrom("lib", "generated", "sp ace", "nested/cache")).map(parts => parts.join("/")),
    stem: fc.stringMatching(/^[A-Z][a-z]{0,5}$/),
    ignore: fc.constantFrom("directory", "extension", "exact"),
    ignored: fc.boolean(),
    body: fc.constantFrom("export const value = 1\n", "export function keep(): string { return 'same' }\n", "// preserve this source\nexport {}\n"),
  }), check), { seed: 450045, numRuns: 18, endOnFailure: true })
})
