import { expect, test } from "bun:test"
import { readdirSync, readFileSync } from "node:fs"
import { resolve } from "node:path"

// The root of `@effect/platform-node` re-exports every module, NodeRedis
// included, so a value import of the root loads redis and its 640 modules into
// every process that imports this entry. The migrated foldkit Vite plugin
// imports it for ExperimentalNodeProcess, and each `vite build` child went
// from 392 to 1,302 modules and timed out its 5 s budget (foldkit-147). Each
// file imports the one module it uses by subpath.
const directory = resolve(import.meta.dir, "../src/experimental/platform-node")

test("experimental/platform-node imports @effect/platform-* by subpath, never a root", () => {
  for (const name of readdirSync(directory)) {
    const source = readFileSync(resolve(directory, name), "utf8")
    expect(source, name).not.toMatch(/from "@effect\/platform-(?:node|bun|browser)"/)
  }
})

test("importing vibelang-runtime/experimental/platform-node loads neither redis nor the platform-node root", () => {
  const hook = `import { registerHooks } from "node:module"
const seen = []
registerHooks({ resolve(specifier, context, next) { const result = next(specifier, context); if (result?.url) seen.push(result.url); return result } })
await import("vibelang-runtime/experimental/platform-node")
console.log(JSON.stringify(seen))`
  const result = Bun.spawnSync(["node", "--input-type=module", "-e", hook], { cwd: resolve(import.meta.dir, ".."), stdout: "pipe", stderr: "pipe", timeout: 30_000 })
  expect(result.stderr.toString()).toBe("")
  expect(result.exitCode).toBe(0)
  const loaded: string[] = JSON.parse(result.stdout.toString())
  expect(loaded.length).toBeGreaterThan(10)
  expect(loaded.filter((url) => /\/(?:@redis|redis)\//.test(url))).toEqual([])
  expect(loaded.filter((url) => /@effect\/platform-node\/dist\/index\.js$/.test(url))).toEqual([])
})
