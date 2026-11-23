#!/usr/bin/env node
import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { runSuite } from "../lib/harness.mjs"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..")
const { compareApiIdentity, loadTypeScript } = await import(path.join(root, "scripts/api-identity.mjs"))
const ts = loadTypeScript()

const work = mkdtempSync(path.join(os.tmpdir(), "vibelang-api-identity-bench-"))
try {
  const makePkg = (dir, count) => {
    mkdirSync(path.join(dir, "dist"), { recursive: true })
    writeFileSync(path.join(dir, "package.json"), JSON.stringify({
      name: "@bench/api-surface",
      version: "1.0.0",
      type: "module",
      exports: { ".": { types: "./dist/index.d.ts", import: "./dist/index.js" } }
    }, null, 2))
    const lines = []
    for (let i = 0; i < count; i++) {
      lines.push(`/** Record ${i} */\nexport interface Rec${i} { readonly id: string; readonly count: number; readonly tag?: "a" | "b" }`)
      lines.push(`/** Compute ${i} */\nexport declare function compute${i}(input: Rec${i}, extra?: number): Promise<ReadonlyArray<Rec${i}>>`)
    }
    writeFileSync(path.join(dir, "dist/index.d.ts"), lines.join("\n") + "\n")
    writeFileSync(path.join(dir, "dist/index.js"), "export {}\n")
  }

  const baseSmall = path.join(work, "base-20")
  const candSmall = path.join(work, "cand-20")
  makePkg(baseSmall, 20)
  makePkg(candSmall, 20)

  const baseMed = path.join(work, "base-100")
  const candMed = path.join(work, "cand-100")
  makePkg(baseMed, 100)
  makePkg(candMed, 100)

  await runSuite({
    suite: "api-identity",
    category: "tooling",
    description: "Published declaration identity comparator (scripts/api-identity.mjs) across 20 and 100 exported symbols.",
    cases: [
      {
        name: "compareApiIdentity (20 exported decls)",
        samples: 5,
        warmup: 1,
        batch: 1,
        fn: () => compareApiIdentity(ts, baseSmall, candSmall),
        verify: (r) => assert.equal(r.identical, true, JSON.stringify(r))
      },
      {
        name: "compareApiIdentity (100 exported decls)",
        samples: 5,
        warmup: 1,
        batch: 1,
        fn: () => compareApiIdentity(ts, baseMed, candMed),
        verify: (r) => assert.equal(r.identical, true, JSON.stringify(r))
      }
    ]
  })
} finally {
  rmSync(work, { recursive: true, force: true })
}
