// drive-opencode round 4: opencode's lint:effect-patterns reported a finding
// in core's effect/delete.vibe twice, once more in its delete.d.vibe.ts
// sidecar, which the repository's TypeScript rules scan as TypeScript.
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { sidecarIgnoreOf, withoutSidecarIgnore, wireDeveloperTools } from "../lib/tooling.mjs"

const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const fc = require("fast-check")
const deps = process.env.VIBELANG_TOOLING_NODE_MODULES
const specsFor = () => ({ vibelang: "0.0.11" })

function fixture(t, files) {
  const root = mkdtempSync(join(tmpdir(), "migrate-ast-grep-sidecars-"))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, file)), { recursive: true })
    writeFileSync(join(root, file), text)
  }
  return root
}

const rule = (ignores) => `id: no-debugger\nlanguage: typescript\nfiles:\n  - "src/**/*.ts"\n${ignores}severity: error\nmessage: debugger is forbidden\nrule:\n  kind: debugger_statement\n`

test("setup adds the sidecars to a TypeScript rule's ignores, and its .vibe copy stays as before", t => {
  for (const [ignores, expected] of [
    ["", 'ignores:\n  - "**/*.d.vibe.ts"\n'],
    ["ignores:\n  - src/legacy/**\n", 'ignores:\n  - "**/*.d.vibe.ts"\n  - src/legacy/**\n'],
    ["ignores: [src/legacy/**]\n", 'ignores: ["**/*.d.vibe.ts", src/legacy/**]\n'],
    ["ignores: []\n", 'ignores: ["**/*.d.vibe.ts"]\n']
  ]) {
    const root = fixture(t, { "package.json": "{}", "sgconfig.yml": "ruleDirs:\n  - rules\n", "rules/no-debugger.yml": rule(ignores) })
    wireDeveloperTools({ root, specsFor })
    const original = readFileSync(join(root, "rules/no-debugger.yml"), "utf8")
    assert.ok(original.includes(expected), original)
    assert.equal(withoutSidecarIgnore(original), rule(ignores))
    const clone = readFileSync(join(root, "rules/no-debugger.vibelang.yml"), "utf8")
    assert.doesNotMatch(clone, /d\.vibe/)
    assert.match(clone, /src\/\*\*\/\*\.vibe/)
    assert.deepEqual(wireDeveloperTools({ root, specsFor }).changed, [])
  }
})

// Rule texts: ignores absent, block, flow or empty, other keys around them,
// with and without a final newline. Adding is idempotent and removing restores the text.
const key = fc.constantFrom("id: r\n", "language: tsx\n", "severity: warning\n", "files:\n  - src/**\n", "rule:\n  kind: debugger_statement\n", "# a comment\n")
const ignores = fc.constantFrom("", "ignores:\n  - a/**\n", "ignores:\n    - a/**\n    - b/**\n", "ignores: [a/**, b/**]\n", "ignores: []\n", "ignores: # legacy\n  - a/**\n")
test("ast-grep-sidecar-ignore: added once, removed exactly", () => {
  fc.assert(fc.property(fc.array(key, { maxLength: 4 }), ignores, fc.array(key, { maxLength: 3 }), fc.boolean(), (before, ignore, after, newline) => {
    let text = before.join("") + ignore + after.join("")
    if (!newline) text = text.replace(/\n$/, "")
    const added = sidecarIgnoreOf(text)
    assert.equal(added.split('"**/*.d.vibe.ts"').length - 1, 1, added)
    assert.equal(sidecarIgnoreOf(added), added)
    assert.equal(withoutSidecarIgnore(added), text)
    assert.equal(added.split("\n").filter((l) => /^ignores:/.test(l)).length, 1, added)
  }), { seed: 34034, numRuns: 300 })
})

test("ast-grep scan reports a .vibe module's finding once, not again in its sidecar", { skip: !deps && "set VIBELANG_TOOLING_NODE_MODULES" }, t => {
  const root = fixture(t, {
    "package.json": "{}",
    "sgconfig.yml": "ruleDirs:\n  - rules\n",
    "rules/no-debugger.yml": "id: no-debugger\nlanguage: typescript\nseverity: error\nmessage: debugger is forbidden\nrule:\n  kind: debugger_statement\n",
    "src/delete.vibe": "export function f(): number { debugger; return 1 }\n",
    "src/delete.d.vibe.ts": "export declare function f(): number;\ndebugger;\n",
    "src/plain.ts": "debugger;\n"
  })
  wireDeveloperTools({ root, specsFor })
  const build = spawnSync(process.execPath, [new URL("../../../../packages/compiler/bin/vibelang-ast-grep", import.meta.url).pathname, join(root, ".vibelang/vibelang-parser")], { encoding: "utf8" })
  assert.equal(build.status, 0, build.stderr)
  const cli = join(deps, ".bin/ast-grep")
  // Current ast-grep requires explicit permission for the native parser
  // this test just built; older supported versions have no such flag.
  const help = spawnSync(cli, ["scan", "--help"], { encoding: "utf8" })
  const custom = help.stdout?.includes("--custom-languages") ? ["--custom-languages", "allow"] : []
  const scan = spawnSync(cli, ["scan", ...custom, "--config", "sgconfig.yml", "--json=compact", "."], { cwd: root, encoding: "utf8" })
  assert.ok(scan.stdout?.trim(), `ast-grep scan exited ${scan.status} (${scan.signal ?? "no signal"}): ${scan.error?.message ?? ""}\n${scan.stderr}`)
  const files = JSON.parse(scan.stdout).map((m) => `${m.ruleId} ${m.file}`).sort()
  assert.deepEqual(files, ["no-debugger src/plain.ts", "no-debugger-vibelang src/delete.vibe"])
})
