import { strict as assert } from "node:assert"
import { existsSync } from "node:fs"
import { join } from "node:path"
import { test } from "node:test"
import { cacheProject, skip } from "./cache-harness.mjs"

// The wrapper rewrites the source after the native compiler has read it and
// before the compile returns, so its stamp is inside the race window whatever
// the host's speed.
test("a source written during compilation reports the cache timestamp safety margin", { skip }, async (t) => {
  const source = "src/main.vibe"

  const project = cacheProject(t, { [source]: "export const value = 1\n" }, undefined, {
    after: `import { readFileSync, writeFileSync } from "node:fs"
const path = new URL("./app/${source}", import.meta.url)
writeFileSync(path, readFileSync(path))`
  })
  const path = join(project.app, source)
  await project.settle()
  const first = project.compile()
  assert.deepEqual(first.result.errors, [])
  assert.ok(first.messages.includes(`not caching ${project.project}: ${path} changed during or too close to the compile`), first.messages.join("\n"))
  assert.equal(existsSync(project.entry.file), false)
  assert.ok(project.compile().compiled, "nothing was cached, so the next compile runs the compiler")
})
