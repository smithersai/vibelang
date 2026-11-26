import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import path from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
const require = createRequire(path.join(repo, ".smithers/package.json"))
const Target = require("@smthrs/targets/Target")
const { openPackageIndex } = require("@smthrs/build-cli/Cli")

// Normalize a command from .smithers/package.json (which runs with cwd=.smithers)
// to the repository-root command declared in PACKAGE.ts.
function normalizeDocsCommand(cmd) {
  const trimmed = cmd.trim()
  if (trimmed === "bun run flows/docs/generate.ts") return "cd .smithers && bun run flows/docs/generate.ts"
  if (trimmed === "node flows/migrate/build-context.mjs") return "node .smithers/flows/migrate/build-context.mjs"
  return trimmed.replaceAll(" ../", " ")
}

test("every generator in .smithers/package.json docs:generate has a matching S.Generate target in //:docs-generators (#472)", async () => {
  const manifest = JSON.parse(readFileSync(path.join(repo, ".smithers/package.json"), "utf8"))
  const chain = manifest.scripts["docs:generate"].split("&&").map((part) => part.trim()).filter(Boolean)
  // release-history.mjs --check is a check, not a file generator.
  const generatorCommands = chain
    .filter((cmd) => !/\s--check\b/.test(cmd))
    .map(normalizeDocsCommand)
  assert.ok(generatorCommands.length >= 10, `expected >=10 generators in docs:generate, got ${generatorCommands.length}`)

  const index = await openPackageIndex({ workspace: repo })
  const suiteEntry = index.byLabel.get("//:docs-generators")
  assert.ok(suiteEntry, "//:docs-generators Suite target must exist")
  const suiteTarget = suiteEntry.target ?? suiteEntry
  const suiteMeta = Target.metadata(suiteTarget)
  assert.equal(suiteMeta.target, "Suite")

  const declared = new Map()
  for (const member of suiteMeta.attrs.tests) {
    const label = index.labelsByTarget.get(member)
    const meta = Target.metadata(member)
    assert.equal(meta.target, "Generate", `${label} must be an S.Generate target`)
    assert.equal(meta.attrs.mode, "check", `${label} must declare mode: "check"`)
    assert.equal(meta.attrs.sandbox, "none", `${label} must declare sandbox: "none"`)
    assert.ok(Array.isArray(meta.attrs.changes) && meta.attrs.changes.length > 0, `${label} must declare changes`)
    assert.ok(typeof meta.attrs.command === "string" && meta.attrs.command.length > 0, `${label} must declare command`)
    declared.set(meta.attrs.command, label)
  }

  for (const cmd of generatorCommands) {
    assert.ok(declared.has(cmd), `docs:generate command missing from //:docs-generators: ${cmd}`)
  }
  assert.ok(declared.has("node scripts/generate-diagnostic-registry.mjs"), "//:docs-generators includes docs-diagnostic-registry")
})

test("//:release-changes target validates docs/user/changes/ (#472)", async () => {
  const index = await openPackageIndex({ workspace: repo })
  const entry = index.byLabel.get("//:release-changes")
  assert.ok(entry, "//:release-changes target must exist")
  const meta = Target.metadata(entry.target ?? entry)
  assert.equal(meta.target, "Shell.Test")
  assert.match(meta.attrs.shell, /node docs\/tools\/release-changes\.mjs --check/)
})
