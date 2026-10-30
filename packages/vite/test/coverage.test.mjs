import assert from "node:assert/strict"
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { createRequire } from "node:module"
import { basename, dirname, join } from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"
import { runChild } from "./child.mjs"

// test/coverage holds .vibe modules beside the Effect TypeScript an author
// would write instead (<name>.effect.ts), and tests that call both the same
// way. Under @vitest/coverage-v8, a .vibe module reports no more uncovered
// functions, statements, or branches than its TypeScript, and exactly one
// function for each function its author wrote: the thunks, generators, and
// immediately invoked functions the compiler makes map to no source position.

const packageRoot = fileURLToPath(new URL("../", import.meta.url))
const compiler = join(packageRoot, "../compiler/bin/vibelang")
const vitest = join(dirname(createRequire(import.meta.url).resolve("vitest/package.json")), "vitest.mjs")

// The functions each .vibe module's author wrote.
const authored = { byname: 5, callbacks: 7, catches: 9, matches: 4, services: 4 }

async function coverageRun(t) {
  const base = join(packageRoot, "test/.fixtures")
  await mkdir(base, { recursive: true })
  const root = await mkdtemp(join(base, "coverage-"))
  t.after(() => rm(root, { recursive: true, force: true }))
  await cp(join(packageRoot, "test/coverage"), root, { recursive: true })
  await writeFile(join(root, "vitest.config.ts"), `
import { defineConfig } from "vitest/config"
import vibelang from ${JSON.stringify(join(packageRoot, "src/index.js"))}
export default defineConfig({
  plugins: [vibelang({ compiler: ${JSON.stringify(compiler)} })],
  test: {
    include: ["test/*.test.ts"],
    coverage: { enabled: true, provider: "v8", include: ["src/**"], reporter: ["json"] }
  }
})
`)
  const { code, output } = await runChild(process.execPath, [vitest, "run", "--no-color"], { cwd: root, env: { ...process.env, NO_COLOR: "1" } })
  assert.equal(code, 0, output)
  return JSON.parse(await readFile(join(root, "coverage/coverage-final.json"), "utf8"))
}

// Counts the uncovered and total functions, statements, and branches of one file.
function counts(file) {
  const tally = (hits) => ({ uncovered: hits.filter((n) => n === 0).length, total: hits.length })
  return { functions: tally(Object.values(file.f)), statements: tally(Object.values(file.s)), branches: tally(Object.values(file.b).flat()) }
}

test("@vitest/coverage-v8 counts the functions, statements, and branches a .vibe author wrote", async (t) => {
  const coverage = await coverageRun(t)
  const byName = Object.fromEntries(Object.entries(coverage).map(([path, file]) => [basename(path), counts(file)]))
  const rows = []
  for (const [name, functions] of Object.entries(authored)) {
    const vibe = byName[`${name}.vibe`], ts = byName[`${name}.effect.ts`]
    assert.ok(vibe && ts, `coverage of ${name}.vibe and ${name}.effect.ts`)
    assert.equal(vibe.functions.total, functions, `${name}.vibe: one function for each function its author wrote`)
    for (const kind of ["functions", "statements", "branches"]) {
      assert.ok(vibe[kind].uncovered <= ts[kind].uncovered, `${name}.vibe: ${vibe[kind].uncovered} uncovered ${kind}, its TypeScript ${ts[kind].uncovered}`)
    }
    const cell = (kind) => `${vibe[kind].uncovered}/${vibe[kind].total} vs ${ts[kind].uncovered}/${ts[kind].total}`
    rows.push(`${name}: functions ${cell("functions")}, statements ${cell("statements")}, branches ${cell("branches")}`)
  }
  console.log(`PASS coverage, uncovered/total .vibe vs .effect.ts:\n  ${rows.join("\n  ")}`)
})
