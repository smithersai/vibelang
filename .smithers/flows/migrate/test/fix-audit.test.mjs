import assert from "node:assert/strict"
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { fixToFixedPoint } from "../lib/codemod.mjs"
import { fakeProjectFiles } from "./helpers/fake-project-files.mjs"

test("logged migration rounds request separate native refusal audits", async () => {
 const root = mkdtempSync(join(tmpdir(), "migration-fix-audit-"))
 try {
  writeFileSync(join(root, "main.vibe"), "export const value = 1\n")
  const compiler = join(root, "compiler.cjs")
  writeFileSync(compiler, `#!/usr/bin/env node
${fakeProjectFiles(root)}
const fs = require("node:fs")
fs.appendFileSync("audit-paths.jsonl", JSON.stringify(process.env.VIBELANG_FIX_AUDIT_DIR ?? null) + "\\n")
const count = fs.readFileSync("audit-paths.jsonl", "utf8").trim().split("\\n").length
if (count === 1) console.log("vibelang --fix: main.vibe: 1 fix (prelude import ×1)")
console.log("vibelang --fix: " + (count === 1 ? "1 fix in 1 file." : "0 fixes in 0 files."))
`)
  chmodSync(compiler, 0o755)
  const log = join(root, "fix")
  const result = await fixToFixedPoint({ compiler, root, cwd: root, tsconfig: "tsconfig.json", log, maxRounds: 2, onProgress: null })
  const paths = readFileSync(join(root, "audit-paths.jsonl"), "utf8").trim().split("\n").map(JSON.parse)
  assert.deepEqual(paths, [log + ".1.audit", log + ".2.audit"])
  assert.deepEqual(result.rounds.map(round => round.audit), paths)
 } finally { rmSync(root, { recursive: true, force: true }) }
})
