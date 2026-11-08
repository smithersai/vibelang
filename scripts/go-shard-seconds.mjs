#!/usr/bin/env node
// Writes <package>/testdata/shard-seconds.txt, the weights scripts/go-test-shards.sh deals its processes by, from
// the top-level `--- PASS|SKIP: Name (N.NNs)` lines of one or more `go test -v` logs of that package. A FAIL line is
// not read: a failing run's time is often a timeout's or a missing fixture's, not the test's (a box without the stock
// compiler put FuzzQuickFixBehavior at 1,373 s).
//
//   node scripts/go-shard-seconds.mjs <package dir> <go test -v log>... [--note "where the logs came from"]
//
// Subtests (names with a slash) are indented in -v output and are not read: a top-level line already holds its
// subtests' time. A name seen in several logs keeps its slowest time. Seconds round up to whole seconds, and a name
// under MIN_SECONDS is left out: the script counts an unlisted name as 1 s, and replaying the dealing of
// internal/vibelang's 1,715 tests (8,916 s measured) over six processes gave a 1,492 s wall listing every name at
// 2 s or more (1,105 names) and 1,513 s at 5 s or more (530 names), against 1,486 s ideal and 1,656 s with the
// 72-name file of 2026-11-01. The output is sorted slowest first, then by name, so a refresh from the same logs is
// byte-identical.
import fs from "node:fs"
import path from "node:path"

export const MIN_SECONDS = 5
const topLevel = /^--- (?:PASS|SKIP): (\S+) \((\d+(?:\.\d+)?)s\)$/

export function shardSeconds(logs) {
  const slowest = new Map()
  for (const text of logs) {
    for (const line of text.split("\n")) {
      const match = topLevel.exec(line)
      if (!match || match[1].includes("/")) continue
      const seconds = Math.ceil(Number(match[2]))
      if (seconds > (slowest.get(match[1]) ?? 0)) slowest.set(match[1], seconds)
    }
  }
  return [...slowest].filter(([, seconds]) => seconds >= MIN_SECONDS)
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
}

export function render(rows, { date, note }) {
  const header = [
    `# Seconds each test or fuzz target took, slowest run of each name (${date}${note ? `, ${note}` : ""}), for`,
    "# scripts/go-test-shards.sh, which spreads the slowest across its processes. Names not listed count 1 s; a stale",
    "# line only unbalances the processes. Refresh: node scripts/go-shard-seconds.mjs <package dir> <go test -v log>...",
  ]
  return [...header, ...rows.map(([name, seconds]) => `${seconds} ${name}`)].join("\n") + "\n"
}

if (process.argv[1] && import.meta.url === new URL(process.argv[1], "file://").href) {
  const args = process.argv.slice(2)
  const noteAt = args.indexOf("--note")
  const note = noteAt >= 0 ? args.splice(noteAt, 2)[1] : ""
  const [pkg, ...logs] = args
  if (!pkg || logs.length === 0) {
    console.error("usage: node scripts/go-shard-seconds.mjs <package dir> <go test -v log>... [--note text]")
    process.exit(2)
  }
  const rows = shardSeconds(logs.map((file) => fs.readFileSync(file, "utf8")))
  if (rows.length === 0) {
    console.error("no top-level `--- PASS|SKIP: Name (N.NNs)` lines: run go test with -v")
    process.exit(1)
  }
  const out = path.join(pkg, "testdata", "shard-seconds.txt")
  fs.mkdirSync(path.dirname(out), { recursive: true })
  fs.writeFileSync(out, render(rows, { date: new Date().toISOString().slice(0, 10), note }))
  console.log(`${out}: ${rows.length} names, slowest ${rows[0][1]} s ${rows[0][0]}`)
}
