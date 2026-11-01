import assert from "node:assert/strict"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { test } from "node:test"
import * as Jj from "../lib/jj.mjs"
import { must } from "../lib/util.mjs"

const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const fc = require("fast-check")
const contract = readFileSync(new URL("../README.md", import.meta.url), "utf8")
// The README's promise that a batch's renamed module is formatted: the files the
// batch wrote reach the formatter by the path they have now.
const quote = "Record then formats the batch's `.vibe` files"

const init = (root) => must("jj git init && jj config set --repo user.name test && jj config set --repo user.email test@localhost", { cwd: root })
const body = (seed) => Array.from({ length: 40 }, (_, i) => `export const v${i} = ${JSON.stringify(seed + ":" + i)}`).join("\n") + "\n"
const put = (root, path, text) => {
  mkdirSync(dirname(join(root, path)), { recursive: true })
  writeFileSync(join(root, path), text)
}

test("smithers batch 03: a module the batch renamed to .vibe is changed under its new path", async () => {
  assert.ok(contract.includes(quote), "update the quoted record contract")
  const corpus = JSON.parse(readFileSync(new URL("./corpus/smithers-record-renamed-vibe.json", import.meta.url), "utf8"))
  for (const { line, entry } of corpus.summary) assert.deepEqual(Jj.summaryEntry(line), entry, line)
  const root = mkdtempSync(join(tmpdir(), "migrate-jj-rename-"))
  try {
    await init(root)
    const source = "packages/smithers/flows/crypto/src/Crypto.ts"
    put(root, source, body("crypto"))
    await Jj.commit(root, "base")
    const target = source.replace(/\.ts$/, ".vibe")
    renameSync(join(root, source), join(root, target))
    writeFileSync(join(root, target), readFileSync(join(root, target), "utf8") + "export const added = 1\n")
    assert.deepEqual(await Jj.changedPaths(root), [{ status: "R", path: target, from: source }])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

// Renames across and within directories, extension changes, edits, deletions
// and additions in one working-copy change, against a real jj repository: each
// path changedPaths reports other than a deletion exists now, the set of them
// is every file that is new or changed, and a rename's from is a base file
// that is gone.
test("changedPaths names every changed file by the path it has now", async () => {
  const segment = fc.constantFrom("a", "b", "src", "test", "flows", "sp ace")
  const dir = fc.array(segment, { maxLength: 3 }).map((parts) => parts.join("/"))
  const stem = fc.stringMatching(/^[A-Z][a-z]{0,6}$/)
  const file = fc.record({ dir, stem, ext: fc.constantFrom(".ts", ".tsx", ".mts") })
  const op = fc.constantFrom("keep", "edit", "delete", "rename", "rename-edit", "move", "move-vibe")
  const plan = fc.array(fc.record({ file, op, to: dir }), { minLength: 1, maxLength: 6 })
  await fc.assert(fc.asyncProperty(plan, async (entries) => {
    const root = mkdtempSync(join(tmpdir(), "migrate-jj-renames-"))
    try {
      await init(root)
      const files = []
      for (const [i, { file: f, op: o, to }] of entries.entries()) {
        const path = (f.dir ? f.dir + "/" : "") + f.stem + i + f.ext
        files.push({ path, op: o, to: (to ? to + "/" : "") + "Moved" + i + f.ext })
        put(root, path, body(path))
      }
      await Jj.commit(root, "base")
      const expected = new Map()
      for (const { path, op: o, to } of files) {
        const vibe = path.replace(/\.[mc]?tsx?$/, ".vibe")
        const next = o === "rename" || o === "rename-edit" ? vibe : o === "move" ? to : o === "move-vibe" ? to.replace(/\.[mc]?tsx?$/, ".vibe") : path
        if (o === "delete") rmSync(join(root, path))
        else if (next !== path) {
          mkdirSync(dirname(join(root, next)), { recursive: true })
          renameSync(join(root, path), join(root, next))
        }
        if (o === "edit" || o === "rename-edit") writeFileSync(join(root, next), readFileSync(join(root, next), "utf8") + "export const edited = 1\n")
        if (o !== "keep" && o !== "delete" && (next !== path || o === "edit" || o === "rename-edit")) expected.set(next, path)
      }
      put(root, "Added.ts", "export const added = 1\n")
      expected.set("Added.ts", null)
      const changed = await Jj.changedPaths(root)
      const live = changed.filter((c) => c.status !== "D")
      for (const c of live) assert.ok(existsSync(join(root, c.path)), `${c.status} ${c.path} does not exist`)
      for (const c of changed.filter((c) => c.status === "R" || c.status === "C")) {
        assert.ok(files.some((f) => f.path === c.from), `${c.from} was not a base file`)
        if (c.status === "R") assert.ok(!existsSync(join(root, c.from)), `${c.from} still exists`)
      }
      assert.deepEqual(live.map((c) => c.path).sort(), [...expected.keys()].sort())
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  }), { seed: 31103, numRuns: 12 })
})
