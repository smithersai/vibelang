import { strict as assert } from "node:assert"
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { setTimeout as sleep } from "node:timers/promises"
import { projectCache } from "../cache.mjs"

// A stamp this recent is not trusted (cache.mjs racyMilliseconds); wait past it.
const settle = () => sleep(120)

// A pnpm install in another workspace hard-links the same compiler, which
// changes its ctime but not its bytes. Each later process then read and hashed
// the whole compiler (42.5 MB) for every project it loaded: about 65 ms each in
// the VibeLang Factory CLI (vl-bench, 2026-11-10).
test("a hit after the compiler's stamp changed but not its bytes records the new stamp", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "vibelang-cache-restamp-"))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const app = join(root, "app")
  mkdirSync(app)
  const project = join(app, "tsconfig.json")
  const compiler = join(root, "compiler")
  writeFileSync(project, "{}")
  writeFileSync(compiler, "compiler bytes")
  await settle()
  const cache = projectCache({ project, root: app, compiler, cache: { directory: join(root, "cache") } })
  cache.store(cache.begin(), { outputs: new Map(), errors: [], warnings: [] }, [])
  assert.ok(existsSync(cache.file))
  const stamp = () => {
    const stat = statSync(compiler)
    return [stat.size, stat.mtimeMs, stat.ctimeMs, stat.ino]
  }
  const stored = () => JSON.parse(readFileSync(cache.file, "utf8")).compiler
  chmodSync(compiler, 0o644)
  await settle()
  assert.notDeepEqual(stored(), [[compiler, stamp()]])
  assert.ok(cache.lookup().result, "same bytes keep the cache")
  assert.deepEqual(stored(), [[compiler, stamp()]], "the entry now holds the compiler's current stamp")
  assert.ok(cache.lookup().result)
  writeFileSync(compiler, "rebuilt compiler bytes")
  await settle()
  assert.deepEqual(cache.lookup(), { miss: "compiler changed" })
})
