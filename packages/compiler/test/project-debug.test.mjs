import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { test } from "node:test"
import fc from "fast-check"
import { projects } from "../project.mjs"

const root = fileURLToPath(new URL("../../../", import.meta.url))
const revisions = messages => messages.map(message => {
  assert.match(message, /\binvalidat\w*\b/i, "an invalidation is identifiable without a later compile")
  const match = /\brevision (\d+)\b/.exec(message)
  assert.ok(match, "the event identifies the new revision")
  return Number(match[1])
})

test("the Vite debug guides promise project invalidation diagnostics", () => {
  for (const path of ["docs/user/src/setup/vite.md", "packages/vite/README.md"]) {
    const text = readFileSync(join(root, path), "utf8")
    assert.match(text, /VIBELANG_VITE_DEBUG=1/)
    assert.match(text, /invalidations/)
  }
})

test("project invalidation reports its revision before another load", async () => {
  const messages = []
  const manager = projects({ root, debug: message => messages.push(message) })
  try {
    manager.invalidate()
    assert.deepEqual(revisions(messages), [1])
    manager.invalidate()
    assert.deepEqual(revisions(messages), [1, 2])
  } finally { await manager.close() }
})

test("project invalidation keeps the default logger optional", async () => {
  const manager = projects({ root })
  try { assert.doesNotThrow(() => manager.invalidate()) }
  finally { await manager.close() }
})

test("generated invalidation traces retain each manager's independent revisions", async () => {
  await fc.assert(fc.asyncProperty(
    fc.array(fc.integer({ min: 0, max: 3 }), { maxLength: 40 }),
    async operations => {
      const messages = Array.from({ length: 4 }, () => [])
      const expected = Array.from({ length: 4 }, () => [])
      const managers = messages.map(trace => projects({ root, debug: message => trace.push(message) }))
      try {
        for (const index of operations) {
          expected[index].push(expected[index].length + 1)
          managers[index].invalidate()
        }
        for (let index = 0; index < managers.length; index++) {
          assert.deepEqual(revisions(messages[index]), expected[index])
        }
      } finally { await Promise.all(managers.map(manager => manager.close())) }
    }
  ), { seed: 561106, numRuns: 200, examples: [[[0]], [[0, 1, 0, 3, 1]]] })
})
