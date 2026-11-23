#!/usr/bin/env node
// Runs `go test -bench -benchmem -trimpath` for one Go package selector,
// parses ns/op, B/op, allocs/op and MB/s across -count trials, computes medians,
// and emits canonical vibelang-bench/v1 JSON.
import { spawnSync } from "node:child_process"
import os from "node:os"
import path from "node:path"
import { performance } from "node:perf_hooks"
import { fileURLToPath } from "node:url"
import { stats, writeResultJson } from "./harness.mjs"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..")
const tscDir = path.join(root, "typescript/tsc")

function parseArgs(argv) {
  const opts = {
    suite: "",
    category: "go-compiler",
    description: "",
    pkg: "",
    bench: ".",
    benchtime: "200ms",
    count: 5,
    timeout: "10m",
    out: ""
  }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    const next = argv[i + 1]
    if (arg === "--suite" && next) { opts.suite = argv[++i]; continue }
    if (arg === "--category" && next) { opts.category = argv[++i]; continue }
    if (arg === "--description" && next) { opts.description = argv[++i]; continue }
    if (arg === "--pkg" && next) { opts.pkg = argv[++i]; continue }
    if (arg === "--bench" && next) { opts.bench = argv[++i]; continue }
    if (arg === "--benchtime" && next) { opts.benchtime = argv[++i]; continue }
    if (arg === "--count" && next) { opts.count = Number(argv[++i]); continue }
    if (arg === "--timeout" && next) { opts.timeout = argv[++i]; continue }
    if (arg === "--out" && next) { opts.out = path.resolve(argv[++i]); continue }
    throw new Error(`go-bench-runner: unknown or incomplete option ${arg}`)
  }
  if (!opts.suite || !opts.pkg) {
    throw new Error("usage: go-bench-runner.mjs --suite NAME --pkg ./internal/... [--bench REGEX] [--benchtime 200ms] [--count 5] [--out FILE]")
  }
  return opts
}

function parseGoBenchOutput(stdout) {
  // Format: BenchmarkName-16   10000   12345 ns/op   123.45 MB/s   4096 B/op   12 allocs/op
  const byName = new Map()
  for (const line of stdout.split(/\r?\n/)) {
    const match = /^(Benchmark\S+?)(?:-\d+)?\s+(\d+)\s+(.+)$/.exec(line)
    if (!match) continue
    const [, rawName, iterStr, rest] = match
    const name = rawName.replace(/^Benchmark/, "")
    const fields = rest.trim().split(/\s+/)
    let nsPerOp, bytesPerOp, allocsPerOp, mbPerSec
    for (let i = 0; i + 1 < fields.length; i += 2) {
      const value = Number(fields[i])
      const unit = fields[i + 1]
      if (!Number.isFinite(value)) continue
      if (unit === "ns/op") nsPerOp = value
      else if (unit === "B/op") bytesPerOp = value
      else if (unit === "allocs/op") allocsPerOp = value
      else if (unit === "MB/s") mbPerSec = value
    }
    if (nsPerOp === undefined) continue
    if (!byName.has(name)) {
      byName.set(name, { ns: [], bytes: [], allocs: [], mbps: [], iterations: Number(iterStr) })
    }
    const entry = byName.get(name)
    entry.ns.push(nsPerOp)
    if (bytesPerOp !== undefined) entry.bytes.push(bytesPerOp)
    if (allocsPerOp !== undefined) entry.allocs.push(allocsPerOp)
    if (mbPerSec !== undefined) entry.mbps.push(mbPerSec)
  }
  return byName
}

function chooseUnit(medianNs) {
  if (medianNs < 1_000) return { unit: "ns/op", scale: 1 }
  if (medianNs < 1_000_000) return { unit: "us/op", scale: 1e-3 }
  return { unit: "ms/op", scale: 1e-6 }
}

const opts = parseArgs(process.argv.slice(2))
const goCache = process.env.GOCACHE || path.join(os.homedir(), ".cache/go-build-smthrs")
const env = {
  ...process.env,
  GOCACHE: goCache,
  CGO_ENABLED: "0",
  EFFECT_NODE_MODULES: process.env.EFFECT_NODE_MODULES || path.join(root, "experiments/node_modules")
}

