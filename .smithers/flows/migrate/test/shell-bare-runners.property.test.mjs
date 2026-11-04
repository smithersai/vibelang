import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { bareRunnerDeferrals } from "../lib/bare-runners.mjs"

const fc = createRequire(new URL("../../../../docs/tools/package.json", import.meta.url))("fast-check")
const corpus = JSON.parse(readFileSync(new URL("./corpus/smithers-offline-shell-runner.json", import.meta.url), "utf8"))
function check({ directory = ".", wired = false, separator = "\n", dynamic = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), "shell-runner-"))
  const at = file => directory === "." ? file : directory + "/" + file
  const shell = "#!/bin/sh\nset -eu\n" + (directory === "." ? "" : "cd " + (dynamic ? '"$BUILD_ROOT"' : directory) + separator) +
    "node " + (wired ? "--import=vibelang/register " : "") + "fixtures/check-offline-target.mjs\n"
  const files = { ...corpus.files }
  delete files["fixtures/check-offline-target.mjs"]
  files[at("fixtures/check-offline-target.mjs")] = 'import "' + (directory === "." ? "../" : "../../") + 'src/ProcessFault.ts"\n'
  files["scripts/check-offline.sh"] = shell
  try {
    for (const [file, text] of Object.entries(files)) {
      mkdirSync(dirname(join(root, file)), { recursive: true })
      writeFileSync(join(root, file), text)
    }
    const result = bareRunnerDeferrals(root, ["src/ProcessFault.ts", "src/Independent.ts"])
    const refused = result.deferred.find(item => item.file === "src/ProcessFault.ts")
    assert.equal(Boolean(refused), !wired || dynamic && directory !== ".", JSON.stringify(result))
    assert.ok(!result.deferred.some(item => item.file === "src/Independent.ts"))
    const receipt = [...result.entries, ...result.wired].find(item => item.entry === at("fixtures/check-offline-target.mjs"))
    assert.ok(receipt, JSON.stringify(result))
    assert.match(receipt.via, /scripts\/check-offline\.sh:\d+/)
    assert.match(receipt.command, /node .*fixtures\/check-offline-target\.mjs/)
    assert.equal(readFileSync(join(root, "scripts/check-offline.sh"), "utf8"), shell)
  } finally { rmSync(root, { recursive: true, force: true }) }
}
test("offline build shell retains its bare Node source graph and original command", () => check())
test("shell working directories and loader flags are evaluated at the runner", () => {
  check({ directory: "tools" })
  check({ directory: "tools", wired: true })
  check({ directory: "tools", wired: true, dynamic: true })
})
test("shell runner discovery preserves reachability across directories and separators", () => {
  fc.assert(fc.property(fc.record({
    directory: fc.constantFrom(".", "tools", "checks"),
    wired: fc.boolean(), separator: fc.constantFrom("\n", " && ", "; "),
    dynamic: fc.boolean()
  }), check), { seed: 386, numRuns: 30 })
})
