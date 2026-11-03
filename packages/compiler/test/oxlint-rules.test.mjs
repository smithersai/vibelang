// Each native Oxlint rule that has no ESLint counterpart reports on a .vibe or
// .vibex witness at the line its TypeScript twin reports, through stock Oxlint.
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import { lintProjected, oxlintBinary } from "../oxlint.mjs"
import { witnesses } from "./oxlint-witnesses.mjs"

const packageDir = fileURLToPath(new URL("..", import.meta.url))
const compiler = join(packageDir, "bin/vibelang")

function project(t, files, config) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "vibelang-oxlint-test-")))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  symlinkSync(join(packageDir, "node_modules"), join(root, "node_modules"))
  const all = {
    "package.json": '{"name":"witness","type":"module"}',
    "tsconfig.json": JSON.stringify({ compilerOptions: { target: "esnext", module: "esnext", moduleResolution: "bundler", strict: true, jsx: "preserve", noEmit: true, skipLibCheck: true } }),
    ".oxlintrc.json": JSON.stringify(config),
    ...files,
  }
  for (const [file, text] of Object.entries(all)) {
    mkdirSync(dirname(join(root, file)), { recursive: true })
    writeFileSync(join(root, file), text)
  }
  return root
}

const allRules = {
  plugins: ["react", "typescript", "unicorn", "oxc"],
  categories: { correctness: "off", suspicious: "off", perf: "off" },
  rules: Object.fromEntries(witnesses.map(({ rule }) => [rule, "error"])),
}
const fileOf = ({ rule, ext }) => `${rule.replace("/", "-")}.${ext}`
const twinOf = (witness) => `${witness.rule.replace("/", "-")}.${witness.ext === "vibex" ? "tsx" : "ts"}`
const lineOf = ({ code }) => Math.max(code.split("\n").findIndex((line) => line.includes("//!")) + 1, 1)
const codeOf = ({ rule }) => `${rule.split("/")[0]}(${rule.split("/")[1]})`

test("the witness table names 100 distinct rules: react 42, typescript 22, oxc 18, unicorn 18", () => {
  assert.equal(new Set(witnesses.map(({ rule }) => rule)).size, 100)
  const families = Object.groupBy(witnesses, ({ rule }) => rule.split("/")[0])
  assert.deepEqual(Object.fromEntries(Object.entries(families).map(([name, list]) => [name, list.length])), { typescript: 22, unicorn: 18, oxc: 18, react: 42 })
})

test("every witness reports on its marked line, as its TypeScript twin does", async (t) => {
  const root = project(t, Object.fromEntries(witnesses.map((witness) => [fileOf(witness), witness.code])), allRules)
  const { output } = await lintProjected({ config: allRules, base: root, cwd: root, forward: ["--type-aware"], compiler })
  const twins = project(t, Object.fromEntries(witnesses.map((witness) => [twinOf(witness), witness.code])), allRules)
  const run = spawnSync(process.execPath, [oxlintBinary(twins), "-f", "json", "--type-aware"], { cwd: twins, encoding: "utf8", maxBuffer: 1 << 28 })
  const control = JSON.parse(run.stdout).diagnostics
  const missing = []
  for (const witness of witnesses) {
    const at = (list, file) => list.some((d) => d.filename === file && d.code === codeOf(witness) && d.labels[0]?.span.line === lineOf(witness))
    if (!at(output.diagnostics, fileOf(witness))) missing.push(`${witness.rule} on ${fileOf(witness)}:${lineOf(witness)}`)
    if (!at(control, twinOf(witness))) missing.push(`${witness.rule} on its twin ${twinOf(witness)}:${lineOf(witness)}`)
  }
  assert.deepEqual(missing, [])
  assert.deepEqual(output.diagnostics.filter((d) => !d.code), [], "no module failed to parse")
})

