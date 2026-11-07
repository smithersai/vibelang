// Only the platform repair writes a fresh sibling .ts, keeping run phase,
// captures and receivers; it never overwrites an existing file, and no other
// repair creates a .ts file.
import assert from "node:assert/strict"
import { readdirSync } from "node:fs"
import { project, baseOptions } from "../_tooling-witness.mjs"

const options = { ...baseOptions(), noEmit: true, lib: ["ES2022", "DOM"] }
// The compilation after the repairs writes the declaration sidecar
// main.d.vibe.ts as any compilation does; it is not a repair write.
const tsFiles = dir => readdirSync(dir).filter(f => f.endsWith(".ts") && !f.endsWith(".d.vibe.ts")).sort()
const setup = (ctx, source) => {
  ctx.put("main.vibe", source)
  ctx.put("tsconfig.json", { compilerOptions: options, files: ["main.vibe"] })
}
const fix = ctx => ctx.invoke("--fix", "-p", ".", "--pretty", "false")
const compile = ctx => ctx.invoke("-p", ".", "--pretty", "false")

const sources = {
  plain: "export effect function probe() { return try Effect.try(() => window.location.origin); }\n",
  capture: "export effect function probe(prefix: string) { return try Effect.try(() => prefix + window.location.origin); }\n",
  receiver: "export class C { prefix = 'x'; effect probe() { return try Effect.try(() => this.prefix + window.location.origin); } }\n",
}
for (const [name, source] of Object.entries(sources)) {
  // Fresh: the repair writes main.platform.ts and the project still checks.
  project(ctx => {
    setup(ctx, source)
    const r = fix(ctx)
    assert.deepEqual(tsFiles(ctx.dir), ["main.platform.ts"], name + "\n" + r.text)
    const fixed = ctx.read("main.vibe")
    assert.notEqual(fixed, source, name)
    assert.doesNotMatch(fixed, /window\./, name + ": the host read moved\n" + fixed)
    assert.match(ctx.read("main.platform.ts"), /window\.location\.origin/, name)
    if (name !== "plain") assert.match(fixed, /Effect\.try\(\(\) =>/, name + ": a capturing wrapper stays in the .vibe file\n" + fixed)
    const after = compile(ctx)
    assert.doesNotMatch(after.text, /error/, name + "\n" + after.text)
    // A second run changes nothing.
    const platform = ctx.read("main.platform.ts")
    fix(ctx)
    assert.equal(ctx.read("main.vibe"), fixed, name)
    assert.equal(ctx.read("main.platform.ts"), platform, name)
  })
  // Existing: the file stays byte for byte, and the source is not rewritten.
  project(ctx => {
    setup(ctx, source)
    ctx.put("main.platform.ts", "export const sentinel = 7\n")
    const r = fix(ctx)
    assert.equal(ctx.read("main.platform.ts"), "export const sentinel = 7\n", name + "\n" + r.text)
    assert.equal(ctx.read("main.vibe"), source, name + "\n" + r.text)
    assert.match(r.text, /already exists/, name + "\n" + r.text)
  })
}
// No other repair writes a .ts file.
project(ctx => {
  setup(ctx, 'import type { Effect } from "effect"\nexport type Run = Effect.Effect<number>\nexport effect function parse(text: string) { return try((text) => JSON.parse(text), text) }\n')
  const r = fix(ctx)
  assert.match(ctx.read("main.vibe"), /Run = number!!/, r.text)
  assert.deepEqual(tsFiles(ctx.dir), [], r.text)
})
console.log("only the platform repair writes a fresh sibling .ts, never over an existing file")
