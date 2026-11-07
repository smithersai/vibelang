// Scope flags select fix passes; --only further limits ordinary repairs to
// the listed modules.
import assert from "node:assert/strict"
import { project, baseOptions } from "../_tooling-witness.mjs"

// One file per pass, each with exactly one repair available.
const files = {
  // TypeScript-form teaching rewrite (EK4833).
  "teach.vibe": 'import type { Effect } from "effect"\nexport type Run = Effect.Effect<number>\n',
  // VIP migration of the retired try(…) hatch (EK4616).
  "hatch.vibe": "export effect function parse(text: string) { return try((text) => JSON.parse(text), text) }\n",
  // VIP-1 try pass: a legacy call that ran where it stood.
  "legacy.vibe": "effect function load(n: number) { try Effect.yieldNow; return n }\nexport effect function f() { load(1); return 2 }\n",
  // Prelude/import cleanup.
  "prelude.vibe": 'import { Effect } from "effect"\nexport const p = Effect.succeed(1)\n',
}
const runs = [
  // [label, arguments, files the run must change]
  ["ordinary --fix", ["--fix"], ["hatch.vibe", "prelude.vibe", "teach.vibe"]],
  ["--fix-migration-only", ["--fix", "--fix-migration-only"], ["hatch.vibe"]],
  ["--fix-vip-only", ["--fix-vip-only", "--fix"], ["hatch.vibe", "legacy.vibe"]],
  ["--only teach.vibe", ["--fix", "--only", "teach.vibe"], ["teach.vibe"]],
  ["--only hatch.vibe,prelude.vibe", ["--fix", "--only", "hatch.vibe,prelude.vibe"], ["hatch.vibe", "prelude.vibe"]],
  ["--only repeated", ["--fix", "--only", "hatch.vibe", "--only", "legacy.vibe"], ["hatch.vibe"]],
  ["--only @list.txt", ["--fix", "--only", "@list.txt"], ["prelude.vibe", "teach.vibe"]],
  ["--only under --fix-migration-only", ["--fix", "--fix-migration-only", "--only", "hatch.vibe"], []],
  ["--only under --fix-vip-only", ["--fix-vip-only", "--fix", "--only", "hatch.vibe"], []],
]
for (const [label, args, changes] of runs) project(({ put, read, invoke }) => {
  for (const [file, text] of Object.entries(files)) put(file, text)
  put("list.txt", "teach.vibe\nprelude.vibe\n")
  // The config carries a legacy severity map, an owned-config repair.
  const config = JSON.stringify({ compilerOptions: { ...baseOptions(), noEmit: true }, files: Object.keys(files), vibelang: { diagnostics: { EK4609: "off" } } }, null, 2)
  put("tsconfig.json", config)
  const r = invoke(...args, "-p", ".", "--pretty", "false")
  const changed = Object.keys(files).filter(file => read(file) !== files[file]).sort()
  assert.deepEqual(changed, changes, label + "\n" + r.text)
  // Scope flags keep the config pass; --only writes no file but the listed modules.
  const only = args.includes("--only")
  assert.equal(read("tsconfig.json") !== config, !only, label + " config\n" + read("tsconfig.json"))
  if (!only) assert.equal(JSON.parse(read("tsconfig.json")).vibe.severities.EK4609, "off", label)
  if (changes.includes("teach.vibe")) assert.match(read("teach.vibe"), /Run = number!!/, label)
  if (changes.includes("hatch.vibe")) assert.match(read("hatch.vibe"), /try Effect\.try\(\(\) => JSON\.parse\(text\)\)/, label)
  if (changes.includes("legacy.vibe")) assert.match(read("legacy.vibe"), /try load\(1\)/, label)
  if (changes.length === 0) {
    assert.notEqual(r.status, 0, label)
    assert.match(r.text, /--only takes ordinary --fix/, label + "\n" + r.text)
  }
})
console.log("scope flags select fix passes and --only limits ordinary repairs to the listed modules")
