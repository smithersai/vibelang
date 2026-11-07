// run-seconds: 240
// rule-evidence: docs/design/src/007-tooling.md#legacy-entry-dispatch-migration | | `node` | `NodeRuntime.runMain` from `@effect/platform-node/NodeRuntime` | `NodeServices.layer` |
// rule-evidence: docs/design/src/007-tooling.md#legacy-entry-dispatch-migration | | `bun` | The same Node runner | `BunServices.layer` from `@effect/platform-bun/BunServices` |
// rule-evidence: docs/design/src/007-tooling.md#legacy-entry-dispatch-migration | | `browser` | `BrowserRuntime.runMain` from `@effect/platform-browser/BrowserRuntime` | `BrowserServices.layer` |
import assert from "node:assert/strict"
import { codes, marked, probe } from "../../tests/entry-migration.mjs"

const services = (platform) =>
  `import "vibelang/platform/${platform}"\nimport { FileSystem } from "effect/FileSystem"\n\n` +
  'export effect function main() {\n  try Console.log(try (try FileSystem).readFileString("config.json"))\n}\n'
const plain = (platform) => `import "vibelang/platform/${platform}"\n\nexport effect function main() {\n  try Console.log("${platform} main ran")\n}\n`
const from = (module) => new RegExp(`from\\s+["']${module.replace(/[/.]/g, "\\$&")}["']`)

// Each row: the marker, its main, what the migrated source imports and
// provides, what it must not name, and what running it prints (browser
// output is compiled only).
const rows = [
  ["node-layer", services("node"), ["@effect/platform-node/NodeRuntime", "@effect/platform-node/NodeServices"], /NodeRuntime\.runMain\(/, /NodeServices\.layer/, [], "config.json read through NodeServices.layer\n"],
  ["bun-layer", services("bun"), ["@effect/platform-node/NodeRuntime", "@effect/platform-bun/BunServices"], /NodeRuntime\.runMain\(/, /BunServices\.layer/, [/NodeServices/], "config.json read through BunServices.layer\n"],
  ["bun-plain", plain("bun"), ["@effect/platform-node/NodeRuntime"], /NodeRuntime\.runMain\(\s*main\(\)\s*\)/, /^/, [/BunServices/, /NodeServices/], "bun main ran\n"],
  ["browser-layer", services("browser"), ["@effect/platform-browser/BrowserRuntime", "@effect/platform-browser/BrowserServices"], /BrowserRuntime\.runMain\(/, /BrowserServices\.layer/, [/NodeRuntime/, /platform-node/], undefined],
  ["browser-plain", plain("browser"), ["@effect/platform-browser/BrowserRuntime"], /BrowserRuntime\.runMain\(\s*main\(\)\s*\)/, /^/, [/BrowserServices/, /NodeRuntime/, /platform-node/], undefined],
]
for (const [name, source, modules, runner, layer, absent, stdout] of rows) {
  const p = probe(import.meta.url, name, { "main.vibe": source })
  const fix = p.compile("--fix")
  assert.equal(fix.status, 0, `${name}: --fix\n${fix.output}`)
  const text = p.read("main.vibe")
  assert.ok(!marked(text), `${name}: the marker remains:\n${text}`)
  for (const module of modules) assert.match(text, from(module), `${name}: imports ${module}:\n${text}`)
  assert.match(text, runner, `${name}: runner:\n${text}`)
  assert.match(text, layer, `${name}: layer:\n${text}`)
  for (const pattern of absent) assert.doesNotMatch(text, pattern, `${name}:\n${text}`)
  const after = p.compile()
  assert.deepEqual(codes(after.output), [], `${name}: the migrated source\n${after.output}`)
  assert.doesNotMatch(p.read("build/main.js"), /\$entry/, `${name}: the retired dispatcher remains`)
  if (stdout !== undefined) assert.equal(p.node("build/main.js").stdout, stdout, `${name}: entry execution`)
}

console.log("entry-migration-ok")
