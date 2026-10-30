import assert from "node:assert/strict"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { spawnSync } from "node:child_process"
import test from "node:test"
import { repo, read } from "./spec-witness.mjs"

for (const path of [
  "docs/design/src/001-functions.md",
  "docs/design/vips/0027-declaration-output.md",
  "docs/user/src/getting-started/004-installation.md",
  "docs/user/src/setup/vibelang-cli.md"
]) {
  test(path + ": Bun sidecar checking names the project's TypeScript script", () => {
    const text = read(path)
    assert.match(text, /`bun check`.*`check` script.*TypeScript/s)
    assert.doesNotMatch(text, /TypeDoc and `bun check` understand/)
  })
}

test("release guidance qualifies every Bun check reference as a project script", () => {
  const lines = read("docs/user/src/setup/release-notes.md").split("\n").filter(line => line.includes("`bun check`"))
  assert.ok(lines.length > 0)
  for (const line of lines) assert.match(line, /script/, line)
})

test("Bun selects the project script and TypeScript resolves the declaration sidecar", { timeout: 120_000 }, () => {
  const fixture = mkdtempSync(join(tmpdir(), "vibelang-bun-sidecar-"))
  const tsc = createRequire(join(repo, "experiments/package.json")).resolve("typescript/bin/tsc")
  const env = { ...process.env, SIDECAR_TSC_JS: tsc }
  const run = (command, args) => spawnSync(command, args, { cwd: fixture, env, encoding: "utf8", timeout: 60_000 })
  const manifest = scripts => writeFileSync(join(fixture, "package.json"), JSON.stringify({ name: "sidecar-check-probe", private: true, scripts }))
  const main = type => writeFileSync(join(fixture, "main.ts"), 'import { value } from "./foreign.vibe"\nconst result: ' + type + ' = value\n')
  try {
    manifest({})
    const missing = run("bun", ["check"])
    assert.notEqual(missing.status, 0)
    assert.match(missing.stderr, /check/i)

    writeFileSync(join(fixture, "tsconfig.json"), JSON.stringify({ compilerOptions: {
      target: "ES2022", module: "ESNext", moduleResolution: "Bundler", strict: true,
      noEmit: true, allowArbitraryExtensions: true, skipLibCheck: true, types: []
    }, files: ["main.ts"] }))
    writeFileSync(join(fixture, "foreign.d.vibe.ts"), "export declare const value: number\n")
    main("number")
    const checked = run("node", [tsc, "--pretty", "false"])
    assert.equal(checked.status, 0, checked.stdout + checked.stderr)

    main("string")
    writeFileSync(join(fixture, "check.cjs"), 'console.log("selected project script")\n')
    manifest({ check: "node check.cjs" })
    const custom = run("bun", ["check"])
    assert.equal(custom.status, 0, custom.stdout + custom.stderr)
    assert.match(custom.stdout, /selected project script/)

    manifest({ check: 'node "$SIDECAR_TSC_JS" --pretty false' })
    const rejected = run("bun", ["check"])
    assert.notEqual(rejected.status, 0)
    assert.match(rejected.stdout + rejected.stderr, /TS2322/)
    assert.doesNotMatch(rejected.stdout + rejected.stderr, /TS2307/)

    main("number")
    const accepted = run("bun", ["check"])
    assert.equal(accepted.status, 0, accepted.stdout + accepted.stderr)
    assert.match(readFileSync(join(fixture, "foreign.d.vibe.ts"), "utf8"), /value: number/)
  } finally {
    rmSync(fixture, { recursive: true, force: true })
  }
})
