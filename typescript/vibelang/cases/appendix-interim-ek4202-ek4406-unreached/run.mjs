// run-seconds: 180 (three bounded 60-second compiler calls)
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"

const dir = path.dirname(fileURLToPath(import.meta.url))
const cases = path.dirname(dir)
const compiler = fileURLToPath(new URL("../../../built/local/tsc", import.meta.url))
const tsc = (project, ...args) => {
  const result = spawnSync(compiler, ["-p", project, "--pretty", "false", "--noEmit", ...args], { encoding: "utf8", timeout: 60_000 })
  if (result.error) throw result.error
  return result.stdout + result.stderr
}
const stage = (name, files) => {
  const work = path.join(dir, "out", name)
  fs.rmSync(work, { recursive: true, force: true })
  fs.mkdirSync(work, { recursive: true })
  fs.symlinkSync(path.join(dir, "node_modules"), path.join(work, "node_modules"), "dir")
  for (const [file, text] of Object.entries(files)) fs.writeFileSync(path.join(work, file), text)
  return work
}

const declaration = fs.readFileSync(path.join(dir, "out", "main.d.ts"), "utf8")
assert.match(declaration, /@throws \{never\}[\s\S]*export declare function plain/, declaration)

// The archived EK4202 input, a txtar seed of the compile fuzzer.
const seed = fs.readFileSync(path.join(cases, "..", "..", "tsc", "internal", "vibelangfuzz", "testdata", "fuzz", "FuzzCompile", "appendix-ek4202-complete-project"), "utf8")
const archive = JSON.parse(seed.slice(seed.indexOf("string(") + 7, seed.lastIndexOf(")")))
const files = {}
for (const part of archive.split(/^-- (.+) --$/m).slice(1).reduce((all, x, i, a) => i % 2 ? all : [...all, [x, a[i + 1]]], [])) files[part[0]] = part[1].replace(/^\n/, "")
const control = tsc(stage("ek4202", files))
assert.match(control, /error EK3501/, control)
assert.doesNotMatch(control, /EK4202/, control)

// The archived EK4406 input, under its own configuration.
const legacy = path.join(cases, "ek4401-fix.fail")
const trust = {}
for (const file of ["lib.vibe", "errors.ts", "plain.ts", "package.json"]) trust[file] = fs.readFileSync(path.join(legacy, file), "utf8")
trust["tsconfig.json"] = fs.readFileSync(path.join(legacy, "tsconfig.json"), "utf8")
const unreached = tsc(stage("ek4406", trust))
assert.match(unreached, /EK0403/, unreached)
assert.doesNotMatch(unreached, /EK4406/, unreached)
console.log("archived EK4202 and EK4406 inputs do not reach their reporters")
