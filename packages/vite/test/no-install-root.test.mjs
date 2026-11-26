import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { fileURLToPath, pathToFileURL } from "node:url"

// A Vite root outside any package that installs vibelang, such as an app in a
// monorepo whose plugin comes from elsewhere: no node_modules, no `compiler`
// option and no VIBELANG_BINARY. The plugin then compiles with the vibelang
// package beside it, backend and compiler both.
const plugin = fileURLToPath(new URL("../src/index.js", import.meta.url))
const vite = import.meta.resolve("vite")

test("a root without its own vibelang install builds with the vibelang beside the plugin", (t) => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "vibelang-vite-no-install-")))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  writeFileSync(join(root, "package.json"), '{"type":"module"}')
  writeFileSync(join(root, "tsconfig.json"), JSON.stringify({
    compilerOptions: { strict: true, module: "ESNext", target: "ESNext", moduleResolution: "Bundler", types: [], skipLibCheck: true, noEmit: true },
    include: ["*.vibe"]
  }))
  writeFileSync(join(root, "leaf.vibe"), "export function twice(value: number): number {\n  return value * 2\n}\n")
  writeFileSync(join(root, "main.vibe"), 'import { twice } from "./leaf.vibe"\nexport const answer: number = twice(21)\n')
  const script = `import { build } from ${JSON.stringify(vite)}
import vibelang from ${JSON.stringify(pathToFileURL(plugin).href)}
const messages = []
await build({ root: ${JSON.stringify(root)}, configFile: false, logLevel: "silent",
  plugins: [vibelang({ debug: (line) => messages.push(line) })],
  build: { outDir: "out", minify: false, lib: { entry: "main.vibe", formats: ["es"], fileName: "main" } } })
const { answer } = await import(${JSON.stringify(pathToFileURL(join(root, "out/main.js")).href)})
console.log(JSON.stringify({ answer }))`
  const env = { ...process.env, VIBELANG_PROJECT: "", VIBELANG_CACHE_DIR: join(root, ".cache") }
  delete env.VIBELANG_BINARY
  delete env.NODE_TEST_CONTEXT
  const run = spawnSync(process.execPath, ["--input-type=module", "-e", script], { cwd: root, env, encoding: "utf8", timeout: 120000 })
  assert.equal(run.status, 0, run.stdout + run.stderr)
  assert.deepEqual(JSON.parse(run.stdout.trim().split("\n").at(-1)), { answer: 42 })
  assert.doesNotMatch(readFileSync(join(root, "out/main.js"), "utf8"), /function twice\(value: number\)/, "the output is compiled, not the source")
})
