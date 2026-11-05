// Non-executable shebangs do not select a runner. Loader-served commands may
// migrate their entries while bare commands retain their dependency closure.
import assert from "node:assert/strict"
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { bareRunnerDeferrals, commandFiles, scriptEntries } from "../lib/bare-runners.mjs"
import { restoreReferences, rewriteReferences } from "../lib/references.mjs"
import { applyState, prepareState } from "../lib/codemod-state.mjs"
import { batchScope } from "../lib/touched.mjs"
import { SpecPath } from "../../../../scripts/testing/spec-path.mjs"

const fc = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))("fast-check")
const corpus = JSON.parse(readFileSync(new URL("./corpus/t3code-runner-entries.json", import.meta.url)))

test("runner inventory quotes the preservation and executable-entry rules", () => {
  assert.ok(readFileSync(SpecPath("007-tooling.md"), "utf8").includes(corpus.specQuote))
  const guide = readFileSync(new URL("../README.md", import.meta.url), "utf8")
  for (const quote of corpus.runnerQuotes) assert.ok(guide.includes(quote), quote)
})

function repository(files, executable = []) {
  const root = mkdtempSync(join(tmpdir(), "command-runners-"))
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, file)), { recursive: true })
    writeFileSync(join(root, file), text)
    chmodSync(join(root, file), executable.includes(file) ? 0o755 : 0o644)
  }
  return root
}
const sources = files => Object.keys(files).filter(file => /\.ts$/.test(file))
const deferredIn = (files, executable) => {
  const root = repository(files, executable)
  try { return bareRunnerDeferrals(root, sources(files)).deferred.map(d => d.file) }
  finally { rmSync(root, { recursive: true, force: true }) }
}

test("t3code: only what a runner really starts bare stays TypeScript", () => {
  assert.deepEqual(deferredIn(corpus.files), corpus.deferred)
})

test("property: a shebang is a runner exactly when the file can execute", () => {
  fc.assert(fc.property(fc.constantFrom("node", "bun", "tsx", "ts-node"), fc.boolean(), (runner, executable) => {
    const files = {
      "package.json": "{}",
      "tool.ts": `#!/usr/bin/env ${runner}\nimport { x } from "./x.ts"\nexport { x }\n`,
      "x.ts": 'export const x = 1\n',
    }
    assert.deepEqual(deferredIn(files, executable ? ["tool.ts"] : []), executable ? ["tool.ts", "x.ts"] : [])
  }), { numRuns: 16 })
})

test("property: a workflow's command is a runner in every shell position", () => {
  const prefixes = ["run: ", "- run: ", "run: |\n  ", "run: |\n  if ! ", "run: |\n  check=(", "run: |\n  time "]
  fc.assert(fc.property(fc.constantFrom(...prefixes), fc.boolean(), fc.constantFrom(".github/workflows/ci.yml", ".github/actions/setup/action.yaml"), (prefix, wired, workflow) => {
    const loader = wired ? "--import vibelang/register " : ""
    const files = {
      "package.json": "{}",
      [workflow]: `steps:\n  ${prefix.replaceAll("\n", "\n  ")}node ${loader}scripts/tool.ts\n`,
      "scripts/tool.ts": 'export const x = 1\n',
    }
    assert.deepEqual(deferredIn(files), wired ? [] : ["scripts/tool.ts"])
  }), { numRuns: 60 })
})

test("a workflow step's cd ends with that step", () => {
  const files = {
    "package.json": "{}",
    ".github/workflows/ci.yml": "steps:\n  - run: |\n      cd apps/web\n      node --import vibelang/register local.ts\n  - run: node scripts/tool.ts\n",
    "apps/web/local.ts": 'export const x = 1\n',
    "scripts/tool.ts": 'export const x = 1\n',
    "apps/web/scripts/tool.ts": 'export const x = 2\n',
  }
  assert.deepEqual(deferredIn(files), ["scripts/tool.ts"])
})

