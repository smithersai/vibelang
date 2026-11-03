import assert from "node:assert/strict"
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { createRequire } from "node:module"
import { basename, dirname, join } from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"
import { runChild } from "./child.mjs"
import fc from "fast-check"
import { checkProperty } from "../../../scripts/testing/property.mjs"

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
const authored = { byname: 5, callbacks: 7, catches: 10, matches: 4, recursion: 2, services: 5 }

async function coverageRun(t, extraFiles = {}) {
  const base = join(packageRoot, "test/.fixtures")
  await mkdir(base, { recursive: true })
  const root = await mkdtemp(join(base, "coverage-"))
  t.after(() => rm(root, { recursive: true, force: true }))
  await cp(join(packageRoot, "test/coverage"), root, { recursive: true })
  for (const [file, source] of Object.entries(extraFiles)) await writeFile(join(root, file), source)
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
  const files = Object.fromEntries(Object.entries(coverage).map(([path, file]) => [basename(path), file]))
  const byName = Object.fromEntries(Object.entries(files).map(([name, file]) => [name, counts(file)]))
  const rows = []
  for (const [name, functions] of Object.entries(authored)) {
    const vibe = byName[`${name}.vibe`], ts = byName[`${name}.effect.ts`]
    assert.ok(vibe && ts, `coverage of ${name}.vibe and ${name}.effect.ts`)
    assert.equal(vibe.functions.total, functions, `${name}.vibe: one function for each function its author wrote; mapped functions ${JSON.stringify(files[name + ".vibe"].fnMap)}`)
    for (const kind of ["functions", "statements", "branches"]) {
      assert.ok(vibe[kind].uncovered <= ts[kind].uncovered, `${name}.vibe: ${vibe[kind].uncovered} uncovered ${kind}, its TypeScript ${ts[kind].uncovered}; uncovered statements ${JSON.stringify(Object.entries(files[name + ".vibe"].s).filter(([, hits]) => hits === 0).map(([id]) => files[name + ".vibe"].statementMap[id]))}`)
    }
    const cell = (kind) => `${vibe[kind].uncovered}/${vibe[kind].total} vs ${ts[kind].uncovered}/${ts[kind].total}`
    rows.push(`${name}: functions ${cell("functions")}, statements ${cell("statements")}, branches ${cell("branches")}`)
  }
  const catches = files["catches.vibe"]
  const catchSource = await readFile(new URL("./coverage/src/catches.vibe", import.meta.url), "utf8")
  const returnLine = catchSource.split("\n").findLastIndex((line) => line.includes("return step(n) catch effect")) + 1
  assert.ok(Object.entries(catches.statementMap).some(([id, loc]) => loc.start.line === returnLine && loc.start.column === 2 && catches.s[id] === 0),
    "the written return in neverLoaded remains an uncovered source statement")
  console.log(`PASS coverage, uncovered/total .vibe vs .effect.ts:\n  ${rows.join("\n  ")}`)
})

// Run each source through Vite's composed map and the real coverage provider.
// Native-map inspection alone misses positions changed by map composition.
function tailFiles({ kind, trivia }) {
  const vibe = {
    direct: `try${trivia}task(n)`,
    conditional: `n > 0 ? try${trivia}task(n) : try${trivia}task(n)`,
    fallback: `task(n) catch () =>${trivia}0`,
    rethrow: `task(n) catch effect (cause) =>${trivia}throw cause`
  }[kind]
  const twin = {
    direct: "yield* task(n)",
    conditional: "n > 0 ? yield* task(n) : yield* task(n)",
    fallback: "yield* Effect.catch(task(n), () => Effect.succeed(0))",
    rethrow: "yield* Effect.catch(task(n), (cause) => Effect.fail(cause))"
  }[kind]
  return {
    "src/tail-generated.vibe": `
effect function task(n: number): number!Error! {
  if (n < 0) throw new Error("negative")
  return n
}
export effect function tail(n: number): number!Error! { return (${vibe}) }
`,
    "src/tail-generated.effect.ts": `
import { Effect } from "effect"
const task = Effect.fnUntraced(function* (n: number) {
  if (n < 0) return yield* Effect.fail(new Error("negative"))
  return n
})
export const tail = Effect.fnUntraced(function* (n: number) { return (${twin}) })
`,
    "test/tail-generated.test.ts": `
import { expect, test } from "vitest"
import { Effect } from "effect"
import * as vibe from "../src/tail-generated.vibe"
import * as twin from "../src/tail-generated.effect"
test("tail keeps its TypeScript success and failure outcomes", async () => {
  for (const value of [1, -1]) {
    const actual = await Effect.runPromise(Effect.exit(vibe.tail(value)))
    const expected = await Effect.runPromise(Effect.exit(twin.tail(value)))
    expect(actual._tag).toBe(expected._tag)
    if (actual._tag === "Success" && expected._tag === "Success") expect(actual.value).toBe(expected.value)
  }
})
`
  }
}

test("delegated tail coverage preserves source functions through Vite", async (t) => {
  await checkProperty(fc, {
    name: "vite-tail-coverage",
    rule: "packages/vite/README.md: one function for each function in a .vibe module, and none for compiler thunks and generators",
    command: "sh packages/vite/test/run.sh --test-name-pattern 'delegated tail coverage'",
    arbitrary: fc.record({
      kind: fc.constantFrom("direct", "conditional", "fallback", "rethrow"),
      trivia: fc.constantFrom(" ", " /* tail */ ", "\n  ")
    }),
    numRuns: 8,
    regressions: new URL("./property-regressions/", import.meta.url),
    check: async (input) => {
      const coverage = await coverageRun(t, tailFiles(input))
      const byName = Object.fromEntries(Object.entries(coverage).map(([path, file]) => [basename(path), counts(file)]))
      const actual = byName["tail-generated.vibe"], twin = byName["tail-generated.effect.ts"]
      const authored = input.kind === "fallback" || input.kind === "rethrow" ? 3 : 2
      assert.equal(actual.functions.total, authored, JSON.stringify({ input, mappedFunctions: Object.entries(coverage).find(([path]) => basename(path) === "tail-generated.vibe")?.[1].fnMap }))
      assert.equal(actual.functions.uncovered, 0, JSON.stringify(input))
      for (const kind of ["statements", "branches"]) {
        assert.ok(actual[kind].uncovered <= twin[kind].uncovered, `${JSON.stringify(input)}: ${kind}`)
      }
    },
    artifacts: tailFiles
  })
})
