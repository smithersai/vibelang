#!/usr/bin/env node
// Incremental end-to-end compiler benchmark: compiles synthetic VibeLang & Effect TS
// projects (chain, dense, single shapes) with the built native compiler, measuring wall
// time, check time, and peak RSS. Emits vibelang-bench/v1 JSON.
import assert from "node:assert/strict"
import { execFileSync, spawnSync } from "node:child_process"
import { existsSync, mkdtempSync, rmSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { performance } from "node:perf_hooks"
import { fileURLToPath } from "node:url"
import { machineInfo, parseBenchArgs, stats, writeResultJson } from "../lib/harness.mjs"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..")
const nativeName = process.platform === "win32" ? "vibelang.exe" : "vibelang"
const compiler = process.env.VIBELANG
  ? path.resolve(process.env.VIBELANG)
  : existsSync(path.join(root, "packages/compiler/native", nativeName))
    ? path.join(root, "packages/compiler/native", nativeName)
    : path.join(root, "typescript/built/local/tsc")

if (!existsSync(compiler)) {
  console.error(`compiler-e2e.bench.mjs: missing compiler at ${compiler}`)
  process.exit(1)
}

const opts = parseBenchArgs(process.argv.slice(2))
const runs = Math.min(opts.samples, 5)
const modules = 40

const work = mkdtempSync(path.join(os.tmpdir(), "vibelang-compiler-bench-"))
try {
  execFileSync("sh", [path.join(root, "scripts/bench/modules.sh"), work], { stdio: "pipe" })

  const startedAt = new Date().toISOString()
  const suiteStart = performance.now()
  const benchmarks = []

  const measureProject = (name, tsconfig) => {
    const wallSamples = []
    const checkSamples = []
    const rssSamples = []
    for (let i = 0; i < runs; i++) {
      rmSync(path.join(path.dirname(tsconfig), "dist"), { recursive: true, force: true })
      const run = spawnSync("python3", [
        path.join(root, "scripts/bench/measure.py"),
        compiler, "-p", tsconfig, "--extendedDiagnostics", "--pretty", "false"
      ], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 })
      const out = (run.stdout ?? "") + (run.stderr ?? "")
      const m = /^MEASURE wall_s=([0-9.]+) rss_mb=([0-9.]+) exit=(-?\d+)/m.exec(out)
      assert.ok(m, `${name}: missing MEASURE output:\n${out}`)
      assert.equal(Number(m[3]), 0, `${name}: compiler exited ${m[3]}:\n${out}`)
      wallSamples.push(Number(m[1]) * 1000)
      rssSamples.push(Number(m[2]))
      const checkMatch = /^Check time:\s*([0-9.]+)s/m.exec(out)
      if (checkMatch) checkSamples.push(Number(checkMatch[1]) * 1000)
    }
    const wall = stats(wallSamples)
    const check = checkSamples.length ? stats(checkSamples) : null
    const peakRssMiB = Math.max(...rssSamples)
    benchmarks.push({
      name,
      unit: "ms/op",
      value: Number(wall.median.toFixed(2)),
      min: Number(wall.min.toFixed(2)),
      median: Number(wall.median.toFixed(2)),
      mean: Number(wall.mean.toFixed(2)),
      p95: Number(wall.p95.toFixed(2)),
      max: Number(wall.max.toFixed(2)),
      nsPerOp: wall.median * 1e6,
      samples: wall.samples.map((v) => Number(v.toFixed(2))),
      extra: {
        ...(check ? { checkMedianMs: Number(check.median.toFixed(2)) } : {}),
        peakRssMiB: Number(peakRssMiB.toFixed(1))
      }
    })
  }

  for (const shape of ["chain", "dense", "single"]) {
    const dir = path.join(work, `synth-${shape}`)
    execFileSync(process.execPath, [path.join(root, "scripts/bench/gen-synthetic.mjs"), dir, String(modules), shape], { stdio: "pipe" })
    measureProject(`synthetic ${modules}mod (${shape}) VibeLang`, path.join(dir, "vibelang/tsconfig.json"))
    measureProject(`synthetic ${modules}mod (${shape}) Effect TS`, path.join(dir, "effect-ts/tsconfig.json"))
  }

  const durationMs = performance.now() - suiteStart
  const versionOut = execFileSync(compiler, ["--version"], { encoding: "utf8" }).trim()
  const payload = {
    schemaVersion: 1,
    suite: "compiler-e2e",
    category: "compiler-e2e",
    description: `End-to-end native compiler check+emit wall time (${modules} modules x chain/dense/single, VibeLang vs Effect TS).`,
    startedAt,
    durationMs: Number(durationMs.toFixed(2)),
    machine: machineInfo(),
    meta: { compilerVersion: versionOut, modules, runs },
    benchmarks
  }

  console.log(`\n[compiler-e2e] compiler-e2e (${versionOut}, ${durationMs.toFixed(0)} ms)`)
  for (const b of benchmarks) {
    const check = b.extra?.checkMedianMs !== undefined ? `  check ${b.extra.checkMedianMs.toFixed(0)} ms` : ""
    console.log(`  ${b.name.padEnd(48)} ${b.value.toFixed(1).padStart(10)} ms/op  (min ${b.min.toFixed(1)}, rss ${b.extra?.peakRssMiB} MiB${check})`)
  }
  if (opts.out) writeResultJson(opts.out, payload)
} finally {
  rmSync(work, { recursive: true, force: true })
}
