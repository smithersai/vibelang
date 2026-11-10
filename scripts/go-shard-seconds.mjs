#!/usr/bin/env node
// Writes <package>/testdata/shard-seconds.txt, used by scripts/go-test-shards.sh.
// Prefer uncached go test -json: its event timestamps include parallel subtests,
// whereas Go's top-level Elapsed and verbose duration can exclude their work.
// Plain -v logs remain supported for tests without parallel descendants.
//
// node scripts/go-shard-seconds.mjs <package dir> <logs>... [--update] [--note text]
// --update replaces observed costs (including skips) and retains unseen names.
// Several new observations of one name keep their slowest cost.
import fs from "node:fs"
import path from "node:path"

export const MIN_SECONDS = 5
function timestamp(value) {
  const match = typeof value === "string" && /^(.*?)(?:\.(\d{1,9}))?(Z|[+-]\d\d:\d\d)$/.exec(value)
  const millis = match && Date.parse(match[1] + match[3])
  if (!match || !Number.isFinite(millis)) throw new Error("test timing needs valid JSON Time fields")
  return BigInt(millis) * 1_000_000n + BigInt((match[2] ?? "").padEnd(9, "0"))
}

const topLevel = /^--- (?:PASS|SKIP): (\S+) \((\d+(?:\.\d+)?)s\)$/

function observedSeconds(logs) {
  const observed = new Map()
  const record = (name, seconds) => {
    if (!Number.isFinite(seconds) || seconds < 0) throw new Error("invalid test duration")
    observed.set(name, Math.max(observed.get(name) ?? 0, Math.ceil(seconds)))
  }
  for (const text of logs) {
    if (/^=== PAUSE\s+\S+\/\S+/m.test(text)) {
      throw new Error("parallel subtests need go test -json timestamps; use -count=1")
    }
    const running = new Map()
    for (const line of text.split("\n")) {
      const match = topLevel.exec(line)
      if (match && !match[1].includes("/")) {
        record(match[1], Number(match[2]))
        continue
      }
      if (!line.startsWith("{")) continue
      let event
      try { event = JSON.parse(line) } catch { continue }
      if (event.Action === "output" && !event.Test && /^ok\s+.*\(cached\)\s*$/m.test(event.Output ?? "")) {
        throw new Error("cached timing cannot measure parallel work; use -count=1")
      }
      if (typeof event.Test !== "string" || event.Test.includes("/")) continue
      const key = JSON.stringify([event.Package, event.Test])
      if (event.Action === "fail") { running.delete(key); continue }
      if (!["run", "pause", "cont", "pass", "skip"].includes(event.Action)) continue
      const time = timestamp(event.Time)
      if (event.Action === "run") {
        if (running.has(key)) throw new Error("test timing has a duplicate run event")
        running.set(key, { resumed: time, elapsed: 0n, last: time })
        continue
      }
      const state = running.get(key)
      if (!state) throw new Error("test timing is missing its run event")
      if (time < state.last) throw new Error("test timing moved backwards")
      state.last = time
      const advance = () => {
        if (state.resumed !== null) {
          if (time < state.resumed) throw new Error("test timing moved backwards")
          state.elapsed += time - state.resumed
          state.resumed = null
        }
      }
      if (event.Action === "pause") { advance(); continue }
      if (event.Action === "cont") {
        if (state.resumed === null) state.resumed = time
        continue
      }
      advance()
      const reported = event.Elapsed ?? 0
      if (!Number.isFinite(reported) || reported < 0) throw new Error("invalid JSON Elapsed field")
      record(event.Test, Math.max(reported, Number(state.elapsed) / 1e9))
      running.delete(key)
    }
    if (running.size) throw new Error("test timing has an unfinished run event")
  }
  return observed
}

function mergeRows(observed, existingRows) {
  return [...new Map([...existingRows, ...observed])].filter(([, seconds]) => seconds >= MIN_SECONDS)
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
}

export function shardSeconds(logs, { existingRows = [] } = {}) {
  return mergeRows(observedSeconds(logs), existingRows)
}

export function render(rows, { date, note }) {
  const header = [
    `# Seconds each test or fuzz target took, slowest run of each name (${date}${note ? `, ${note}` : ""}), for`,
    "# scripts/go-test-shards.sh, which spreads the slowest across its processes. Names not listed count 1 s; a stale",
    "# line only unbalances the processes. Refresh: node scripts/go-shard-seconds.mjs <package dir> <go test -json -count=1 log>...",
  ]
  return [...header, ...rows.map(([name, seconds]) => `${seconds} ${name}`)].join("\n") + "\n"
}

if (process.argv[1] && import.meta.url === new URL(process.argv[1], "file://").href) {
  const args = process.argv.slice(2)
  const noteAt = args.indexOf("--note")
  const note = noteAt >= 0 ? args.splice(noteAt, 2)[1] : ""
  const updateAt = args.indexOf("--update")
  const update = updateAt >= 0
  if (update) args.splice(updateAt, 1)
  const [pkg, ...logs] = args
  if (!pkg || logs.length === 0) {
    console.error("usage: node scripts/go-shard-seconds.mjs <package dir> <logs>... [--update] [--note text]")
    process.exit(2)
  }
  const out = path.join(pkg, "testdata", "shard-seconds.txt")
  const existingRows = update && fs.existsSync(out)
    ? fs.readFileSync(out, "utf8").split("\n").filter(line => line && !line.startsWith("#")).map(line => {
      const match = /^(\d+) (\S+)$/.exec(line)
      if (!match) throw new Error("invalid existing shard cost row")
      return [match[2], Number(match[1])]
    }) : []
  const observed = observedSeconds(logs.map(file => fs.readFileSync(file, "utf8")))
  if (observed.size === 0) {
    console.error("no top-level timings: run go test with -v for serial tests or -json -count=1 for parallel tests")
    process.exit(1)
  }
  const rows = mergeRows(observed, existingRows)
  fs.mkdirSync(path.dirname(out), { recursive: true })
  fs.writeFileSync(out, render(rows, { date: new Date().toISOString().slice(0, 10), note }))
  console.log(out + ": " + rows.length + " names" + (rows[0] ? ", slowest " + rows[0][1] + " s " + rows[0][0] : ""))
}
