#!/usr/bin/env node
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { runSuite } from "../lib/harness.mjs"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..")
const compiler = process.env.VIBELANG || path.join(root, "packages/compiler/native/vibelang")
const compilerBin = path.join(root, "packages/compiler/bin/vibelang")

if (!existsSync(compiler)) {
  console.error(`typescript-shim.bench.mjs: missing compiler at ${compiler}`)
  process.exit(1)
}

// Stage npm-style node_modules layout so typescript-shim resolves sibling `vibelang`.
const work = mkdtempSync(path.join(os.tmpdir(), "vibelang-shim-bench-"))
try {
  mkdirSync(path.join(work, "node_modules"), { recursive: true })
  symlinkSync(path.join(root, "packages/compiler"), path.join(work, "node_modules/vibelang"), "dir")
  const shimDir = path.join(work, "node_modules/typescript")
  cpSync(path.join(root, "packages/typescript-shim"), shimDir, {
    recursive: true,
    filter: (src) => !src.includes(`${path.sep}test`) && !src.includes(`${path.sep}node_modules`)
  })
  const shimBin = path.join(shimDir, "bin/tsc")
  const env = { ...process.env, VIBELANG_BINARY: compiler }

  await runSuite({
    suite: "cli-startup",
    category: "packages",
    description: "Process startup latency of native compiler binary, JS vibelang bin wrapper, and typescript-shim launcher.",
    cases: [
      {
        name: "native vibelang --version",
        samples: 9,
        warmup: 2,
        batch: 1,
        fn: () => {
          const r = spawnSync(compiler, ["--version"], { encoding: "utf8", env })
          assert.equal(r.status, 0, r.stderr)
          return r.stdout
        },
        verify: (v) => assert.ok(v.trim().length > 0)
      },
      {
        name: "packages/compiler/bin/vibelang --version",
        samples: 7,
        warmup: 2,
        batch: 1,
        fn: () => {
          const r = spawnSync(process.execPath, [compilerBin, "--version"], { encoding: "utf8", env })
          assert.equal(r.status, 0, r.stderr)
          return r.stdout
        },
        verify: (v) => assert.ok(v.trim().length > 0)
      },
      {
        name: "packages/typescript-shim/bin/tsc --version",
        samples: 7,
        warmup: 2,
        batch: 1,
        fn: () => {
          const r = spawnSync(process.execPath, [shimBin, "--version"], { encoding: "utf8", env, cwd: work })
          assert.equal(r.status, 0, r.stderr)
          return r.stdout
        },
        verify: (v) => assert.ok(v.trim().length > 0)
      }
    ]
  })
} finally {
  rmSync(work, { recursive: true, force: true })
}
