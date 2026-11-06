// Vitest reads the plugin's maps twice: a failing test's stack and coverage.
import { strict as assert } from "node:assert"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { assertFrame, locate, mainVibe, plugin as pluginFile, project, run } from "./helpers.mjs"

const vitest = join(dirname(createRequire(import.meta.url).resolve("vitest/package.json")), "vitest.mjs")
const plugin = pluginFile("vite/src/index.js")
const config = (test) => `import { defineConfig } from "vitest/config"
import vibelang from ${JSON.stringify(plugin)}
export default defineConfig({ plugins: [vibelang()], test: ${JSON.stringify(test)} })
`

const passing = `import { expect, test } from "vitest"
import { Effect } from "effect"
import { failing, plainTrace } from "../src/main.vibe"
test("reaches every path but one", async () => {
  expect(plainTrace()).toBeInstanceOf(Error)
  const exit = await Effect.runPromiseExit(failing(1))
  expect(exit._tag).toBe("Failure")
})
`

test("a failing vitest test prints .vibe frames", async (t) => {
  const root = project(t, {
    "vitest.config.ts": config({ include: ["test/*.test.mjs"] }),
    "test/fails.test.mjs": `import { test } from "vitest"
import { plainTrace } from "../src/main.vibe"
test("throws", () => { throw plainTrace() })
`
  })
  const { code, output } = await run(process.execPath, [vitest, "run", "--reporter=json", "--outputFile=report.json"], { cwd: root })
  assert.equal(code, 1, output)
  const report = JSON.parse(readFileSync(join(root, "report.json"), "utf8"))
  const stack = report.testResults[0].assertionResults[0].failureMessages.join("\n")
  assertFrame(stack, mainVibe, 'new Error("MARK_LEAF"')
  assertFrame(stack, mainVibe, 'middle("p")')
})

test("a failing @effect/vitest test prints .vibe frames", async (t) => {
  const root = project(t, {
    "vitest.config.ts": config({ include: ["test/*.test.mjs"] }),
    "test/dies.test.mjs": `import { it } from "@effect/vitest"
import { failing } from "../src/main.vibe"
it.effect("dies", () => failing(1))
`
  })
  const { code, output } = await run(process.execPath, [vitest, "run", "--reporter=json", "--outputFile=report.json"], { cwd: root })
  assert.equal(code, 1, output)
  const report = JSON.parse(readFileSync(join(root, "report.json"), "utf8"))
  const stack = report.testResults[0].assertionResults[0].failureMessages.join("\n")
  assertFrame(stack, mainVibe, 'new Error("MARK_DIE"')
})

for (const provider of ["v8", "istanbul"]) {
  test(`vitest coverage (${provider}) reports .vibe lines`, async (t) => {
    const never = `export function neverCalled(): number {
  return 41 + MARK_NEVER
}
const MARK_NEVER = 1
`
    const source = mainVibe + never
    const root = project(t, {
      "src/main.vibe": source,
      "vitest.config.ts": config({ include: ["test/*.test.mjs"], coverage: { enabled: true, provider, include: ["src/**"], reporter: ["json"] } }),
      "test/passes.test.mjs": passing
    })
    const { code, output } = await run(process.execPath, [vitest, "run"], { cwd: root })
    assert.equal(code, 0, output)
    const coverage = JSON.parse(readFileSync(join(root, "coverage/coverage-final.json"), "utf8"))
    const file = coverage[join(root, "src/main.vibe")]
    assert.ok(file, `no coverage of main.vibe: ${Object.keys(coverage)}`)
    const lines = source.split("\n")
    // Every statement sits on a .vibe line that holds code, inside that line.
    for (const [id, { start, end }] of Object.entries(file.statementMap)) {
      assert.ok(start.line >= 1 && end.line <= lines.length, `statement ${id} is at ${JSON.stringify({ start, end })}`)
      assert.ok(start.column <= lines[start.line - 1].length, `statement ${id} starts past its line: ${JSON.stringify(start)}`)
      assert.notEqual(lines[start.line - 1].trim(), "", `statement ${id} starts on a blank line`)
    }
    const hits = (needle) => {
      const { line } = locate(source, needle, "main.vibe")
      return Object.entries(file.statementMap).filter(([, { start }]) => start.line === line).map(([id]) => file.s[id])
    }
    const called = hits('const made = middle("p")')
    assert.ok(called.length && called.every((count) => count > 0), `a called line counts: ${called}`)
    const missed = hits("return 41 + MARK_NEVER")
    assert.ok(missed.length && missed.every((count) => count === 0), `an uncalled line counts none: ${missed}`)
  })
}
