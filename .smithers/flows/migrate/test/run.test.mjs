import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { parseArgs, many, one } from "../lib/args.mjs"
import { readIssues, validateIssue, ofKind } from "../lib/issues.mjs"
import { buildInventory, isTestFile } from "../lib/inventory.mjs"
import { formatVibe, makeConfig, nextStep, paths } from "../lib/steps.mjs"
import { parseTokenCounts } from "../lib/tokens.mjs"
import { repairPrompt } from "../lib/repair.mjs"

test("parseArgs collects repeated options and flags", () => {
  const { step, options } = parseArgs(["setup", "--run", "/r", "--package", "a", "--package", "b", "--allow-dirty", "--test=pnpm test"])
  assert.equal(step, "setup")
  assert.deepEqual(many(options.package), ["a", "b"])
  assert.equal(options["allow-dirty"], true)
  assert.equal(one(options, "test"), "pnpm test")
  assert.throws(() => one(options, "package"), /more than once/)
  assert.throws(() => one(options, "missing"), /required/)
})

test("nextStep walks upgrade-effect, setup, plan and each batch's steps, back to repair after a failed verify", () => {
  const run = mkdtempSync(join(tmpdir(), "migrate-run-"))
  try {
    const p = paths(run)
    const write = (path, value) => { mkdirSync(join(path, ".."), { recursive: true }); writeFileSync(path, JSON.stringify(value)) }
    const at = (path, seconds) => utimesSync(path, seconds, seconds)
    assert.deepEqual(nextStep(run), { step: "upgrade-effect" })
    write(p.upgrade, {})
    assert.deepEqual(nextStep(run), { step: "setup" })
    write(p.setup, {})
    assert.deepEqual(nextStep(run), { step: "plan" })
    write(p.plan, { batches: [{ files: ["a.ts"] }, { files: ["b.ts"] }] })
    assert.deepEqual(nextStep(run), { step: "codemod", batch: "01" })
    write(p.codemod("01"), {})
    assert.deepEqual(nextStep(run), { step: "compile", batch: "01" })
    write(p.compile("01"), {})
    assert.deepEqual(nextStep(run), { step: "repair", batch: "01" })
    write(p.repair("01"), {}); at(p.repair("01"), 100)
    assert.deepEqual(nextStep(run), { step: "verify", batch: "01" })
    write(p.verify("01"), { ok: false }); at(p.verify("01"), 200)
    assert.deepEqual(nextStep(run), { step: "repair", batch: "01", again: true })
    write(p.repair("01"), {}); at(p.repair("01"), 300)
    assert.deepEqual(nextStep(run), { step: "verify", batch: "01" })
    write(p.verify("01"), { ok: true }); at(p.verify("01"), 400)
    assert.deepEqual(nextStep(run), { step: "record", batch: "01" })
    write(p.record("01"), {})
    assert.deepEqual(nextStep(run), { step: "codemod", batch: "02" })
    for (const f of [p.codemod, p.compile, p.repair, p.verify, p.record]) write(f("02"), { ok: true })
    assert.deepEqual(nextStep(run), { step: "report" })
  } finally {
    rmSync(run, { recursive: true, force: true })
  }
})

test("issue entries need their kind's fields", () => {
  assert.deepEqual(validateIssue({ kind: "codemod-gap", batch: "01", pattern: "Effect.gen", before: "a", after: "b" }), [])
  assert.deepEqual(validateIssue({ kind: "issue", batch: "01", title: "t", repro: "r" }), ["issue: actual is required"])
  assert.deepEqual(validateIssue({ kind: "idiom", batch: "01", lesson: "l", files: "x" }), ["idiom: files is a list of paths"])
  assert.match(validateIssue({ kind: "other" })[0], /kind must be one of/)
  const run = mkdtempSync(join(tmpdir(), "migrate-issues-"))
  try {
    writeFileSync(join(run, "issues.jsonl"), '{"kind":"idiom","batch":"01","lesson":"l"}\n\n{"kind":"idiom","batch":"02","lesson":"m"}\n')
    const issues = readIssues(join(run, "issues.jsonl"))
    assert.deepEqual(ofKind(issues, "idiom", "02"), [{ kind: "idiom", batch: "02", lesson: "m" }])
    writeFileSync(join(run, "issues.jsonl"), "not json\n")
    assert.throws(() => readIssues(join(run, "issues.jsonl")), /:1: not JSON/)
  } finally {
    rmSync(run, { recursive: true, force: true })
  }
})

