// A migrate test imports the code it tests from ../lib. An environment variable
// that swaps that module, or the repository root it resolves from, makes the
// test pass or fail on another file while reporting it as the repository's.
import assert from "node:assert/strict"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { test } from "node:test"

const dir = fileURLToPath(new URL(".", import.meta.url))

/** Lines that import a module, or set the repository root, from an environment variable. */
function envSubjects(source) {
  const found = []
  const lines = source.split("\n")
  const fromEnv = new Set()
  for (const line of lines) {
    const m = line.match(/\b(?:const|let|var)\s+(\w+)\s*=\s*process\.env\./)
    if (m) fromEnv.add(m[1])
  }
  lines.forEach((line, i) => {
    const imported = line.match(/\bimport\(\s*([\w.]+)/)
    if (imported && (imported[1].startsWith("process.env.") || fromEnv.has(imported[1]))) found.push(i + 1 + ": " + line.trim())
    else if (/\bprocess\.env\.\w+\s*(\?\?|\|\|)\s*fileURLToPath\(new URL\("(\.\.\/)+",/.test(line)) found.push(i + 1 + ": " + line.trim())
  })
  return found
}

test("envSubjects finds direct, indirect and repository-root hooks", () => {
  assert.equal(envSubjects('const m = await import(process.env.X || "../lib/a.mjs")').length, 1)
  assert.equal(envSubjects('const m = process.env.X\n  ? await import(process.env.X) : await import("../lib/a.mjs")').length, 1)
  assert.equal(envSubjects('const impl = process.env.X || new URL("../lib/a.mjs", import.meta.url).href\nconst m = await import(impl)').length, 1)
  assert.equal(envSubjects('const repo = process.env.X ?? fileURLToPath(new URL("../../../../", import.meta.url))').length, 1)
  assert.deepEqual(envSubjects('import { a } from "../lib/a.mjs"\nconst compiler = process.env.VIBELANG_COMPILER ?? "vibelang"\nconst m = await import("../lib/b.mjs")'), [])
})

test("no migrate test takes its subject module or repository root from the environment", () => {
  const found = []
  for (const name of readdirSync(dir).filter(n => n.endsWith(".mjs")).sort()) {
    if (name === "no-env-subject.test.mjs") continue
    for (const line of envSubjects(readFileSync(join(dir, name), "utf8"))) found.push(name + ":" + line)
  }
  assert.deepEqual(found, [])
})
