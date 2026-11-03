// VIP-31: compare raw Exits and public types against the stock pinned twin.
// Each side keeps its own Effect pin; successful values are compared without JSON.
// Run after the acceptance harness. Pending cases retain their gap evidence.
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { spawnSync } from "node:child_process"
import { fileURLToPath, pathToFileURL } from "node:url"

assert.ok(process.argv.length > 2, "pass at least one paired case")
const here = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const modules = process.env.COVERAGE_REFERENCE_NODE_MODULES
const scratch = process.env.COVERAGE_REFERENCE_SCRATCH
assert.ok(modules && scratch, "set COVERAGE_REFERENCE_NODE_MODULES and COVERAGE_REFERENCE_SCRATCH")
for (const [name, version] of [["typescript", "5.9.3"], ["effect", "4.1.0"]]) {
  assert.equal(JSON.parse(fs.readFileSync(path.join(modules, name, "package.json"))).version, version)
}
const normalize = text => text.replace(/^\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\s+/g, "")
function run(args, cwd) {
  const result = spawnSync(process.execPath, args, { cwd, encoding: "utf8", timeout: 120000, maxBuffer: 4 * 1024 * 1024 })
  assert.equal(result.error, undefined, String(result.error))
  assert.equal(result.status, 0, result.stdout + result.stderr)
}
fs.mkdirSync(scratch, { recursive: true })
for (const name of process.argv.slice(2)) {
  assert.match(name, /^[a-z0-9.-]+$/)
  const dir = path.join(here, "cases", name)
  assert.ok(fs.existsSync(path.join(dir, "typescript/main.ts")), name + " has no twin")
  if (fs.existsSync(path.join(dir, "pending"))) {
    console.log(name + ": pending, raw stock comparison remains unproven")
    continue
  }
  const stage = fs.mkdtempSync(path.join(scratch, "raw-twin-"))
  try {
    fs.writeFileSync(path.join(stage, "package.json"), JSON.stringify({ type: "module" }))
    const nm = path.join(stage, "node_modules")
    fs.mkdirSync(nm)
    for (const entry of fs.readdirSync(modules)) {
      if (entry !== "vibelang-runtime") fs.symlinkSync(path.join(modules, entry), path.join(nm, entry))
    }
    const reference = path.join(stage, "reference")
    fs.mkdirSync(reference)
    for (const entry of fs.readdirSync(path.join(dir, "typescript"))) {
      if (entry.endsWith(".ts") || entry === "tsconfig.json") {
        fs.copyFileSync(path.join(dir, "typescript", entry), path.join(reference, entry))
      }
    }
    run([path.join(modules, "typescript/bin/tsc"), "-p", reference], stage)
    assert.equal(normalize(fs.readFileSync(path.join(dir, "out/main.d.ts"), "utf8")),
      normalize(fs.readFileSync(path.join(reference, "out/main.d.ts"), "utf8")), name + ": public type differs")
    fs.writeFileSync(path.join(stage, "compare.mjs"), [
      "import assert from \"node:assert/strict\"",
      "import { Effect as StockEffect } from \"effect\"",
      "import * as ActualEffect from " + JSON.stringify(pathToFileURL(path.join(process.env.EFFECT_NODE_MODULES, "effect/dist/Effect.js")).href),
      "import { main as actual } from " + JSON.stringify(pathToFileURL(path.join(dir, "out/main.js")).href),
      "import { main as reference } from \"./reference/out/main.js\"",
      "const a = await ActualEffect.runPromiseExit(actual())",
      "const b = await StockEffect.runPromiseExit(reference())",
      "assert.equal(a._tag, b._tag)",
      "assert.deepEqual(a.value, b.value)",
      "assert.equal(a._tag, \"Success\")",
    ].join("\n"))
    run([path.join(stage, "compare.mjs")], stage)
    console.log(name + ": raw Exit and public types agree with TypeScript 5.9.3 / Effect 4.1.0")
  } finally {
    fs.rmSync(stage, { recursive: true, force: true })
  }
}
