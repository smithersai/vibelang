// #538: formatWritten split nothing, so record's whole-scope format of a few
// thousand rewritten importers exceeded Linux's single bash -c argument.
import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { formatWritten } from "../lib/steps.mjs"
import { chunkCommands } from "../lib/util.mjs"

const longPaths = (count) => Array.from({ length: count }, (_, i) => "packages/some-deep-package/src/" + String(i).padStart(4, "0") + "-" + "x".repeat(48) + ".ts")

test("5,000 long paths produce more than one formatter command, each below the argument limit", () => {
  const files = longPaths(5000)
  const commands = chunkCommands(["prettier", "--write"], files)
  assert.ok(commands.length > 1)
  for (const command of commands) assert.ok(Buffer.byteLength(command) <= 64 * 1024)
  assert.deepEqual(commands.flatMap(command => command.split(" ").slice(2).map(arg => arg.slice(1, -1))), files, "every file once, in order")
})

test("formatWritten formats 5,000 long paths in chunks and keeps every chunk's receipt", async () => {
  const root = mkdtempSync(join(tmpdir(), "migrate-format-written-"))
  try {
    const files = longPaths(5000)
    for (const file of files) {
      mkdirSync(dirname(join(root, file)), { recursive: true })
      writeFileSync(join(root, file), "export const a = 1\n")
    }
    writeFileSync(join(root, "package.json"), JSON.stringify({ devDependencies: { prettier: "3.0.0" } }))
    mkdirSync(join(root, "node_modules/.bin"), { recursive: true })
    const calls = join(root, "calls.jsonl"), log = join(root, "logs/format.log")
    writeFileSync(join(root, "node_modules/.bin/prettier"), '#!/usr/bin/env node\nrequire("node:fs").appendFileSync(' + JSON.stringify(calls) + ', JSON.stringify(process.argv.slice(2)) + "\\n")\n', { mode: 0o755 })
    assert.deepEqual(await formatWritten(root, files, log), { formatter: "prettier --write", files, code: 0 })
    const argv = readFileSync(calls, "utf8").trim().split("\n").map(JSON.parse)
    assert.ok(argv.length > 1)
    assert.deepEqual(argv.flatMap(args => args.slice(1)), files)
    assert.equal(readFileSync(log, "utf8").match(/^\$ .*$/gm).length, argv.length, "aggregate log retains every chunk")
  } finally { rmSync(root, { recursive: true, force: true }) }
})
