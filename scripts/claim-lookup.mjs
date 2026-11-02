import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

// Advisory only: keep the timestamp, lane and original key so a human can
// distinguish an active claim from a stale one before appending a new claim.
const normalize = key => key.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()
const stems = key => new Set(key.toLowerCase().split(/[:/\s]+/).filter(part =>
  /^[a-z0-9]+(?:[-_.][a-z0-9]+){2,}$/.test(part)).map(normalize))

export function lookup(text, query, now = Date.now(), hours = 6) {
  if (!query.trim()) throw new Error("claim key must not be empty")
  if (!Number.isFinite(now) || !Number.isFinite(hours) || hours <= 0) throw new Error("invalid time window")
  const latest = new Map()
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^(\S+)\s+(\S+)\s+(\S+)(?:\s+(.*))?$/)
    if (!match) continue
    const [, timestamp, key, lane, note = ""] = match
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(timestamp)) continue
    const time = Date.parse(timestamp)
    if (!Number.isFinite(time)) continue
    const identity = lane + "\0" + key
    const old = latest.get(identity)
    if (old && old.time > time) continue
    const released = /^(?:RELEASED|WITHDRAWN|SUPERSEDED)\b/i.test(note)
    latest.set(identity, { timestamp, time, key, lane, released })
  }
  const wanted = normalize(query)
  const corpus = stems(query)
  return [...latest.values()].flatMap(entry => {
    const normalized = normalize(entry.key)
    let reason
    if (entry.key === query) reason = "exact"
    else if (normalized === wanted) reason = "punctuation alias"
    else if ([...stems(entry.key)].some(stem => corpus.has(stem))) reason = "shared corpus stem"
    else return []
    const ageHours = Math.max(0, now - entry.time) / 3600000
    return [{ timestamp: entry.timestamp, key: entry.key, lane: entry.lane, reason,
      active: !entry.released && ageHours < hours, released: entry.released,
      ageHours: Math.round(ageHours * 1000) / 1000 }]
  }).sort((a, b) => Number(b.active) - Number(a.active) || Date.parse(b.timestamp) - Date.parse(a.timestamp))
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [file, query, ...args] = process.argv.slice(2)
  let now = Date.now()
  if (args.length === 2 && args[0] === "--now") now = Date.parse(args[1])
  else if (args.length) throw new Error("usage: claim-lookup.mjs CLAIMS KEY [--now ISO_TIME]")
  if (!file || !query) throw new Error("usage: claim-lookup.mjs CLAIMS KEY [--now ISO_TIME]")
  process.stdout.write(JSON.stringify(lookup(readFileSync(file, "utf8"), query, now), null, 2) + "\n")
}
