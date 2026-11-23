#!/usr/bin/env node
import assert from "node:assert/strict"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { runSuite } from "../lib/harness.mjs"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..")
const require = createRequire(path.join(root, "packages/runtime/package.json"))
const ts = require("typescript")
const { pathReadDeferrals } = await import(path.join(root, ".smithers/flows/migrate/lib/references.mjs"))
const { rewriteSourceLiterals } = await import(path.join(root, ".smithers/flows/migrate/lib/source-paths.mjs"))

const refCorpus = JSON.parse(readFileSync(path.join(root, ".smithers/flows/migrate/test/corpus/alchemy-generated-service-comment-scan.json"), "utf8"))
const braceCorpus = JSON.parse(readFileSync(path.join(root, ".smithers/flows/migrate/test/corpus/foldkit-selector-brace-literals.json"), "utf8"))

const work = mkdtempSync(path.join(os.tmpdir(), "vibelang-migrate-bench-"))
try {
  writeFileSync(path.join(work, "package.json"), '{"name":"sample"}')
  writeFileSync(path.join(work, "entry.ts"), "export const value = 1\n")
  const item = refCorpus.comment + "\n/** " + refCorpus.padding.repeat(3) + "*/\n" + refCorpus.code + "\n"
  writeFileSync(path.join(work, "generated.ts"), item.repeat(Math.min(refCorpus.repeat, 400)))

  const braceText = Array.from({ length: Math.min(braceCorpus.count, 500) }, (_, i) =>
    "const value" + i + " = " + JSON.stringify(i % 2 ? braceCorpus.data : braceCorpus.longPath) + ";"
  ).join("\n") + "\nconst selected = import.meta.glob(" + JSON.stringify(braceCorpus.glob) + ");"

  await runSuite({
    suite: "migrate-flow",
    category: "tooling",
    description: "Migration flow static analyzers: reference-mask comment scan and source-path glob literal rewriter.",
    cases: [
      {
        name: "pathReadDeferrals (generated-service corpus)",
        samples: 7,
        warmup: 2,
        batch: 1,
        fn: () => pathReadDeferrals(work, ["entry.ts"], ["generated.ts"]),
        verify: (found) => assert.deepEqual(found, [])
      },
      {
        name: "rewriteSourceLiterals (500 brace literals)",
        samples: 7,
        warmup: 2,
        batch: 1,
        fn: () => rewriteSourceLiterals(ts, braceText, "collector.ts", braceCorpus.renames, {
          inventory: braceCorpus.renames.map((r) => r.from)
        }),
        verify: (r) => assert.equal(r.edits.length, 1)
      }
    ]
  })
} finally {
  rmSync(work, { recursive: true, force: true })
}
