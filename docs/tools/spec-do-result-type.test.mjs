import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { test } from "node:test"
import { block, chapter, run, tools } from "./spec-witness.mjs"

const running = () => process.env.SPEC_RUNNING ? readFileSync(process.env.SPEC_RUNNING, "utf8") : chapter("002-running")

test("do result types preserve source completions and ordinary expression contexts", () => {
  const text = running()
  assert.doesNotMatch(text, /literals widen as in a `let` initializer/)
  assert.match(text, /fresh literal/)
  assert.match(text, /`UpdateEmpty`/)
  assert.match(text, /no normal.*`never`/)
  assert.match(text, /Contextual typing/)
})

test("the printed do result types satisfy the TypeScript checker", () => {
  const source = block(running(), "const literalSource =", "ts")
  for (const marker of ["ordinaryLet", "annotatedSource", "returnedTemporary", "effectOverload", "promiseOverload"]) {
    assert.ok(source.includes(marker), marker)
  }
  assert.match(source, /@ts-expect-error/)
  const dir = mkdtempSync(join(tools, ".spec-do-result-"))
  try {
    const file = join(dir, "witness.mts")
    writeFileSync(file, source)
    const tsc = fileURLToPath(import.meta.resolve("typescript/bin/tsc"))
    const result = spawnSync(process.execPath, [tsc, "--strict", "--noEmit", "--skipLibCheck", "--module", "NodeNext", file],
      { encoding: "utf8" })
    assert.equal(result.status, 0, result.error?.message || result.stdout + result.stderr)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("native block completions preserve empty inheritance and consumed break values", () => {
  const controls = [
    ["{ 7; {} }", 7],
    ["{ label: { 7; break label; } }", 7],
    ["{}", undefined],
    ["{ 7; undefined; }", undefined],
    ['{ if (true) 1; else "a"; }', 1],
    ['{ if (false) 1; else "a"; }', "a"]
  ]
  for (const [source, expected] of controls) assert.equal(eval(source), expected)
})

test("an outward return supplies the enclosing Effect without a normal do result", () => {
  const result = run(block(running(), "function leaveDo()") + `
import assert from "node:assert/strict"
assert.equal(Effect.runSync(leaveDo()), 7)
`)
  assert.equal(result.status, 0, result.stderr)
})