const goVer = spawnSync("go", ["version"], { encoding: "utf8", env })
const runtime = goVer.status === 0 ? goVer.stdout.trim() : "go"

const startedAt = new Date().toISOString()
const t0 = performance.now()
const args = [
  "test",
  "-trimpath",
  "-p", "8",
  "-run", "^$",
  "-bench", opts.bench,
  "-benchmem",
  "-benchtime", opts.benchtime,
  "-count", String(opts.count),
  "-timeout", opts.timeout,
  opts.pkg
]
const run = spawnSync("go", args, { cwd: tscDir, encoding: "utf8", env, maxBuffer: 64 * 1024 * 1024 })
const durationMs = performance.now() - t0

if (run.error) {
  console.error(`go-bench-runner: failed to spawn go: ${run.error.message}`)
  process.exit(1)
}
if (run.status !== 0) {
  console.error(run.stdout)
  console.error(run.stderr)
  console.error(`go-bench-runner: go ${args.join(" ")} exited with ${run.status}`)
  process.exit(run.status ?? 1)
}

const parsed = parseGoBenchOutput(run.stdout)
if (parsed.size === 0) {
  console.error(run.stdout)
  console.error(`go-bench-runner: zero benchmarks matched ${opts.bench} in ${opts.pkg}`)
  process.exit(1)
}

const benchmarks = []
for (const [name, entry] of parsed) {
  const nsStats = stats(entry.ns)
  const { unit, scale } = chooseUnit(nsStats.median)
  const bytesPerOp = entry.bytes.length > 0 ? stats(entry.bytes).median : undefined
  const allocsPerOp = entry.allocs.length > 0 ? stats(entry.allocs).median : undefined
  const mbPerSec = entry.mbps.length > 0 ? stats(entry.mbps).median : undefined
  benchmarks.push({
    name,
    unit,
    value: nsStats.median * scale,
    min: nsStats.min * scale,
    median: nsStats.median * scale,
    mean: nsStats.mean * scale,
    p95: nsStats.p95 * scale,
    max: nsStats.max * scale,
    nsPerOp: nsStats.median,
    opsPerSec: nsStats.median > 0 ? 1e9 / nsStats.median : 0,
    ...(bytesPerOp !== undefined ? { bytesPerOp: Math.round(bytesPerOp) } : {}),
    ...(allocsPerOp !== undefined ? { allocsPerOp: Math.round(allocsPerOp) } : {}),
    ...(mbPerSec !== undefined ? { mbPerSec: Number(mbPerSec.toFixed(2)) } : {}),
    samples: nsStats.samples.map((v) => Number((v * scale).toPrecision(6)))
  })
}

const cpus = os.cpus()
const payload = {
  schemaVersion: 1,
  suite: opts.suite,
  category: opts.category,
  description: opts.description || `Go benchmarks for ${opts.pkg}`,
  startedAt,
  durationMs: Number(durationMs.toFixed(2)),
  machine: {
    platform: process.platform,
    arch: process.arch,
    release: os.release(),
    cpu: cpus[0]?.model ?? "unknown",
    cores: os.availableParallelism ? os.availableParallelism() : cpus.length,
    runtime
  },
  meta: { pkg: opts.pkg, bench: opts.bench, benchtime: opts.benchtime, count: opts.count },
  benchmarks
}

console.log(`\n[${opts.category}] ${opts.suite} (${runtime}, ${durationMs.toFixed(0)} ms)`)
for (const b of benchmarks) {
  const val = b.value < 10 ? b.value.toFixed(2) : b.value < 1000 ? b.value.toFixed(1) : b.value.toFixed(0)
  const mem = b.bytesPerOp !== undefined ? `  ${String(b.bytesPerOp).padStart(8)} B/op  ${String(b.allocsPerOp ?? 0).padStart(5)} allocs/op` : ""
  const mb = b.mbPerSec !== undefined ? `  ${b.mbPerSec.toFixed(1)} MB/s` : ""
  console.log(`  ${b.name.padEnd(48)} ${val.padStart(10)} ${b.unit.padEnd(6)}${mem}${mb}`)
}

if (opts.out) {
  writeResultJson(opts.out, payload)
}
