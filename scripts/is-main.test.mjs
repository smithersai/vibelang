import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdtempSync, rmSync, symlinkSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"

const repoRoot = fileURLToPath(new URL("../", import.meta.url))

function symlinkedRepo(t, name = "repo-link") {
  const dir = mkdtempSync(join(tmpdir(), "vibelang-is-main-"))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const link = join(dir, name)
  symlinkSync(repoRoot, link)
  return link
}

test("CLI scripts run their entrypoint when invoked through a symlinked directory", (t) => {
  const link = symlinkedRepo(t, "link#with?chars")

  // select.mjs prints fuzz labels when given map.json on stdin
  const select = spawnSync(process.execPath, [join(link, "scripts/fuzz-gate/select.mjs")], {
    input: "scripts/fuzz-gate/map.json\n",
    encoding: "utf8",
  })
  assert.equal(select.status, 0, select.stderr)
  assert.ok(select.stdout.trim().length > 0, "select.mjs should emit labels through a symlink")

  // repack.mjs exits non-zero on a missing directory instead of silently exiting 0
  const repack = spawnSync(process.execPath, [join(link, "scripts/release/repack.mjs"), join(link, "no-such-dir")], {
    encoding: "utf8",
  })
  assert.notEqual(repack.status, 0, "repack.mjs must not silently exit 0 through a symlink")

  // generate-grammar-admission.mjs --root <missing> --check exits non-zero
  const grammar = spawnSync(process.execPath, [join(link, "scripts/generate-grammar-admission.mjs"), "--root", join(link, "no-such-dir"), "--check"], {
    encoding: "utf8",
  })
  assert.notEqual(grammar.status, 0, "generate-grammar-admission.mjs must not silently exit 0 through a symlink")

  // go-shard-seconds.mjs with no arguments exits 2 (usage), even through a path containing # and ?
  const shards = spawnSync(process.execPath, [join(link, "scripts/go-shard-seconds.mjs")], {
    encoding: "utf8",
  })
  assert.equal(shards.status, 2, `go-shard-seconds.mjs should exit 2 on missing args, got ${shards.status}: ${shards.stderr}`)

  // spec-rule-judge/score.mjs <missing> exits non-zero
  const score = spawnSync(process.execPath, [join(link, "scripts/spec-rule-judge/score.mjs"), join(link, "no-such-file.json")], {
    encoding: "utf8",
  })
  assert.notEqual(score.status, 0, "spec-rule-judge/score.mjs must not silently exit 0 through a symlink")
})
