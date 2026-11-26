// #391: a module that returns to TypeScript, by revert or by a baseline move,
// must not leave importers naming its deleted native file. unflipReturned
// rewrites a relative ./x.vibe or ./x.vibex specifier whose target is gone and
// whose ./x.ts or ./x.tsx twin exists back to that twin, and nothing else.
import "./helpers/jj-config.mjs"
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { renameBatch } from "../lib/codemod.mjs"
import { unflipReturned } from "../lib/stale-specifiers.mjs"
import { makeConfig, paths, revert } from "../lib/steps.mjs"
import * as Jj from "../lib/jj.mjs"
import { must, writeJson } from "../lib/util.mjs"

function tree(t, files) {
  const root = mkdtempSync(join(tmpdir(), "migrate-unflip-"))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, file)), { recursive: true })
    writeFileSync(join(root, file), text)
  }
  return root
}

test("unflipReturned rewrites only dangling native specifiers whose TypeScript twin exists", t => {
  const root = tree(t, {
    "src/A.ts": "export const a = 1\n",
    "src/View.tsx": "export const View = () => null\n",
    "src/Kept.vibe": "export const kept = 1\n",
    "src/B.ts": [
      'import { a } from "./A.vibe"',
      'import { View } from "./View.vibex"',
      'import { kept } from "./Kept.vibe"',
      'import { gone } from "./Gone.vibe"',
      'export { a as again } from "./A.vibe?raw"',
      'const lazy = () => import("./A.vibe")',
      'import { x } from "pkg/A.vibe"',
      ""
    ].join("\n"),
    "scripts/run.mjs": 'import { a } from "../src/A.vibe"\n'
  })
  const edits = unflipReturned(root, ["src/B.ts", "scripts/run.mjs", "src/A.ts"])
  assert.equal(readFileSync(join(root, "src/B.ts"), "utf8"), [
    'import { a } from "./A.ts"',
    'import { View } from "./View.tsx"',
    'import { kept } from "./Kept.vibe"',
    'import { gone } from "./Gone.vibe"',
    'export { a as again } from "./A.ts?raw"',
    'const lazy = () => import("./A.ts")',
    'import { x } from "pkg/A.vibe"',
    ""
  ].join("\n"))
  assert.equal(readFileSync(join(root, "scripts/run.mjs"), "utf8"), 'import { a } from "../src/A.ts"\n')
  assert.equal(edits.length, 5)
  // Restricted to the modules that returned, it leaves other dangling names alone.
  writeFileSync(join(root, "src/B.ts"), 'import { a } from "./A.vibe"\nimport { View } from "./View.vibex"\n')
  assert.deepEqual(unflipReturned(root, ["src/B.ts"], ["src/View.tsx"]).map(e => e.to), ["./View.tsx"])
  assert.deepEqual(unflipReturned(root, ["src/B.ts"], ["src/View.tsx"]), [])
})

test("convert A, import it from B, revert A: B imports ./A.ts and loads", async t => {
  const root = mkdtempSync(join(tmpdir(), "migrate-unflip-revert-"))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const target = join(root, "repo"), run = join(root, "run")
  mkdirSync(join(target, "src"), { recursive: true })
  await must("jj git init && jj config set --repo user.name test && jj config set --repo user.email test@localhost", { cwd: target })
  writeJson(join(target, "package.json"), { name: "unflip", private: true, type: "module" })
  writeFileSync(join(target, "src/A.ts"), "export const answer: number = 42\n")
  writeFileSync(join(target, "src/B.ts"), 'import { answer } from "./A.ts"\nconsole.log(answer)\n')
  await Jj.commit(target, "base")
  writeJson(paths(run).config, makeConfig({ target, test: "true", toolchain: join(root, "toolchain") }))
  writeJson(paths(run).plan, { batches: [{ files: ["src/A.ts"] }] })
  renameBatch(target, ["src/A.ts"])
  // The repair agent, not the codemod, wrote B's native name: no receipt records it.
  writeFileSync(join(target, "src/B.ts"), 'import { answer } from "./A.vibe"\nconsole.log(answer)\n')
  writeJson(paths(run).codemod("01"), { importEdits: [], exportEdits: [] })
  await revert({ run, batch: "01", file: "src/A.vibe", reason: "returns to TypeScript" })
  assert.equal(readFileSync(join(target, "src/B.ts"), "utf8"), 'import { answer } from "./A.ts"\nconsole.log(answer)\n')
  assert.equal(execFileSync(process.execPath, [join(target, "src/B.ts")], { encoding: "utf8" }).trim(), "42")
})

test("the base-move repair rewrites tracked importers of a module an earlier run returned", async t => {
  const target = tree(t, {
    "package.json": JSON.stringify({ name: "moved-base", private: true, type: "module" }),
    "src/Http.ts": "export const get = () => 200\n",
    "src/Fetch.ts": 'import { get } from "./Http.vibe"\nconsole.log(get())\n',
    "src/Other.ts": 'import { get } from "./Http.ts"\nexport const other = get\n'
  })
  await must("jj git init && jj config set --repo user.name test && jj config set --repo user.email test@localhost", { cwd: target })
  await Jj.commit(target, "a base an earlier run moved, with Http returned")
  const { repairReturnedSpecifiers } = await import("../lib/steps.mjs")
  assert.deepEqual(await repairReturnedSpecifiers(target), [{ file: "src/Fetch.ts", from: "./Http.vibe", to: "./Http.ts" }])
  assert.equal(execFileSync(process.execPath, [join(target, "src/Fetch.ts")], { encoding: "utf8" }).trim(), "200")
  assert.deepEqual(await repairReturnedSpecifiers(target), [])
})
