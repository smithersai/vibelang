import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import fc from "fast-check"

const root = fileURLToPath(new URL("../../../../", import.meta.url))
const compiler = process.env.VIBELANG_COMPILER ?? path.join(root, "typescript/built/local/tsc")
const peers = path.join(root, "docs/tools/node_modules")
assert.ok(fs.existsSync(path.join(peers, "effect/package.json")), "Install the pinned docs/tools dependencies before the diagnostic reference case")
const inventory = JSON.parse(fs.readFileSync(path.join(root, "docs/design/inventory/lint-codes.json"), "utf8"))
const fixtures = JSON.parse(fs.readFileSync(new URL("./fixtures.json", import.meta.url), "utf8")).fixtures
const supported = inventory.rules.filter(rule => /SupportedEffect:\s*\[\]string\{[^}]*"v4"/.test(fs.readFileSync(path.join(root, rule.source), "utf8"))).map(rule => rule.code).sort()
// Chapter 007, imported code inventory: "assign one stable code per rule, even for a rule with several upstream messages."
const quote = "assign one stable code per rule, even for a rule with several upstream messages."
assert.ok(fs.readFileSync(path.join(root, "docs/design/src/007-tooling.md"), "utf8").includes(quote))
assert.deepEqual(fixtures.map(fixture => fixture.code).sort(), supported)
const base = fs.mkdtempSync(path.join(os.tmpdir(), "imported-diagnostic-reference-"))
let serial = 0
function mergePeers(source, destination) {
  for (const name of fs.readdirSync(source)) {
    const from = path.join(source, name), to = path.join(destination, name)
    if (!fs.existsSync(to)) fs.symlinkSync(from, to)
    else if (!fs.lstatSync(to).isSymbolicLink() && fs.statSync(to).isDirectory() && fs.statSync(from).isDirectory())
      mergePeers(from, to)
  }
}
async function check(fixture, prefix = "") {
  const dir = path.join(base, String(serial++))
  fs.mkdirSync(dir)
  const files = Object.entries(fixture.files)
  for (const [name, original] of files) {
    const destination = path.resolve(dir, name)
    assert.ok(destination.startsWith(dir + path.sep), fixture.code + ": fixture path must stay in its project")
    fs.mkdirSync(path.dirname(destination), { recursive: true })
    const text = name.endsWith(".ts") && !name.endsWith(".d.ts") ? prefix + original : original
    fs.writeFileSync(destination, text)
  }
  if (!fs.existsSync(path.join(dir, "package.json"))) fs.writeFileSync(path.join(dir, "package.json"), '{"type":"module"}')
  const modules = path.join(dir, "node_modules")
  if (!fs.existsSync(modules)) fs.symlinkSync(peers, modules)
  else mergePeers(peers, modules)
  const options = { ...fixture.options, target: "ESNext", module: "NodeNext", moduleResolution: "NodeNext", strict: true, skipLibCheck: true, noEmit: true, types: [] }
  const plugins = options.plugins ?? [{ name: "@effect/language-service" }]
  const plugin = plugins.find(entry => entry.name === "@effect/language-service")
  assert.ok(plugin)
  plugin.diagnosticSeverity = Object.fromEntries(inventory.rules.map(rule => [rule.rule, rule.rule === fixture.rule ? "warning" : "off"]))
  plugin.includeSuggestionsInTsc = true
  options.plugins = plugins
  const sources = files.map(([name]) => name).filter(name => name.endsWith(".ts") && !name.endsWith(".d.ts") && !name.startsWith("node_modules/"))
  fs.writeFileSync(path.join(dir, "tsconfig.json"), JSON.stringify({ compilerOptions: options, files: sources }))
  const result = await new Promise(resolve => execFile(compiler, ["--singleThreaded", "--pretty", "false", "-p", path.join(dir, "tsconfig.json")],
    { cwd: dir, encoding: "utf8", timeout: 20000, maxBuffer: 2 * 1024 * 1024 }, (error, stdout, stderr) => resolve({ error, output: stdout + stderr })))
  assert.ok(!result.error || typeof result.error.code === "number", fixture.code + ": compiler failed to finish")
  assert.ok(result.output.includes("warning " + fixture.code + ":"), fixture.code + " " + fixture.rule + ": " + result.output)
}
try {
  let next = 0
  const workers = await Promise.allSettled(Array.from({ length: 4 }, async () => {
    while (next < fixtures.length) await check(fixtures[next++])
  }))
  const failure = workers.find(result => result.status === "rejected")
  if (failure) throw failure.reason
  await fc.assert(fc.asyncProperty(fc.constantFrom(...fixtures), fc.constantFrom("\n", " \n", "// diagnostic witness\n"),
    async (fixture, whitespace) => check(fixture, whitespace)), { seed: 3838125, numRuns: 16 })
  console.log(fixtures.length + " imported diagnostic identities verified")
} finally {
  fs.rmSync(base, { recursive: true, force: true })
}
