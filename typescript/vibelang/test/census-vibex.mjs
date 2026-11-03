// VIP-39: grammar-only witnesses are also compiled by stock TypeScript 5.9.3.
// Semantic/Effect witnesses use checked, runnable twins in separate cases.
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { createRequire } from "node:module"
import { fileURLToPath } from "node:url"
import { join, dirname, resolve } from "node:path"

export function checkSyntaxTwin(url) {
  const dir = dirname(fileURLToPath(url))
  const stock = resolve(process.env.EFFECT_NODE_MODULES, "typescript/bin/tsc")
  const require = createRequire(import.meta.url)
  assert.equal(require(join(dirname(dirname(stock)), "package.json")).version, "5.9.3")
  const result = spawnSync(process.execPath, [stock, "-p", join(dir, "reference"), "--pretty", "false"], {encoding: "utf8", timeout: 60000})
  assert.equal(result.status, 0, result.stdout + result.stderr)
}

import { existsSync, mkdirSync, symlinkSync, rmSync, readFileSync } from "node:fs"

export function checkEffectTwin(url, expected) {
  const dir = dirname(fileURLToPath(url))
  const modules = process.env.VIBEX_REFERENCE_NODE_MODULES || process.env.EFFECT_NODE_MODULES
  const reference = join(dir, "reference")
  const local = join(reference, "node_modules")
  mkdirSync(local, {recursive: true})
  const effect = join(local, "effect")
  rmSync(effect, {recursive: true, force: true})
  symlinkSync(join(modules, "effect"), effect, "dir")
  const stock = join(modules, "typescript/bin/tsc")
  const version = JSON.parse(readFileSync(join(modules, "typescript/package.json"), "utf8")).version
  assert.equal(version, "5.9.3")
  const built = spawnSync(process.execPath, [stock, "-p", reference, "--pretty", "false"], {encoding: "utf8", timeout: 60000})
  assert.equal(built.status, 0, built.stdout + built.stderr)
  const code = `
    import {Effect} from "effect";
    import {main} from "./out/main.js";
    const exit = await Effect.runPromiseExit(main());
    if(exit._tag !== "Success") throw new Error(JSON.stringify(exit));
    const normalize = (${normalizeEffects.toString()});
    console.log(JSON.stringify(normalize(Effect, exit.value)));
  `
  const run = spawnSync(process.execPath, ["--input-type=module", "-e", code], {cwd: reference, encoding: "utf8", timeout: 60000})
  assert.equal(run.status, 0, run.stdout + run.stderr)
  assert.deepEqual(JSON.parse(run.stdout.trim()), expected)
  const actualDts = readFileSync(join(dir, "out/main.d.ts"), "utf8")
  const referenceDts = readFileSync(join(reference, "out/main.d.ts"), "utf8")
  assert.equal(actualDts, referenceDts, "stock TypeScript declaration identity")
}


// Compare the observable Exit of a cold Effect prop, never its private op code.
export function normalizeEffects(Effect, value) {
  if (Effect.isEffect(value)) {
    const exit = Effect.runSyncExit(value)
    return {_effectExit: exit._tag === "Success"
      ? {_tag:"Success", value:normalizeEffects(Effect, exit.value)}
      : JSON.parse(JSON.stringify(exit))}
  }
  if (typeof value === "function") return "<function>"
  if (Array.isArray(value)) return value.map(v => normalizeEffects(Effect,v))
  if (value && typeof value === "object")
    return Object.fromEntries(Object.entries(value).map(([k,v]) => [k,normalizeEffects(Effect,v)]))
  return value
}
