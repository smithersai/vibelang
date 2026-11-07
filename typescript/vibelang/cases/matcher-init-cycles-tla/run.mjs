// rule-evidence: docs/design/src/008-runtime.md#runtime-guarantees | Cycles and top-level `await` keep their ordinary TypeScript meanings.
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const here = path.dirname(fileURLToPath(import.meta.url))
function trace(file) {
  const url = pathToFileURL(path.join(here, "out", file)).href
  const r = spawnSync(process.execPath, ["--input-type=module", "-e", `const m = await import(${JSON.stringify(url)}); console.log(JSON.stringify(m.trace))`], { cwd: here, encoding: "utf8", timeout: 30_000 })
  assert.equal(r.status, 0, r.stdout + r.stderr)
  return JSON.parse(r.stdout)
}
const vibe = trace("entry.js"), native = trace("entry-ts.js")
assert.deepEqual(vibe, native, "the VibeLang modules evaluate as their TypeScript twins")
for (const event of vibe) console.log(event)
// Stable rule id: docs/design/src/008-runtime.md#6cf98677eb8ae9a9
