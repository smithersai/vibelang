import assert from "node:assert/strict"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import { runPhaseChanges, runPhaseCheck, vibeTree } from "../lib/run-phase.mjs"
import { makeConfig, paths, verify } from "../lib/steps.mjs"
import { must, slug, writeJson } from "../lib/util.mjs"
import * as Jj from "../lib/jj.mjs"

const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const ts = require("typescript")
const compiler = process.env.VIBELANG_COMPILER ?? fileURLToPath(new URL("../../../../packages/compiler/native/vibelang", import.meta.url))
const native = { skip: !existsSync(compiler) && "build the native compiler" }
const chapter = readFileSync(new URL("../../../../docs/design/src/001-functions.md", import.meta.url), "utf8")
const corpora = ["alchemy-effectclass-run-phase", "smithers-run-phase"].map(name => [name, JSON.parse(readFileSync(new URL(`./corpus/${name}.json`, import.meta.url), "utf8"))])
const changes = (before, after) => runPhaseChanges({ ts, original: before, originalPath: "main.ts", vibe: vibeTree(compiler, after, "main.vibe"), vibeText: after })
  .map(({ name, line, verdict }) => ({ name, line, verdict }))

for (const [name, corpus] of corpora) {
  test(`${name}: the corpus quotes chapter 1's rule`, () => {
    assert.ok(chapter.includes(corpus.quote), corpus.quote)
  })
  test(`${name}: a plain function marked effect is reported`, native, () => {
    assert.deepEqual(changes(corpus.before, corpus.after), corpus.expected)
  })
  test(`${name}: the unmarked conversion reports nothing`, native, () => {
    assert.deepEqual(changes(corpus.before, corpus.before), [])
  })
}

test("alchemy-62: conversions that keep the run phase pass", native, () => {
  // An Effect.gen body and an Effect.fn function return a program at the call
  // in both texts, so marking them effect changes nothing.
  assert.deepEqual(changes(
    "export const f = (n: number) => Effect.gen(function* () { return yield* Effect.succeed(n) })\nexport const g = Effect.fn(\"g\")(function* (n: number) { return n })\nexport function h() { return Effect.gen(function* () { return 1 }) }\n",
    "export const f = effect (n: number) => try Effect.succeed(n)\nexport const g = effect (n: number) => n\nexport effect function h() { return 1 }\n"), [])
})

test("alchemy-62: a single returned pipeline is listed for review, not blocking", native, () => {
  assert.deepEqual(changes("export const p = (n: number) => Effect.succeed(n).pipe(Effect.map((x) => x + 1))\n",
    "export const p = effect (n: number) => (try Effect.succeed(n)) + 1\n"), [{ name: "p", line: 1, verdict: "review" }])
})

test("alchemy-62: methods, class members and nested names keep their paths", native, () => {
  assert.deepEqual(changes(
    "export class C { run() { return 1 } }\nexport const o = { inner: { k: function () { return [] } } }\n",
    "export class C { effect run() { return 1 } }\nexport const o = { inner: { k: effect function () { return [] } } }\n"),
    [{ name: "C.run", line: 1, verdict: "value" }, { name: "o.inner.k", line: 2, verdict: "value" }])
})

test("alchemy-62: verify fails a batch that marks a plain function effect", native, async () => {
  for (const [name, corpus] of corpora) {
    for (const after of [corpus.after, corpus.before]) {
      const root = mkdtempSync(join(tmpdir(), "migrate-run-phase-"))
      try {
        const target = join(root, "repo"), run = join(root, "run")
        mkdirSync(join(target, "node_modules/.bin"), { recursive: true })
        symlinkSync(require.resolve("typescript/package.json").replace(/\/package.json$/, ""), join(target, "node_modules/typescript"))
        writeJson(join(target, "package.json"), { name: "run-phase-fixture", private: true, type: "module" })
        writeJson(join(target, "tsconfig.json"), { include: ["*.vibe"] })
        writeFileSync(join(target, "main.vibe"), after)
        // A compiler that checks clean and forwards --estree to the real one.
        writeFileSync(join(target, "node_modules/.bin/vibelang"), [
          "#!/usr/bin/env node",
          "const cp = require('node:child_process');",
          "if (process.argv.includes('--estree')) { const r = cp.spawnSync(" + JSON.stringify(compiler) + ", process.argv.slice(2), { stdio: 'inherit' }); process.exit(r.status ?? 1) }",
          "process.exit(0)",
        ].join("\n"), { mode: 0o755 })
        writeFileSync(join(target, ".gitignore"), "node_modules/\n")
        await must("jj git init && jj config set --repo user.name test && jj config set --repo user.email test@localhost", { cwd: target })
        await Jj.commit(target, "migrated input")
        const p = paths(run)
        writeJson(p.config, makeConfig({ target, test: "true", vibelangVersion: "0.0.11" }))
        writeJson(p.plan, { batches: [{ files: ["main.ts"] }] })
        writeJson(join(p.baseline, "tests.json"), { code: 0, tests: {}, total: 0, passed: 0, failed: [], skipped: 0 })
        writeJson(join(p.baseline, "compile-" + slug(".") + ".json"), [])
        writeJson(p.codemodState("01"), { version: 1, phase: "fixing", files: ["main.ts"], renames: [{ from: "main.ts", to: "main.vibe" }], originals: [{ from: "main.ts", to: "main.vibe", bytes: Buffer.from(corpus.before).toString("base64"), mode: 0o644 }], writes: [], attempts: [] })
        const result = await verify({ run, batch: "01" })
        const marked = after === corpus.after
        assert.equal(result.checks.runPhase, !marked, name + ": " + JSON.stringify(result.runPhase))
        assert.deepEqual(result.runPhase.blocking.map(c => c.name), marked ? corpus.expected.map(c => c.name) : [])
        if (marked) assert.equal(result.ok, false)
      } finally { rmSync(root, { recursive: true, force: true }) }
    }
  }
})

test("alchemy-62: a module the compiler cannot parse is listed unchecked, never blocking", () => {
  const root = mkdtempSync(join(tmpdir(), "migrate-run-phase-"))
  try {
    writeFileSync(join(root, "main.vibe"), "export const x = 1\n")
    const result = runPhaseCheck({ compiler: "/bin/false", ts, target: root, files: ["main.vibe"], original: () => ({ path: "main.ts", text: "export const x = 1\n" }) })
    assert.equal(result.blocking.length, 0)
    assert.equal(result.unchecked.length, 1)
  } finally { rmSync(root, { recursive: true, force: true }) }
})
