import assert from "node:assert/strict"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import vibelang from "../src/index.js"

const native = process.env.VIBELANG_BINARY || fileURLToPath(new URL("../../../typescript/built/local/tsc", import.meta.url))

test("discovers the installed compiler, honors the project option, shares compilation and recompiles after a source edit", {
  skip: !existsSync(native) && "build the checkout compiler first"
}, async (t) => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "vibelang-vite-options-")))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const previous = process.env.VIBELANG_BINARY
  delete process.env.VIBELANG_BINARY
  t.after(() => { if (previous === undefined) delete process.env.VIBELANG_BINARY; else process.env.VIBELANG_BINARY = previous })
  const installed = join(root, "node_modules/vibelang")
  mkdirSync(join(installed, "bin"), { recursive: true })
  writeFileSync(join(installed, "package.json"), '{"name":"vibelang","type":"module"}')
  const calls = join(root, "compilations.jsonl")
  // Like the npm launcher, a Node script with a shebang; the plugin runs it with Node.
  writeFileSync(join(installed, "bin/vibelang"), `#!/usr/bin/env node\nimport { appendFileSync } from "node:fs"; import { spawnSync } from "node:child_process"; const args=process.argv.slice(2); appendFileSync(${JSON.stringify(calls)}, JSON.stringify(args)+"\\n"); const result=spawnSync(${JSON.stringify(native)},args,{stdio:"inherit"}); process.exit(result.status ?? 1);`)
  mkdirSync(join(root, "src"))
  writeFileSync(join(root, "package.json"), '{"type":"module"}')
  const config = join(root, "custom.json")
  writeFileSync(config, JSON.stringify({ compilerOptions: { target: "ES2022", module: "NodeNext", types: [], skipLibCheck: true }, include: ["src/**/*.vibe"] }))
  const first = join(root, "src/first.vibe"), second = join(root, "src/second.vibe")
  writeFileSync(first, "export const answer: number = 42\n")
  writeFileSync(second, "export const other: string = 'hello'\n")
  const plugin = vibelang({ project: "custom.json" })
  t.after(() => plugin.closeBundle())
  plugin.configResolved({ root, logger: { warn(message) { assert.fail(message) } } })
  const watched = []
  const context = { addWatchFile(file) { watched.push(file) }, error(error) { throw new Error(error.message) } }
  const [a, b] = await Promise.all([plugin.transform.call(context, "", first), plugin.transform.call(context, "", second)])
  assert.match(a.code, /answer = 42/)
  assert.match(b.code, /other = ['"]hello['"]/)
  assert.ok(a.map.sources.includes(first))
  assert.ok(a.map.sourcesContent.some((source) => source.includes("answer: number")))
  assert.deepEqual(watched, [config, config])
  // Reading the project's jsx setting compiles nothing.
  const invocations = () => readFileSync(calls, "utf8").trim().split("\n").map((line) => JSON.parse(line)).filter((args) => !args.includes("--showConfig"))
  assert.equal(invocations().length, 1, "concurrent module requests share one whole-project compile")
  assert.deepEqual(invocations()[0].slice(0, 2), ["--project", config])
  writeFileSync(first, "export const answer: number = 43\n")
  plugin.watchChange(first)
  const changed = await plugin.transform.call(context, "", first)
  assert.match(changed.code, /answer = 43/)
  assert.equal(invocations().length, 2)
})
