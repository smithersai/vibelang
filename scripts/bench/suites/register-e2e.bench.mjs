#!/usr/bin/env node
// Incremental vibelang/register cold vs warm startup benchmark (4 packages x 6 modules).
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { existsSync } from "node:fs"
import path from "node:path"
import { performance } from "node:perf_hooks"
import { fileURLToPath } from "node:url"
import { machineInfo, parseBenchArgs, writeResultJson } from "../lib/harness.mjs"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..")
const compiler = process.env.VIBELANG || path.join(root, "packages/compiler/native/vibelang")
if (!existsSync(compiler)) {
  console.error(`register-e2e.bench.mjs: missing compiler at ${compiler}`)
  process.exit(1)
}

const opts = parseBenchArgs(process.argv.slice(2))
const packages = 4
const modules = 6
const runs = 3

const startedAt = new Date().toISOString()
const t0 = performance.now()
const res = spawnSync(process.execPath, [
  path.join(root, "scripts/bench/register.mjs"),
  "--packages", String(packages),
  "--modules", String(modules),
  "--runs", String(runs),
  "--budget", "10"
], {
  cwd: root,
  encoding: "utf8",
  env: { ...process.env, VIBELANG: compiler },
  maxBuffer: 32 * 1024 * 1024
})
const durationMs = performance.now() - t0
if (res.status !== 0) {
  console.error(res.stdout)
  console.error(res.stderr)
  process.exit(res.status ?? 1)
}

// Parse: "start 0.45 s, check 0.85 s, cold 3.20 s, warm 0.25 s" and "ratio 2.41 (budget 10)"
const timings = /start ([0-9.]+) s, check ([0-9.]+) s, cold ([0-9.]+) s, warm ([0-9.]+) s/.exec(res.stdout)
const ratioMatch = /ratio ([0-9.]+)/.exec(res.stdout)
assert.ok(timings && ratioMatch, `unexpected register.mjs output:\n${res.stdout}`)

const toMetric = (name, value, unit) => ({
  name,
  unit,
  value: Number(value.toFixed(2)),
  min: Number(value.toFixed(2)),
  median: Number(value.toFixed(2)),
  mean: Number(value.toFixed(2)),
  p95: Number(value.toFixed(2)),
  max: Number(value.toFixed(2)),
  ...(unit === "ms/op" ? { nsPerOp: value * 1e6 } : {}),
  samples: [Number(value.toFixed(2))]
})

const benchmarks = [
  toMetric(`register cold (${packages}pkg x ${modules}mod)`, Number(timings[3]) * 1000, "ms/op"),
  toMetric(`register warm (${packages}pkg x ${modules}mod)`, Number(timings[4]) * 1000, "ms/op"),
  toMetric(`single-program check (${packages}pkg x ${modules}mod)`, Number(timings[2]) * 1000, "ms/op"),
  toMetric(`cold/check overhead ratio`, Number(ratioMatch[1]), "ratio")
]

const payload = {
  schemaVersion: 1,
  suite: "register-e2e",
  category: "compiler-e2e",
  description: `vibelang/register cold vs warm startup latency and overhead ratio (${packages} packages x ${modules} modules).`,
  startedAt,
  durationMs: Number(durationMs.toFixed(2)),
  machine: machineInfo(),
  meta: { packages, modules, runs },
  benchmarks
}

console.log(`\n[compiler-e2e] register-e2e (${durationMs.toFixed(0)} ms)`)
for (const b of benchmarks) {
  console.log(`  ${b.name.padEnd(48)} ${b.value.toFixed(2).padStart(10)} ${b.unit}`)
}
if (opts.out) writeResultJson(opts.out, payload)
