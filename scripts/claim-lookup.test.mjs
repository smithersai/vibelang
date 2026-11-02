import assert from "node:assert/strict"
import { test } from "node:test"
import { lookup } from "./claim-lookup.mjs"

const now = Date.parse("2026-10-31T08:00:00Z")
const original = "FuzzCompile:match-flow-limit-cubic:stale-hang"
const alias = "FuzzCompile/match-flow-limit-cubic"
const pair = "2026-10-31T07:14:01Z " + original + " maint-sol\n" +
  "2026-10-31T07:28:12Z " + alias + " fix-hang-cubic\n"

test("the actual duplicate pattern exposes both lanes where exact grep found one", () => {
  assert.equal(pair.split("\n").filter(line => line.includes(original)).length, 1)
  const matches = lookup(pair, original, now)
  assert.deepEqual(matches.map(match => match.lane).sort(), ["fix-hang-cubic", "maint-sol"])
  assert.ok(matches.every(match => match.active))
  assert.equal(matches.find(match => match.lane === "fix-hang-cubic").reason, "shared corpus stem")
})

test("punctuation variants have the same identity without matching unrelated targets", () => {
  for (let n = 0; n < 128; n++) {
    const separators = [":", "/", ".", "_", " ", "-"]
    // Claim keys contain no spaces; normalize separators inside identifiers.
    const key = ["editor", "quickfix", "EK4802", "EK2001"].join(separators[n % 5 === 4 ? 5 : n % 5])
    const text = "2026-10-31T07:00:00Z " + key + " other\n"
    assert.equal(lookup(text, "editor:quickfix:EK4802:EK2001", now).length, 1, key)
  }
  assert.deepEqual(lookup(pair, "FuzzCompile:other-flow-limit-cubic", now), [])
  assert.deepEqual(lookup(pair, "FuzzCompile", now), [])
  assert.deepEqual(lookup(pair, "stale-hang", now), [])
})

test("latest exact-key state wins by time, including releases and renewals", () => {
  const text = [
    "2026-10-31T07:50:00Z editor:EK2001 lane RELEASED duplicate",
    "2026-10-31T07:00:00Z editor:EK2001 lane earlier claim",
    "2026-10-31T07:55:00Z editor:EK2001 other RENEWED",
    "2026-10-31T01:00:00Z editor:EK2001 stale",
    "broken timestamp should not become a claim",
    "# heading"
  ].join("\n")
  const matches = lookup(text, "editor:EK2001", now)
  assert.deepEqual(matches.map(m => [m.lane, m.active, m.released]), [
    ["other", true, false], ["lane", false, true], ["stale", false, false]
  ])
})

test("the six-hour boundary expires a claim and timezone offsets work", () => {
  const text = "2026-10-30T19:00:00-07:00 editor:EK2001 lane\n"
  assert.equal(lookup(text, "editor:EK2001", now)[0].active, false)
  assert.equal(lookup(text, "editor:EK2001", now - 1)[0].active, true)
  assert.throws(() => lookup(text, " ", now))
  assert.throws(() => lookup(text, "key", NaN))
})

test("mixed timezone spellings sort by instant, not by string", () => {
  const text = "2026-10-31T07:30:00Z editor:EK2001 earlier\n" +
    "2026-10-31T00:45:00-07:00 editor/EK2001 later\n"
  assert.deepEqual(lookup(text, "editor:EK2001", now).map(m => m.lane), ["later", "earlier"])
})

test("releasing one spelling never silently releases another alias", () => {
  const text = "2026-10-31T07:00:00Z editor/EK2001 lane\n" +
    "2026-10-31T07:50:00Z editor:EK2001 lane RELEASED\n"
  const matches = lookup(text, "editor:EK2001", now)
  assert.equal(matches.length, 2)
  assert.equal(matches[0].key, "editor/EK2001")
  assert.equal(matches[0].active, true)
  assert.equal(matches[1].released, true)
})

test("a renewal reactivates only its exact key and malformed dates are ignored", () => {
  const text = [
    "2026-10-31T07:00:00Z editor:EK2001 lane RELEASED",
    "2026-10-31T07:30:00.123456Z editor:EK2001 lane RENEWED",
    "not-a-date editor:EK2001 bad",
    "1 editor:EK2001 bad"
  ].join("\n")
  const matches = lookup(text, "editor:EK2001", now)
  assert.equal(matches.length, 1)
  assert.equal(matches[0].active, true)
  assert.equal(matches[0].released, false)
})

test("the CLI reads the real log format without modifying the log", async t => {
  const { mkdtempSync, readFileSync, writeFileSync, rmSync } = await import("node:fs")
  const { tmpdir } = await import("node:os")
  const { join } = await import("node:path")
  const { spawnSync } = await import("node:child_process")
  const dir = mkdtempSync(join(tmpdir(), "vibe-claims-"))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const file = join(dir, "claims.txt")
  writeFileSync(file, pair)
  const run = spawnSync(process.execPath, [new URL("claim-lookup.mjs", import.meta.url).pathname,
    file, original, "--now", "2026-10-31T08:00:00Z"], { encoding: "utf8", timeout: 5000 })
  assert.equal(run.status, 0, run.stderr)
  assert.deepEqual(JSON.parse(run.stdout).map(m => m.lane).sort(), ["fix-hang-cubic", "maint-sol"])
  assert.equal(readFileSync(file, "utf8"), pair)
  const missing = spawnSync(process.execPath, [new URL("claim-lookup.mjs", import.meta.url).pathname,
    join(dir, "missing"), original], { encoding: "utf8", timeout: 5000 })
  assert.notEqual(missing.status, 0)
  assert.equal(missing.stdout, "")
})
