// Chapter 900: negative controls for the stock-TypeScript type/Exit oracle.
import assert from "node:assert/strict"
import { test } from "node:test"
import { createRequire } from "node:module"
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync, realpathSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { fileURLToPath } from "node:url"
import { spawnSync } from "node:child_process"
import { compareTwin } from "../../../typescript/vibelang/test/ch900b-coverage-twin.mjs"
const repo = fileURLToPath(new URL("../../../", import.meta.url))
const require = createRequire(new URL("../../runtime/package.json", import.meta.url))
const prefix = 'import { Effect } from "effect"\n'
const correct = prefix + "export function main() { return Effect.succeed(1) }\n"
const config = { compilerOptions: { target: "es2022", module: "nodenext", moduleResolution: "nodenext", strict: true, types: [], skipLibCheck: true, declaration: true, outDir: "out" }, files: ["main.ts"] }
function fixture(t, source = correct, reference = correct) {
  const root = mkdtempSync(join(tmpdir(), "coverage-twin-oracle-"))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  mkdirSync(join(root, "effect-ts"))
  mkdirSync(join(root, "node_modules"))
  const effect = realpathSync(join(process.env.EFFECT_NODE_MODULES || join(repo, "experiments/node_modules"), "effect"))
  symlinkSync(effect, join(root, "node_modules/effect"))
  for (const directory of [root, join(root, "effect-ts")]) {
    writeFileSync(join(directory, "package.json"), '{"type":"module"}')
    writeFileSync(join(directory, "tsconfig.json"), JSON.stringify(config))
  }
  writeFileSync(join(root, "main.ts"), source)
  writeFileSync(join(root, "effect-ts/main.ts"), reference)
  const compiled = spawnSync(process.execPath, [require.resolve("typescript/bin/tsc"), "-p", join(root, "tsconfig.json")], { encoding: "utf8", timeout: 60_000 })
  assert.equal(compiled.status, 0, compiled.stdout + compiled.stderr)
  return root
}
test("the twin oracle accepts equal inferred channels and equal full Exits", async t => {
  await compareTwin(fixture(t), 1)
})
for (const [name, channel] of [
  ["error", 'Effect.Effect<number, "failure">'],
  ["requirement", 'Effect.Effect<number, never, "service">']
]) test("the twin oracle rejects a different " + name + " channel despite equal runtime values", async t => {
  const source = prefix + "export function main(): " + channel + " { return Effect.succeed(1) }\n"
  await assert.rejects(compareTwin(fixture(t, source), 1), /inferred success, error and requirement types/)
})
test("the twin oracle rejects readonly/mutable tuple contract drift", async t => {
  const source = prefix + "export function main(): Effect.Effect<readonly [number, number]> { return Effect.succeed([1,2]) }\n"
  const reference = prefix + "export function main(): Effect.Effect<[number, number]> { return Effect.succeed([1,2]) }\n"
  await assert.rejects(compareTwin(fixture(t, source, reference), [1,2]), /inferred success, error and requirement types/)
})
test("the twin oracle rejects an Exit value change with identical inferred types", async t => {
  const source = prefix + "export function main() { return Effect.succeed(2) }\n"
  await assert.rejects(compareTwin(fixture(t, source), 1), /complete serialized Exit/)
})
