#!/usr/bin/env node
// Compiles and benchmarks the real compiled .vibe vs Effect TS runtime-cost loops
// from docs/user/benchmarks/runtime-cost/src/.
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { cpSync, existsSync, mkdtempSync, rmSync } from "node:fs"
import { createRequire } from "node:module"
import os from "node:os"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { runSuite } from "../lib/harness.mjs"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..")
const nativeName = process.platform === "win32" ? "vibelang.exe" : "vibelang"
const compiler = process.env.VIBELANG
  ? path.resolve(process.env.VIBELANG)
  : existsSync(path.join(root, "packages/compiler/native", nativeName))
    ? path.join(root, "packages/compiler/native", nativeName)
    : path.join(root, "typescript/built/local/tsc")

if (!existsSync(compiler)) {
  console.error(`runtime-compiled-loops.bench.mjs: missing compiler at ${compiler}`)
  process.exit(1)
}

const work = mkdtempSync(path.join(os.tmpdir(), "vibelang-compiled-loops-"))
try {
  execFileSync("sh", [path.join(root, "scripts/bench/modules.sh"), work], { stdio: "pipe" })
  const srcBench = path.join(root, "docs/user/benchmarks/runtime-cost")
  cpSync(path.join(srcBench, "src"), path.join(work, "src"), { recursive: true })
  cpSync(path.join(srcBench, "tsconfig.json"), path.join(work, "tsconfig.json"))

  execFileSync(compiler, ["-p", path.join(work, "tsconfig.json"), "--pretty", "false"], { cwd: work, stdio: "pipe" })

  const req = createRequire(path.join(work, "package.json"))
  const { Effect } = req("effect")
  const vibeLoops = await import(pathToFileURL(path.join(work, "dist/vibe-loops.js")).href)
  const effectLoops = await import(pathToFileURL(path.join(work, "dist/effect-loops.js")).href)

  const tryCalls = 20_000
  const catchCalls = 100_000

  await runSuite({
    suite: "runtime-compiled-loops",
    category: "runtime",
    description: "Compiled .vibe loops (tryLoop, catchLoop, plainLoop) vs hand-written Effect TS loops (fnLoop, orElseSucceedLoop).",
    cases: [
      {
        name: "vibe tryLoop (20k calls)",
        opsPerCall: tryCalls,
        unit: "ns/op",
        batch: 1,
        fn: () => Effect.runSync(vibeLoops.tryLoop(tryCalls)),
        verify: (v) => assert.equal(v, tryCalls)
      },
      {
        name: "effect fnLoop (20k calls)",
        opsPerCall: tryCalls,
        unit: "ns/op",
        batch: 1,
        fn: () => Effect.runSync(effectLoops.fnLoop(tryCalls)),
        verify: (v) => assert.equal(v, tryCalls)
      },
      {
        name: "vibe catchLoop (100k calls)",
        opsPerCall: catchCalls,
        unit: "ns/op",
        batch: 1,
        fn: () => Effect.runSync(vibeLoops.catchLoop(catchCalls)),
        verify: (v) => assert.equal(v, catchCalls % 250_000)
      },
      {
        name: "effect orElseSucceedLoop (100k calls)",
        opsPerCall: catchCalls,
        unit: "ns/op",
        batch: 1,
        fn: () => Effect.runSync(effectLoops.orElseSucceedLoop(catchCalls)),
        verify: (v) => assert.equal(v, catchCalls % 250_000)
      },
      {
        name: "vibe plainLoop (100k calls)",
        opsPerCall: catchCalls,
        unit: "ns/op",
        batch: 1,
        fn: () => Effect.runSync(vibeLoops.plainLoop(catchCalls)),
        verify: (v) => assert.equal(v, catchCalls % 250_000)
      }
    ]
  })
} finally {
  rmSync(work, { recursive: true, force: true })
}
