import assert from "node:assert/strict"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { createRequire } from "node:module"
import { dirname, join, relative } from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"
import fc from "fast-check"
import { addCoverageSelectors } from "../../../.smithers/flows/migrate/lib/wire.mjs"
import { checkProperty } from "../../../scripts/testing/property.mjs"
import { runChild } from "./child.mjs"

const packageRoot = fileURLToPath(new URL("../", import.meta.url))
const compiler = join(packageRoot, "../compiler/bin/vibelang")
const vitest = join(dirname(createRequire(import.meta.url).resolve("vitest/package.json")), "vitest.mjs")
const ts = createRequire(new URL("../../runtime/package.json", import.meta.url))("typescript")

async function measure(t, input, extension, complete) {
  const base = join(packageRoot, "test/.fixtures")
  await mkdir(base, { recursive: true })
  const root = await mkdtemp(join(base, "threshold-"))
  t.after(() => rm(root, { recursive: true, force: true }))
  await mkdir(join(root, "src"))
  await mkdir(join(root, "test"))
  const source = `export function value(n: number): number {${input.newline}  if (n ${input.operator} 0) return 1;${input.newline}  return -1;${input.newline}}${input.newline}`
  const first = input.operator === ">" ? 1 : -1
  await writeFile(join(root, "package.json"), '{"type":"module"}')
  await writeFile(join(root, "tsconfig.json"), JSON.stringify({
    compilerOptions: { target: "ES2022", module: "NodeNext", moduleResolution: "NodeNext", strict: true, skipLibCheck: true, types: [], noEmit: true },
    files: [`src/value.${extension}`]
  }))
  await writeFile(join(root, `src/value.${extension}`), source)
  await writeFile(join(root, "test/value.test.ts"), `
import { test, expect } from "vitest"
import { value } from "../src/value.${extension}"
test("branches", () => {
  expect(value(${first})).toBe(1)
  ${complete ? `expect(value(${-first})).toBe(-1)` : ""}
})
`)
  const config = `
import { defineConfig } from "vitest/config"
import vibelang from ${JSON.stringify(join(packageRoot, "src/index.js"))}
export default defineConfig({
  plugins: [vibelang({ compiler: ${JSON.stringify(compiler)} })],
  test: {
    include: ["test/*.test.ts"],
    coverage: {
      enabled: true, provider: "v8",
      include: ["src/**/*.ts"], reporter: ["json"],
      thresholds: { branches: 100 }
    }
  }
})
`
  await writeFile(join(root, "vitest.config.ts"), addCoverageSelectors(config, ts))
  const { code, output } = await runChild(process.execPath, [vitest, "run", "--no-color"], {
    cwd: root, env: { ...process.env, NO_COLOR: "1" }
  })
  assert.equal(code, complete ? 0 : 1, `${extension}, complete=${complete}: ${output}`)
  if (!complete) assert.match(output, /coverage for branches.*does not meet/i)
  const coverage = JSON.parse(await readFile(join(root, "coverage/coverage-final.json"), "utf8"))
  assert.deepEqual(Object.keys(coverage).map(path => relative(root, path)), [`src/value.${extension}`],
    "the source is included and generated compatibility declarations are excluded")
  const record = Object.values(coverage)[0]
  const branches = Object.values(record.b).flat()
  assert.equal(branches.some(hits => hits === 0), !complete)
  const tally = hits => ({ total: hits.length, uncovered: hits.filter(n => n === 0).length })
  return {
    functions: tally(Object.values(record.f)),
    statements: tally(Object.values(record.s)),
    branches: tally(branches)
  }
}

test("native coverage keeps TypeScript's source set, instrumentation and threshold failures", async t => {
  await checkProperty(fc, {
    name: "vite-native-coverage-threshold",
    rule: ".smithers/flows/migrate/README.md: migrated modules stay in Vitest coverage and retain the existing thresholds",
    command: "sh packages/vite/test/run.sh --test-name-pattern 'native coverage keeps TypeScript'",
    arbitrary: fc.record({
      operator: fc.constantFrom(">", "<"),
      newline: fc.constantFrom("\n", "\r\n")
    }),
    numRuns: 4,
    regressions: new URL("./property-regressions/", import.meta.url),
    check: async input => {
      for (const complete of [false, true]) {
        const original = await measure(t, input, "ts", complete)
        const migrated = await measure(t, input, "vibe", complete)
        assert.deepEqual(migrated, original, JSON.stringify({ input, complete }))
      }
    }
  })
})