test("a served Node script's entry migrates; a path the rewrite cannot reach stays", () => {
  const entry = 'export const x = 1\n'
  const run = script => deferredIn({
    "package.json": JSON.stringify({ workspaces: ["scripts", "tools"] }),
    "scripts/package.json": JSON.stringify({ name: "s", scripts: { go: script } }),
    "tools/package.json": JSON.stringify({ name: "t" }),
    "scripts/tool.ts": entry,
    "tools/up.ts": entry,
  })
  assert.deepEqual(run("node --import vibelang/register tool.ts"), [])
  assert.deepEqual(run("node --import vibelang/register ./tool.ts"), [])
  assert.deepEqual(run("node --import vibelang/register ../tools/up.ts"), ["tools/up.ts"])
  assert.deepEqual(run("cd ../tools && node --import vibelang/register up.ts"), ["tools/up.ts"])
})

const renamed = { from: "scripts/tool.ts", to: "scripts/tool.vibe" }
const commands = {
  "package.json": "{}\n",
  ".github/workflows/ci.yml": "on:\n  push:\n    paths: [scripts/tool.ts]\njobs:\n  a:\n    steps:\n      - run: node --import vibelang/register scripts/tool.ts --flag\n      - run: |\n          # scripts/tool.ts is a comment\n          node --import vibelang/register ./scripts/tool.ts\n",
  ".github/actions/setup/action.yml": "runs:\n  steps:\n    - run: node --import vibelang/register scripts/tool.ts\n",
  "scripts/build.sh": "#!/bin/sh\nnode --import vibelang/register scripts/tool.ts\n",
  "scripts/tool.ts": 'export const x = 1\n',
}

test("a rename reaches workflow and shell commands, a revert gives their bytes back", () => {
  const root = repository(commands)
  try {
    const files = commandFiles(root)
    assert.deepEqual(files.toSorted(), [".github/actions/setup/action.yml", ".github/workflows/ci.yml", "scripts/build.sh"])
    const edits = rewriteReferences(root, [renamed], [...files, renamed.from], { literals: false })
    const ci = readFileSync(join(root, ".github/workflows/ci.yml"), "utf8")
    assert.match(ci, /register scripts\/tool\.vibe --flag/)
    assert.match(ci, /register \.\/scripts\/tool\.vibe\n/)
    assert.match(ci, /# scripts\/tool\.ts is a comment/)
    assert.match(readFileSync(join(root, "scripts/build.sh"), "utf8"), /tool\.vibe/)
    restoreReferences(root, edits, renamed.from)
    for (const file of files) assert.equal(readFileSync(join(root, file), "utf8"), commands[file])
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test("the codemod's transaction carries the command edits, and the batch's scope admits them", () => {
  const root = repository(commands)
  try {
    const state = prepareState(root, ["scripts/tool.ts"], ["scripts/tool.ts"], {})
    applyState(root, state)
    assert.match(readFileSync(join(root, ".github/workflows/ci.yml"), "utf8"), /register scripts\/tool\.vibe --flag/)
    const scope = batchScope({ files: [{ planned: "scripts/tool.ts", path: "scripts/tool.vibe", migrated: true }], codemod: state })
    for (const file of commandFiles(root)) assert.ok(scope.has(file), file)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test("a fixture's commands stay as written", () => {
  const root = repository({ ...commands, "test/fixtures/run.sh": "node --import vibelang/register scripts/tool.ts\n" })
  try {
    applyState(root, prepareState(root, ["scripts/tool.ts"], ["scripts/tool.ts"], {}))
    assert.match(readFileSync(join(root, "test/fixtures/run.sh"), "utf8"), /tool\.ts/)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test("scriptEntries reads a runner behind shell keywords", () => {
  for (const line of ["if ! node a.ts", "then node a.ts", "else node a.ts", "while node a.ts", "until node a.ts", "do node a.ts"]) {
    assert.deepEqual(scriptEntries(line).map(e => e.file), ["a.ts"], line)
  }
})
