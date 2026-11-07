// run-seconds: 240
// rule-evidence: docs/design/src/007-tooling.md#legacy-entry-dispatch-migration | An eligible legacy startup is an exported, non-default, zero-parameter function declaration `main` with a body and no checker-resolved top-level runner call under the pinned legacy compiler and options.
// rule-evidence: docs/design/src/007-tooling.md#legacy-entry-dispatch-migration | | `node` | `NodeRuntime.runMain` from `@effect/platform-node/NodeRuntime` | `NodeServices.layer` |
// rule-evidence: docs/design/src/007-tooling.md#legacy-entry-dispatch-migration | Pass `main()` for an Effect function, otherwise `Effect.sync(main)`, retaining the declaration's callable kind and public types.
// rule-evidence: docs/design/src/007-tooling.md#legacy-entry-dispatch-migration | Preserve entry-only execution and import-only behavior.
// rule-evidence: docs/design/src/007-tooling.md#legacy-entry-dispatch-migration | Refuse an unavailable runner or layer, an entry test not expressible in admitted source, or any other loss of types, behavior or declarations: keep the marker and report its file, line and reason as not fixed, with a nonzero exit.
// Why an eligible startup refuses: the legacy compiler started main only
// when the host started the module, and a runner written into the module
// would also start it on import. No admitted source tests which module the
// host started, so --fix keeps the marker and names the runner instead.
import assert from "node:assert/strict"
import { codes, following, marked, probe, refusal, sameLines, unmarked } from "../../tests/entry-migration.mjs"

// An eligible startup: --fix refuses at the marker's line, keeps the source,
// and names the Node runner with main() or Effect.sync(main). The advice,
// written by the owner, compiles with main's declaration unchanged and runs it.
const eligible = [
  {
    name: "effect-main",
    source: 'import "vibelang/platform/node"\n\nexport effect function main() {\n  try Console.log("effect main ran")\n}\n',
    runner: "NodeRuntime.runMain(main())",
    declaration: /export declare function main\(\): Effect\.Effect<void, never, never>;/,
    stdout: "effect main ran\n",
  },
  {
    name: "plain-main",
    source: 'import "vibelang/platform/node"\nimport { say } from "say"\n\nexport function main() {\n  say("plain main ran")\n}\n',
    runner: "NodeRuntime.runMain(Effect.sync(main))",
    declaration: /export declare function main\(\): void;/,
    stdout: "plain main ran\n",
  },
]
for (const { name, source, runner, declaration, stdout } of eligible) {
  const p = probe(import.meta.url, name, { "main.vibe": source })
  const fix = p.compile("--fix")
  assert.notEqual(fix.status, 0, `${name}: a refused startup fails --fix\n${fix.output}`)
  assert.equal(p.read("main.vibe"), source, `${name}: a refused startup keeps its source`)
  const advice = refusal(fix.output, "main.vibe", 1)
  assert.ok(advice, `${name}: the refusal names the file and the marker's line\n${fix.output}`)
  assert.deepEqual(advice.imports, ['import * as NodeRuntime from "@effect/platform-node/NodeRuntime"'], `${name}: ${advice.line}`)
  assert.equal(advice.runner, runner, `${name}: a marker does not by itself add a layer: ${advice.line}`)
  const kept = p.compile()
  assert.deepEqual(codes(kept.output), ["EK2601"], `${name}: the remaining marker\n${kept.output}`)
  assert.equal(p.node("build/main.js").stdout, "", `${name}: no implicit startup`)
  p.write("main.vibe", following(source, advice))
  const after = p.compile()
  assert.deepEqual(codes(after.output), [], `${name}: the advised source\n${after.output}`)
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
  assert.ok(!marked(text), `${name}: the inert marker remains:\n${text}`)
  assert.deepEqual(sameLines(text), sameLines(unmarked(source)), `${name}: only the marker goes`)
  const after = p.compile()
  assert.deepEqual(codes(after.output), [], `${name}:\n${after.output}`)
  assert.equal(p.node("build/main.js").stdout, stdout, `${name}: startup`)
}

console.log("entry-migration-ok")
