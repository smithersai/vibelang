#!/usr/bin/env node
// The standalone migrate flow carries generated copies of the shared checker.
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const mode = process.argv[2]
if (!["--check", "--write"].includes(mode)) {
  console.error("usage: node scripts/sync-api-identity.mjs --check|--write")
  process.exit(2)
}
for (const name of ["api-identity.mjs", "api-identity-nominal.mjs"]) {
  const source = readFileSync(join(root, "scripts", name), "utf8").replace(/^#![^\n]*\n/, "")
  const expected = "// Generated from scripts/" + name + "; run node scripts/sync-api-identity.mjs --write.\n" + source
  const target = join(root, ".smithers/flows/migrate/lib", name)
  const current = existsSync(target) ? readFileSync(target, "utf8") : undefined
  if (current === expected) continue
  if (mode === "--check") {
    console.error("stale migrate checker: " + name + "; run node scripts/sync-api-identity.mjs --write")
    process.exitCode = 1
  } else {
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, expected)
  }
}
