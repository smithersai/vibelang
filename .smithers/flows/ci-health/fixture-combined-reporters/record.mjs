// Generate a joint history from the two actual reporter fixture histories.
import assert from "node:assert/strict"
import { readFileSync, writeFileSync } from "node:fs"

const sources = ["../fixture-node-reporter/", "../fixture-migrate-reporter/"]
for (let i = 1; i <= 4; i++) {
  const stem = "run-0" + i + "-graph"
  const histories = sources.map(dir => new URL(dir + stem, import.meta.url))
  const results = histories.flatMap(url => JSON.parse(readFileSync(new URL(url.href + ".json"), "utf8")).results)
  assert.equal(new Set(results.map(item => item.label)).size, 2)
  assert.ok(results.every(item => item.key && item.status === (i % 2 ? "failed" : "ran")))
  writeFileSync(new URL(stem + ".json", import.meta.url), JSON.stringify({ results }, null, 2) + "\n")
  writeFileSync(new URL(stem + ".log", import.meta.url), histories.map(url => readFileSync(new URL(url.href + ".log"), "utf8")).join("\n"))
}

