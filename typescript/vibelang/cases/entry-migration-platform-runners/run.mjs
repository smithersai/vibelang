// run-seconds: 240
// rule-evidence: docs/design/src/007-tooling.md#legacy-entry-dispatch-migration | | `node` | `NodeRuntime.runMain` from `@effect/platform-node/NodeRuntime` | `NodeServices.layer` |
// rule-evidence: docs/design/src/007-tooling.md#legacy-entry-dispatch-migration | | `bun` | The same Node runner | `BunServices.layer` from `@effect/platform-bun/BunServices` |
// rule-evidence: docs/design/src/007-tooling.md#legacy-entry-dispatch-migration | | `browser` | `BrowserRuntime.runMain` from `@effect/platform-browser/BrowserRuntime` | `BrowserServices.layer` |
// rule-evidence: docs/design/src/007-tooling.md#legacy-entry-dispatch-migration | Refuse an unavailable runner or layer, an entry test not expressible in admitted source, or any other loss of types, behavior or declarations: keep the marker and report its file, line and reason as not fixed, with a nonzero exit.
// Why each row refuses: a runner written into the module would start main on
// import too, and no admitted source tests which module the host started.
// The refusal names the table's runner and the layer the legacy compiler
// selected; written by the owner, the advice compiles and runs.
import assert from "node:assert/strict"
import { codes, following, probe, refusal } from "../../tests/entry-migration.mjs"

const services = (platform) =>
  `import "vibelang/platform/${platform}"\nimport { FileSystem } from "effect/FileSystem"\n\n` +
  'export effect function main() {\n  try Console.log(try (try FileSystem).readFileString("config.json"))\n}\n'
const plain = (platform) => `import "vibelang/platform/${platform}"\n\nexport effect function main() {\n  try Console.log("${platform} main ran")\n}\n`
const from = (module) => new RegExp(`from\\s+["']${module.replace(/[/.]/g, "\\$&")}["']`)

// Each row: the marker, its main, what the advice imports and provides, what
// it must not name, and what running the advised source prints (browser
// output is compiled only).
const rows = [
  ["node-layer", services("node"), ["@effect/platform-node/NodeRuntime", "@effect/platform-node/NodeServices"], /^NodeRuntime\.runMain\(/, /NodeServices\.layer/, [], "config.json read through NodeServices.layer\n"],
  ["bun-layer", services("bun"), ["@effect/platform-node/NodeRuntime", "@effect/platform-bun/BunServices"], /^NodeRuntime\.runMain\(/, /BunServices\.layer/, [/NodeServices/], "config.json read through BunServices.layer\n"],
  ["bun-plain", plain("bun"), ["@effect/platform-node/NodeRuntime"], /^NodeRuntime\.runMain\(main\(\)\)$/, /^/, [/BunServices/, /NodeServices/], "bun main ran\n"],
  ["browser-layer", services("browser"), ["@effect/platform-browser/BrowserRuntime", "@effect/platform-browser/BrowserServices"], /^BrowserRuntime\.runMain\(/, /BrowserServices\.layer/, [/NodeRuntime/, /platform-node/], undefined],
  ["browser-plain", plain("browser"), ["@effect/platform-browser/BrowserRuntime"], /^BrowserRuntime\.runMain\(main\(\)\)$/, /^/, [/BrowserServices/, /NodeRuntime/, /platform-node/], undefined],
]
for (const [name, source, modules, runner, layer, absent, stdout] of rows) {
  const p = probe(import.meta.url, name, { "main.vibe": source })
  const fix = p.compile("--fix")
  assert.notEqual(fix.status, 0, `${name}: a refused startup fails --fix\n${fix.output}`)
  assert.equal(p.read("main.vibe"), source, `${name}: a refused startup keeps its source`)
  const advice = refusal(fix.output, "main.vibe", 1)
  assert.ok(advice?.runner, `${name}: the refusal names the marker's line and a runner\n${fix.output}`)
  const named = [...advice.imports, advice.runner].join("\n")
  for (const module of modules) assert.match(named, from(module), `${name}: imports ${module}: ${advice.line}`)
  assert.match(advice.runner, runner, `${name}: runner: ${advice.line}`)
  assert.match(advice.runner, layer, `${name}: layer: ${advice.line}`)
  for (const pattern of absent) assert.doesNotMatch(named, pattern, `${name}: ${advice.line}`)
  assert.deepEqual(codes(p.compile().output), ["EK2601"], `${name}: the remaining marker`)
  p.write("main.vibe", following(source, advice))
  const after = p.compile()
  assert.deepEqual(codes(after.output), [], `${name}: the advised source\n${after.output}`)
  assert.doesNotMatch(p.read("build/main.js"), /\$entry/, `${name}: the retired dispatcher remains`)
  if (stdout !== undefined) assert.equal(p.node("build/main.js").stdout, stdout, `${name}: entry execution`)
}

console.log("entry-migration-ok")
