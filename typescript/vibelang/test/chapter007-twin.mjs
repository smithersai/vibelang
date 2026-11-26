// run-seconds: 240 (the sum of its stage deadlines)
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

import { referenceModules } from "./vip7-reference.mjs"

const repo = fileURLToPath(new URL("../../../", import.meta.url))
const stock = join(repo, "docs/tools/node_modules/typescript/bin/tsc")

function observe(cwd, module) {
  const source = 'import { Effect } from "effect"; const m = await import(' + JSON.stringify(module) + '); console.log(JSON.stringify({types:m.typeEvidence,exit:await Effect.runPromiseExit(m.probe())}))'
  const ran = spawnSync(process.execPath, ["--input-type=module", "-e", source], { cwd, encoding: "utf8", timeout: 60000 })
  assert.equal(ran.status, 0, ran.stdout + ran.stderr)
  return JSON.parse(ran.stdout)
}

// Both sources contain independent success/error/service equality assertions.
// The harness checks main.vibe; stock TypeScript checks the unchanged twin.
// Keep the actual control tree on failure, beside the harness's own outputs.
export async function compareChapter007Twin(caseURL, expected) {
  const directory = fileURLToPath(caseURL)
  assert.equal(JSON.parse(readFileSync(join(repo, "docs/tools/node_modules/typescript/package.json"), "utf8")).version, "5.9.3")
  const reference = join(directory, "out/twin-control")
  rmSync(reference, { recursive: true, force: true })
  mkdirSync(join(reference, "node_modules"), { recursive: true })
  const modules = chapter007EffectTwinModules()
  symlinkSync(join(modules, "effect"), join(reference, "node_modules/effect"))
  writeFileSync(join(reference, "main.ts"), readFileSync(join(directory, "reference.ts"), "utf8"))
  const config = JSON.parse(readFileSync(join(directory, "tsconfig.json"), "utf8"))
  config.files = ["main.ts"]
  config.compilerOptions.outDir = "out"
  writeFileSync(join(reference, "tsconfig.json"), JSON.stringify(config))
  const compiled = spawnSync(process.execPath, [stock, "-p", "tsconfig.json", "--pretty", "false"], { cwd: reference, encoding: "utf8", timeout: 90000 })
  assert.equal(compiled.status, 0, compiled.stdout + compiled.stderr)
  const actual = observe(directory, "./out/main.js")
  const native = observe(reference, "./out/main.js")
  assert.deepEqual(actual, native)
  assert.deepEqual(actual.types, [true, true, true])
  assert.equal(actual.exit._tag, "Success")
  assert.deepEqual(actual.exit.value, expected)
}


// Standalone compiler tests and harness cases need the same independently
// pinned native control even when the caller supplies only current runtime deps.
export function chapter007EffectTwinModules() {
  return referenceModules(process.env.EFFECT_TWIN_NODE_MODULES, ["effect"])
}
