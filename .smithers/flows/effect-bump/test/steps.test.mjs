import assert from "node:assert/strict"
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { failures, paths, report, start } from "../lib/steps.mjs"

test("failures names failing Go subtests and bun tests", () => {
  const go = "=== RUN   TestEffectRootNamesMatchEffect\n    effectroot_test.go:40: Crypto: in effect, not in the table\n--- FAIL: TestEffectRootNamesMatchEffect (0.40s)\nFAIL\n"
  const bun = "(pass) keeps going [1.00ms]\n(fail) Experimental.Crypto keeps Effect 4.0's members [3.20ms]\n"
  const tsc = "src/experimental/Crypto.ts(18,31): error TS2307: Cannot find module 'effect/crypto/SecureRandom' or its corresponding type declarations.\n$ tsc -p tsconfig.json\n"
  const forms = "vibelang-forms: the program has 1 diagnostics:\n  /r/packages/runtime/src/experimental/Crypto.ts: Cannot find module 'effect/crypto/SecureRandom' or its corresponding type declarations.\nexit status 1\n"
  assert.deepEqual(failures(go + bun + tsc + forms), [
    "TestEffectRootNamesMatchEffect",
    "Experimental.Crypto keeps Effect 4.0's members",
    "src/experimental/Crypto.ts(18,31): error TS2307: Cannot find module 'effect/crypto/SecureRandom' or its corresponding type declarations.",
    "/r/packages/runtime/src/experimental/Crypto.ts: Cannot find module 'effect/crypto/SecureRandom' or its corresponding type declarations."
  ])
})

test("a run refuses another version, and report lists each failing build and probe", (t) => {
  const run = mkdtempSync(join(tmpdir(), "effect-bump-"))
  t.after(() => rmSync(run, { recursive: true, force: true }))
  start(run, { repo: "/repo", version: "4.0.6" })
  assert.throws(() => start(run, { repo: "/repo", version: "4.2.0" }), /a run of effect 4\.0\.6/)
  writeFileSync(paths(run).literals, JSON.stringify({
    ok: true, from: "4.1.0", changed: ["docs/a.md"],
    kept: [{ file: "packages/runtime/bun.lock", glob: "**/bun.lock" }, { file: ".smithers/flows/migrate/test/x.test.mjs", glob: ".smithers/flows/migrate/test/**" },
      { file: "scripts/effect-pin.test.mjs", glob: "scripts/effect-pin.test.mjs" }]
  }))
  writeFileSync(paths(run).regenerate, JSON.stringify({
    ok: false,
    results: [{ name: "forms-table", command: "bash scripts/check-forms-table.sh --write", code: 1, seconds: 30, failures: [], output: "moved decision" }]
  }))
  writeFileSync(paths(run).build, JSON.stringify({
    ok: false,
    results: [{ name: "runtime-build", command: "bun run build", code: 2, seconds: 9, failures: ["src/a.ts(1,1): error TS2307: x"], output: "src/a.ts(1,1): error TS2307: x" }]
  }))
  writeFileSync(paths(run).probe, JSON.stringify({
    ok: false,
    results: [
      { name: "pins", command: "node scripts/effect-pin.mjs", code: 0, seconds: 1, failures: [], output: "" },
      { name: "compiler-tables", command: "go test", code: 1, seconds: 40, failures: ["TestEffectRootNamesMatchEffect"], output: "--- FAIL: TestEffectRootNamesMatchEffect" }
    ]
  }))
  assert.deepEqual(report(run).failing, ["src/a.ts(1,1): error TS2307: x", "forms-table", "TestEffectRootNamesMatchEffect"])
  const md = readFileSync(join(run, "report.md"), "utf8")
  assert.match(md, /\| compiler-tables \| fail \(40 s\) \| `TestEffectRootNamesMatchEffect` \|/)
  assert.match(md, /## compiler-tables/)
  assert.match(md, /## runtime-build/)
  assert.match(md, /## forms-table/)
  assert.doesNotMatch(md, /## pins/)
  // A pin guard waits for a person; a lockfile moves in install, and a fixture keeps its version.
  assert.match(md, /## Pin guards to move by hand[\s\S]*- `scripts\/effect-pin\.test\.mjs`/)
  assert.doesNotMatch(md, /bun\.lock|flows\/migrate/)
})
