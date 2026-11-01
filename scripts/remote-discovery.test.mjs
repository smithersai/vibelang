import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { delimiter, join } from "node:path"
import { test } from "node:test"

const source = process.env.VIBELANG_REMOTE_SCRIPT ?? new URL("./remote.sh", import.meta.url)
const normal = ["src/main.vibe", "nested/dist/fixture.js", "case/node_modules/pkg/index.js", "distinct/source.vibe"]

function run(t, { listing = normal, discovery = 0, filter = 0 } = {}) {
  const root = mkdtempSync(join(tmpdir(), "vibelang remote discovery-"))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const workspace = join(root, "workspace")
  const bin = join(root, "bin")
  const temporary = join(root, "temporary")
  for (const dir of [join(workspace, ".jj"), join(workspace, "scripts"), bin, temporary]) mkdirSync(dir, { recursive: true })
  cpSync(source, join(workspace, "scripts/remote.sh"))
  const trace = join(root, "calls.jsonl")
  const executable = (name, body) => {
    const file = join(bin, name)
    writeFileSync(file, "#!" + process.execPath + "\n" + body)
    chmodSync(file, 0o755)
  }
  // Transport is recorded locally. No fixture opens SSH or runs the test remotely.
  executable("ssh", 'require("node:fs").appendFileSync(process.env.REMOTE_TRACE, JSON.stringify({tool:"ssh",args:process.argv.slice(2)})+"\\n")')
  executable("rsync", [
    'const fs = require("node:fs")',
    'const args = process.argv.slice(2)',
    'const file = args.find(arg => arg.startsWith("--files-from="))?.slice(13)',
    'fs.appendFileSync(process.env.REMOTE_TRACE, JSON.stringify({tool:"rsync",args,listing:file?fs.readFileSync(file,"utf8"):null})+"\\n")'
  ].join("\n"))
  executable("jj", [
    'const assert = require("node:assert/strict")',
    'assert.deepEqual(process.argv.slice(2), ["file", "list"])',
    'process.stdout.write(JSON.parse(process.env.REMOTE_LIST).join("\\n")+"\\n")',
    'if (Number(process.env.REMOTE_DISCOVERY)) console.error("fixture discovery failure")',
    'process.exit(Number(process.env.REMOTE_DISCOVERY))'
  ].join("\n"))
  const grep = spawnSync("sh", ["-c", "command -v grep"], { encoding: "utf8" }).stdout.trim()
  executable("grep", [
    'if (Number(process.env.REMOTE_FILTER)) {console.error("fixture filter failure");process.exit(Number(process.env.REMOTE_FILTER))}',
    'const result = require("node:child_process").spawnSync(' + JSON.stringify(grep) + ',process.argv.slice(2),{stdio:"inherit"})',
    'process.exit(result.status ?? 1)'
  ].join("\n"))
  // Avoid creating a real SSH control directory.
  executable("mkdir", "")
  const result = spawnSync("sh", [join(workspace, "scripts/remote.sh"), "printf", "remote test"], {
    cwd: workspace, encoding: "utf8", env: {
      ...process.env, PATH: bin + delimiter + process.env.PATH, TMPDIR: temporary,
      ES_REMOTE_HOST: "fixture.invalid", ES_REMOTE_KEY: join(root, "unused-key"),
      REMOTE_TRACE: trace, REMOTE_LIST: JSON.stringify(listing),
      REMOTE_DISCOVERY: String(discovery), REMOTE_FILTER: String(filter)
    }
  })
  const calls = existsSync(trace) ? readFileSync(trace, "utf8").trim().split("\n").map(line => JSON.parse(line)) : []
  assert.deepEqual(readdirSync(temporary), [], "discovery scratch must be removed on every exit")
  return { ...result, calls }
}

for (const listing of [normal, ["src/main.vibe"], []]) {
  test("remote sync accepts a complete listing: " + JSON.stringify(listing), t => {
    const result = run(t, { listing })
    assert.equal(result.status, 0, result.stdout + result.stderr)
    const copies = result.calls.filter(call => call.tool === "rsync")
    const wanted = listing.filter(file => /(^|\/)(node_modules|dist)(\/|$)/.test(file))
    assert.equal(copies.length, wanted.length ? 2 : 1)
    if (wanted.length) assert.deepEqual(copies[1].listing.trim().split("\n"), wanted)
    assert.equal(result.calls.filter(call => call.tool === "ssh").length, 2, "successful discovery must run the requested command")
  })
}

for (const discovery of [1, 7, 37]) {
  for (const listing of [[], normal]) {
    test("remote sync stops on failed discovery, even with partial output: " + discovery + "/" + listing.length, t => {
      const result = run(t, { listing, discovery })
      assert.equal(result.status, discovery, result.stdout + result.stderr)
      assert.match(result.stderr, /fixture discovery failure/)
      assert.match(result.stderr, /remote.sh: tracked-file discovery failed/)
      assert.equal(result.calls.filter(call => call.tool === "ssh").length, 1, "must not execute remote tests")
      assert.equal(result.calls.filter(call => call.tool === "rsync").length, 1, "must not copy a partial fixture list")
    })
  }
}

for (const filter of [2, 7]) {
  test("remote sync stops on a failed tracked-file filter: " + filter, t => {
    const result = run(t, { filter })
    assert.equal(result.status, filter, result.stdout + result.stderr)
    assert.match(result.stderr, /fixture filter failure/)
    assert.match(result.stderr, /remote.sh: tracked-file filter failed/)
    assert.equal(result.calls.filter(call => call.tool === "ssh").length, 1)
    assert.equal(result.calls.filter(call => call.tool === "rsync").length, 1)
  })
}

test("remote fixture filtering preserves complete generated path lists", t => {
  // Exercise directory boundaries, spaces and near matches without a host connection.
  const names = ["dist", "node_modules", "distinct", "node_modules-old", "src"]
  for (let seed = 0; seed < 16; seed++) {
    const listing = Array.from({ length: 8 }, (_, i) =>
      (i % 2 ? "parent " + seed + "/" : "") + names[(seed + i * 3) % names.length] + "/file " + i + ".js")
    const result = run(t, { listing })
    assert.equal(result.status, 0, "seed " + seed + ": " + result.stdout + result.stderr)
    const copied = result.calls.find(call => call.tool === "rsync" && call.listing !== null)
    assert.deepEqual(copied.listing.trim().split("\n"),
      listing.filter(file => file.split("/").slice(0, -1).some(part => part === "dist" || part === "node_modules")),
      "seed " + seed)
  }
})
