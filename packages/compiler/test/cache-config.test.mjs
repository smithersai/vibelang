import { strict as assert } from "node:assert"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { setTimeout as sleep } from "node:timers/promises"
import { projectCache } from "../cache.mjs"

for (const name of ["vibe.config.json", "tsconfig.json", "jsconfig.json"]) {
  test(`foreign ${name} changes invalidate cached compilation`, async (t) => {
    const root = mkdtempSync(join(tmpdir(), "vibelang-cache-config-"))
    t.after(() => rmSync(root, { recursive: true, force: true }))
    const app = join(root, "app")
    const dep = join(root, "dep")
    mkdirSync(join(app, "src"), { recursive: true })
    mkdirSync(dep)
    const project = join(app, "tsconfig.json")
    const source = join(dep, "main.vibe")
    const config = join(dep, name)
    const compiler = join(root, "compiler")
    writeFileSync(project, JSON.stringify({ include: ["src/**/*"] }))
    writeFileSync(source, "export const x = 1\n")
    writeFileSync(config, JSON.stringify({ vibe: { effectGlobals: true } }))
    // A canonical config wins over another config in the same directory.
    if (name === "vibe.config.json") writeFileSync(join(dep, "tsconfig.json"), "{}")
    writeFileSync(compiler, "fake compiler identity")
    await sleep(150)
    const cache = projectCache({ project, root: app, compiler, cache: join(root, "cache") })
    cache.store(cache.begin(), { errors: [], warnings: [], outputs: new Map(), inputs: [] }, [source])
    assert.ok(cache.lookup().result, "warm entry exists")
    writeFileSync(config, JSON.stringify({ vibe: { effectGlobals: false } }))
    assert.ok(cache.lookup().miss, `${name} change must invalidate foreign source settings`)
  })
}
