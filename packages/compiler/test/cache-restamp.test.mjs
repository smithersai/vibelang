import { strict as assert } from "node:assert"
import { chmodSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { test } from "node:test"
import { cacheProject, pastRacyWindow, skip } from "./cache-harness.mjs"

// A package manager that hard-links the same compiler into another install
// changes its ctime but not its bytes. Each later process then read and hashed
// the whole compiler for every project it loaded. A hit records the new stamp,
// so later processes check the compiler by stat alone.
test("a hit after the compiler's stamp changed but not its bytes records the new stamp", { skip }, async (t) => {
  const project = cacheProject(t, { "src/main.vibe": "export const value = 1\n" })
  const { compiler, entry } = project
  await project.settle()
  assert.ok(project.compile().compiled)
  const stamp = () => {
    const stat = statSync(compiler)
    return [stat.size, stat.mtimeMs, stat.ctimeMs, stat.ino]
  }
  const stored = () => JSON.parse(readFileSync(entry.file, "utf8")).compiler
  assert.deepEqual(stored(), [[compiler, stamp()]], "the compile was cached")
  chmodSync(compiler, 0o644)
  // restamp records only a compiler stamp outside the race window.
  await pastRacyWindow([compiler])
  assert.notDeepEqual(stored(), [[compiler, stamp()]])
  assert.equal(project.compile().compiled, false, "same bytes keep the cache")
  assert.deepEqual(stored(), [[compiler, stamp()]], "the entry now holds the compiler's current stamp")
  assert.equal(project.compile().compiled, false)
  writeFileSync(compiler, readFileSync(compiler, "utf8") + "// rebuilt\n")
  const rebuilt = project.compile()
  assert.ok(rebuilt.compiled, "a compiler with new bytes recompiles")
  assert.match(rebuilt.messages.join("\n"), /\(compiler changed\)/)
})
