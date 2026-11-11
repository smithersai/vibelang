import assert from "node:assert/strict"
import test from "node:test"
import { declarationFixture } from "./testing/package-declaration.mjs"

test("Go package shards bound tests and compilation within ten minutes", () => {
  const graph = declarationFixture("PACKAGE.ts").targets
  const shards = Object.entries(graph).filter(([name]) => /^go-vibelang-shard-\d+$/.test(name))
  assert.ok(shards.length > 1, "split the package suite before reducing its deadline")
  for (const [label, target] of shards) {
    const match = target.shell.match(/-test\.timeout=(\d+)m/)
    assert.ok(match, label + ": explicit Go deadline")
    const inner = Number(match[1])
    const outer = Number(target.timeout.match(/^(\d+)m$/)?.[1])
    assert.ok(inner > 0 && inner <= 8, label + ": Go tests finish within eight minutes")
    assert.ok(outer >= inner + 2 && outer <= 10, label + ": leave launcher headroom within ten minutes")
  }
})
