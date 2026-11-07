// run-seconds: 240
// rule-evidence: docs/design/src/007-tooling.md#legacy-entry-dispatch-migration | An eligible legacy startup is an exported, non-default, zero-parameter function declaration `main` with a body and no checker-resolved top-level runner call under the pinned legacy compiler and options.
// rule-evidence: docs/design/src/007-tooling.md#legacy-entry-dispatch-migration | `vibelang --fix` removes the marker and expands eligible startup as follows:
// rule-evidence: docs/design/src/007-tooling.md#legacy-entry-dispatch-migration | | `node` | `NodeRuntime.runMain` from `@effect/platform-node/NodeRuntime` | `NodeServices.layer` |
// rule-evidence: docs/design/src/007-tooling.md#legacy-entry-dispatch-migration | Pass `main()` for an Effect function, otherwise `Effect.sync(main)`, retaining the declaration's callable kind and public types.
import assert from "node:assert/strict"
import { codes, marked, probe, sameLines, unmarked } from "../../tests/entry-migration.mjs"

// An eligible startup: the marker goes, an explicit node runner starts main when
// the host starts the module, and the declaration is unchanged.
const eligible = [
  {
    name: "effect-main",
    source: 'import "vibelang/platform/node"\n\nexport effect function main() {\n  try Console.log("effect main ran")\n}\n',
    argument: /NodeRuntime\.runMain\(\s*main\(\)\s*\)/,
    declaration: /export declare function main\(\): Effect\.Effect<void, never, never>;/,
    stdout: "effect main ran\n",
  },
  {
    name: "plain-main",
    source: 'import "vibelang/platform/node"\nimport { say } from "say"\n\nexport function main() {\n  say("plain main ran")\n}\n',
    argument: /NodeRuntime\.runMain\(\s*(?:Effect\.)?sync\(\s*main\s*\)\s*\)/,
    declaration: /export declare function main\(\): void;/,
    stdout: "plain main ran\n",
  },
]
for (const { name, source, argument, declaration, stdout } of eligible) {
  const p = probe(import.meta.url, name, { "main.vibe": source })
  const fix = p.compile("--fix")
  assert.equal(fix.status, 0, `${name}: --fix\n${fix.output}`)
  const text = p.read("main.vibe")
  assert.ok(!marked(text), `${name}: the marker remains:\n${text}`)
  assert.match(text, /from\s+["']@effect\/platform-node\/NodeRuntime["']/, `${name}:\n${text}`)
  assert.match(text, argument, `${name}:\n${text}`)
  assert.doesNotMatch(text, /NodeServices/, `${name}: a marker does not by itself add a layer:\n${text}`)
  const after = p.compile()
  assert.deepEqual(codes(after.output), [], `${name}: the migrated source\n${after.output}`)
  assert.match(p.read("build/main.d.ts"), declaration, `${name}: public types`)
  assert.doesNotMatch(p.read("build/main.js"), /\$entry/, `${name}: the retired dispatcher remains`)
  assert.equal(p.node("build/main.js").stdout, stdout, `${name}: entry execution`)
}

// Without eligible startup the fix removes only the inert marker: the rest of
// the source, an explicit runner included, is kept and nothing new starts.
const ineligible = [
  ["default-main", 'export default function main() {\n  say("started")\n}\n', ""],
  ["parameter-main", 'export function main(argv: string[]) {\n  say("started")\n}\n', ""],
  ["local-main", 'function main() {\n  say("started")\n}\nexport const run = main\n', ""],
  ["const-main", 'export const main = () => {\n  say("started")\n}\n', ""],
  ["runner-main", 'import * as NodeRuntime from "@effect/platform-node/NodeRuntime"\n\nexport effect function main() {\n  try Console.log("runner ran")\n}\n\nNodeRuntime.runMain(main())\n', "runner ran\n"],
]
for (const [name, body, stdout] of ineligible) {
  const source = 'import "vibelang/platform/node"\n' + (body.includes("say(") ? 'import { say } from "say"\n' : "") + body
  const p = probe(import.meta.url, name, { "main.vibe": source })
  const fix = p.compile("--fix")
  assert.equal(fix.status, 0, `${name}: --fix\n${fix.output}`)
  const text = p.read("main.vibe")
  assert.deepEqual(sameLines(text), sameLines(unmarked(source)), `${name}: only the marker goes`)
  const after = p.compile()
  assert.deepEqual(codes(after.output), [], `${name}:\n${after.output}`)
  assert.equal(p.node("build/main.js").stdout, stdout, `${name}: startup`)
}

console.log("entry-migration-ok")