test("the inventory records Effect use, local imports, dependents and the tests that import a file", () => {
  const root = mkdtempSync(join(tmpdir(), "migrate-inventory-"))
  try {
    mkdirSync(join(root, "pkg/src/test"), { recursive: true })
    writeFileSync(join(root, "pkg/src/a.ts"), "import { Effect } from 'effect'\nimport { b } from './b.js'\nexport const a = Effect.succeed(b)\n")
    writeFileSync(join(root, "pkg/src/b.ts"), "import type { Option } from 'effect'\nexport const b = 1\n")
    writeFileSync(join(root, "pkg/src/a.test.ts"), "import { a } from './a.js'\n")
    writeFileSync(join(root, "pkg/src/types.d.ts"), "export {}\n")
    writeFileSync(join(root, "pkg/src/a.d.vibe.ts"), "export declare const a: number\n")
    writeFileSync(join(root, "pkg/src/styles.d.css.ts"), "export {}\n")
    const inv = buildInventory({ root, packages: [{ dir: "pkg", sources: ["src"] }], tokens: { [join(root, "pkg/src/a.ts")]: 30 }, coverage: { "pkg/src/a.ts": 88 } })
    const by = Object.fromEntries(inv.files.map((f) => [f.path, f]))
    assert.deepEqual(Object.keys(by), ["pkg/src/a.test.ts", "pkg/src/a.ts", "pkg/src/b.ts"])
    assert.equal(by["pkg/src/a.ts"].effect, "values")
    assert.equal(by["pkg/src/b.ts"].effect, "types")
    assert.deepEqual(by["pkg/src/a.ts"].imports, ["pkg/src/b.ts"])
    assert.deepEqual(by["pkg/src/b.ts"].dependents, ["pkg/src/a.ts"])
    assert.deepEqual(by["pkg/src/a.ts"].testedBy, ["pkg/src/a.test.ts"])
    assert.equal(by["pkg/src/a.ts"].tokens, 30)
    assert.equal(by["pkg/src/a.ts"].coverage, 88)
    assert.deepEqual(inv.summary, { files: 3, effectFiles: 2, effectValueFiles: 1, effectTypeOnlyFiles: 1, tests: 1, effectLines: 7, effectTokens: 30 })
    assert.equal(isTestFile("src/test/helpers.ts"), true)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("makeConfig requires the test command and a toolchain, and finds the build tsconfig", () => {
  const root = mkdtempSync(join(tmpdir(), "migrate-config-"))
  try {
    mkdirSync(join(root, "pkg"))
    writeFileSync(join(root, "package.json"), "{}")
    writeFileSync(join(root, "pkg/tsconfig.build.json"), "{}")
    assert.throws(() => makeConfig({ target: root, toolchain: "/t" }), /--test/)
    assert.throws(() => makeConfig({ target: root, test: "x" }), /--toolchain/)
    const config = makeConfig({ target: root, packages: ["pkg"], test: "pnpm test", toolchain: "/t" })
    assert.deepEqual(config.packages, [{ dir: "pkg", tsconfig: "tsconfig.json", dtsTsconfig: "tsconfig.build.json", sources: ["src"] }])
    assert.deepEqual(config.toolchain, { kind: "staged", dir: "/t" })
    assert.equal(makeConfig({ target: root, test: "bun alchemy-test", testReport: "(?<status>.) (?<name>.+)", toolchain: "/t" }).test.report, "(?<status>.) (?<name>.+)")
    assert.deepEqual(config.limits, { maxFiles: 6, maxLines: 900 })
    assert.deepEqual([config.bookmark, config.base], ["vibe", null])
    assert.deepEqual([makeConfig({ target: root, test: "t", toolchain: "/t", bookmark: "b", base: "dev" })].map((c) => [c.bookmark, c.base]), [["b", "dev"]])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("parseTokenCounts reads the token tool's --files lines", () => {
  assert.deepEqual(parseTokenCounts("12\t/a/b.ts\nnoise\n7\t/a/c d.vibe\n"), { "/a/b.ts": 12, "/a/c d.vibe": 7 })
})

test("the repair prompt carries the context, the diagnostics, the checks and the record formats", () => {
  const prompt = repairPrompt({
    context: "# Context\n", run: "/run", batch: "01", target: "/repo", packages: ["pkg"], test: "pnpm test", files: ["pkg/src/a.vibe"], step: "node step.mjs",
    codemod: { fix: { byFile: { "pkg/src/a.vibe": { EK4830: 1 } }, refused: [{ file: "pkg/src/a.vibe", line: 3, code: "EK4835", error: "TS2322: x" }] } },
    compile: { diagnostics: [{ file: "pkg/src/a.vibe", line: 8, column: 2, category: "error", code: "EK1002", message: "Effect.gen expects", notes: ["Write the body"] }], newErrors: [{ file: "pkg/src/b.ts", line: 1, column: 1, category: "error", code: "TS2305", message: "no export", notes: [] }] }
  })
  assert.ok(prompt.startsWith("# Context\n"))
  for (const part of ["- pkg/src/a.vibe: EK4830 ×1", "EK4835 not fixed", "- pkg/src/a.vibe:8:2 error EK1002: Effect.gen expects\n  Write the body", "pkg/src/b.ts:1:1 error TS2305", '"kind":"codemod-gap","batch":"01"', "node step.mjs revert --run /run", "node step.mjs repair --run /run --batch 01 --done"]) {
    assert.ok(prompt.includes(part), `the prompt lacks ${part}`)
  }
})

test("formatVibe runs the package's vibelang-format on the .vibe files that exist, and nothing else", async () => {
  const root = mkdtempSync(join(tmpdir(), "migrate-format-"))
  try {
    const recorded = join(root, "formatted.txt")
    mkdirSync(join(root, "packages/core/node_modules/.bin"), { recursive: true })
    mkdirSync(join(root, "packages/core/src"), { recursive: true })
    writeFileSync(join(root, "packages/core/src/a.vibe"), "export const a = 1\n")
    writeFileSync(join(root, "packages/core/src/b.ts"), "export const b = 2\n")
    const tool = join(root, "packages/core/node_modules/.bin/vibelang-format")
    writeFileSync(tool, `#!/bin/sh\necho "$@" >> ${recorded}\n`, { mode: 0o755 })
    const config = { target: root, packages: [{ dir: "packages/core" }] }
    assert.deepEqual(await formatVibe(config, ["packages/core/src/a.vibe", "packages/core/src/b.ts", "packages/core/src/gone.vibe"]), { files: ["packages/core/src/a.vibe"], code: 0 })
    assert.equal(readFileSync(recorded, "utf8"), "--write packages/core/src/a.vibe\n")
    assert.deepEqual(await formatVibe(config, ["packages/core/src/b.ts"]), { files: [], code: 0 })
    writeFileSync(tool, "#!/bin/sh\nexit 3\n", { mode: 0o755 })
    assert.deepEqual(await formatVibe(config, ["packages/core/src/a.vibe"]), { files: ["packages/core/src/a.vibe"], code: 3 })
    rmSync(tool)
    assert.deepEqual(await formatVibe(config, ["packages/core/src/a.vibe"]), { files: [], code: 127 })
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
