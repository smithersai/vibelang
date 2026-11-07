// run-seconds: 120
// rule-evidence: docs/design/src/007-tooling.md#legacy-entry-dispatch-migration | Use a listed service layer only when the pinned legacy compiler selected it; preserve selected experimental layers and nesting order.
// rule-evidence: docs/design/src/007-tooling.md#legacy-entry-dispatch-migration | Refuse an unavailable runner or layer, an entry test not expressible in admitted source, or any other loss of types, behavior or declarations: keep the marker and report its file, line and reason as not fixed, with a nonzero exit.
// The marked sources in inputs/ once started main through the retired entry
// dispatcher. Each now keeps its marker under vibelang --fix, whose refusal
// names the runner and layers the legacy compiler selected; this case checks
// that selection, writes the advice into the modules the host starts, as the
// program's owner would, and runs them as before.
import assert from "node:assert/strict"
import { migrated } from "../../tests/entry-migration.mjs"
const m = migrated(import.meta.url, ["main.vibe", "provide.vibe", "needless.vibe"])
assert.notEqual(m.fix.status, 0, `a refused startup fails --fix\n${m.fix.output}`)
assert.deepEqual(m.runners(), {
  "main.vibe": "NodeRuntime.runMain(Effect.provide(main(), NodeServices.layer))",
  "needless.vibe": "NodeRuntime.runMain(main())",
  "provide.vibe": "NodeRuntime.runMain(Effect.provide(main(), NodeServices.layer))"
}, m.fix.output)
assert.equal(m.build.status, 0, `the advised source compiles cleanly\n${m.build.output}`)
for (const [command, args] of [["node", ["out/main.js"]], ["node", ["out/provide.js"]], ["node", ["out/needless.js"]]]) {
  const started = m.run(command === "node" ? process.execPath : command, args)
  assert.equal(started.status, 0, `${args.join(" ")}\n${started.output}`)
  process.stdout.write(started.stdout)
}
