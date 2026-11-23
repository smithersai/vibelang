// Unified microbenchmark harness for VibeLang Node/Bun benchmarks.
// Emits vibelang-bench/v1 JSON to --out (when supplied) and a compact table to stdout.
import { mkdirSync, renameSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { performance } from "node:perf_hooks"

export function parseBenchArgs(argv = process.argv.slice(2)) {
  const opts = {
    out: "",
    samples: 11,
    warmup: 3,
    minSampleMs: 25,
    filter: ""
  }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === "--out" && argv[i + 1]) { opts.out = path.resolve(argv[++i]); continue }
    if (arg === "--samples" && argv[i + 1]) { opts.samples = Number(argv[++i]); continue }
    if (arg === "--warmup" && argv[i + 1]) { opts.warmup = Number(argv[++i]); continue }
    if (arg === "--min-ms" && argv[i + 1]) { opts.minSampleMs = Number(argv[++i]); continue }
    if (arg === "--filter" && argv[i + 1]) { opts.filter = argv[++i]; continue }
    throw new Error(`bench harness: unknown or incomplete option ${arg}`)
  }
  if (!Number.isSafeInteger(opts.samples) || opts.samples < 1) {
    throw new Error(`bench harness: --samples must be a positive integer (got ${opts.samples})`)
  }
  if (!Number.isSafeInteger(opts.warmup) || opts.warmup < 0) {
    throw new Error(`bench harness: --warmup must be a non-negative integer (got ${opts.warmup})`)
  }
  if (!Number.isFinite(opts.minSampleMs) || opts.minSampleMs <= 0) {
    throw new Error(`bench harness: --min-ms must be positive (got ${opts.minSampleMs})`)
  }
  return opts
}

export function percentile(sorted, p) {
  if (sorted.length === 0) return 0
  if (sorted.length === 1) return sorted[0]
  const index = (sorted.length - 1) * p
  const lo = Math.floor(index)
  const hi = Math.ceil(index)
  return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (index - lo)
}

export function stats(rawSamples) {
  const sorted = [...rawSamples].sort((a, b) => a - b)
  const sum = sorted.reduce((acc, v) => acc + v, 0)
  return {
    min: sorted[0],
    median: percentile(sorted, 0.5),
    mean: sum / sorted.length,
    p95: percentile(sorted, 0.95),
    max: sorted[sorted.length - 1],
    samples: rawSamples
  }
}

export function machineInfo() {
  const cpus = os.cpus()
  const runtime = typeof Bun !== "undefined" ? `bun ${Bun.version}` : `node ${process.version}`
  return {
    platform: process.platform,
    arch: process.arch,
    release: os.release(),
    cpu: cpus[0]?.model ?? "unknown",
    cores: os.availableParallelism ? os.availableParallelism() : cpus.length,
    runtime
  }
}

export function writeResultJson(outPath, payload) {
  const dir = path.dirname(outPath)
  mkdirSync(dir, { recursive: true })
  const tmp = `${outPath}.tmp.${process.pid}.${Date.now()}`
  writeFileSync(tmp, JSON.stringify(payload, null, 2) + "\n")
  renameSync(tmp, outPath)
}

// Prevent dead-code elimination by keeping a live sink value.
let sinkValue = 0
export function sink(value) {
  sinkValue = (sinkValue + (typeof value === "number" ? value : value ? 1 : 0)) | 0
  return sinkValue
}

function chooseUnit(medianNs) {
  if (medianNs < 1_000) return { unit: "ns/op", scale: 1 }
  if (medianNs < 1_000_000) return { unit: "us/op", scale: 1e-3 }
  return { unit: "ms/op", scale: 1e-6 }
}

async function runCase(spec, opts) {
  const warmup = spec.warmup ?? opts.warmup
  const sampleCount = spec.samples ?? opts.samples
  const minSampleMs = spec.minSampleMs ?? opts.minSampleMs
  const fn = spec.fn
  const isAsync = spec.async === true || fn.constructor?.name === "AsyncFunction"

  const ctx = spec.setup ? await spec.setup() : undefined
  try {
    // Correctness witness before timing.
    const first = isAsync ? await fn(ctx, 1) : fn(ctx, 1)
    if (spec.verify) await spec.verify(first, ctx)
    sink(first)

    let batch = spec.batch ?? spec.iterations ?? 0
    if (batch <= 0) {
      // Auto-calibrate inner loop count so each sample lasts >= minSampleMs.
      batch = 1
      for (;;) {
        const t0 = performance.now()
        if (isAsync) {
          for (let i = 0; i < batch; i++) sink(await fn(ctx, i))
        } else {
          let acc = 0
          for (let i = 0; i < batch; i++) acc += fn(ctx, i) ? 1 : 0
          sink(acc)
        }
        const elapsed = performance.now() - t0
        if (elapsed >= minSampleMs || batch >= 2_000_000) {
          if (elapsed > 0 && elapsed < minSampleMs && batch < 2_000_000) {
            batch = Math.min(2_000_000, Math.max(batch * 2, Math.ceil((batch * minSampleMs) / elapsed)))
          }
          break
        }
        batch = elapsed < 0.5 ? batch * 8 : Math.max(batch * 2, Math.ceil((batch * minSampleMs) / Math.max(elapsed, 0.1)))
        if (batch > 2_000_000) batch = 2_000_000
      }
    }

    const innerOps = spec.opsPerCall ?? 1
    const totalOpsPerSample = batch * innerOps

    for (let w = 0; w < warmup; w++) {
      if (isAsync) {
        for (let i = 0; i < batch; i++) sink(await fn(ctx, i))
      } else {
        let acc = 0
        for (let i = 0; i < batch; i++) acc += fn(ctx, i) ? 1 : 0
        sink(acc)
      }
    }

    const nsPerOpSamples = []
    for (let s = 0; s < sampleCount; s++) {
      const t0 = performance.now()
      if (isAsync) {
        for (let i = 0; i < batch; i++) sink(await fn(ctx, i))
      } else {
        let acc = 0
        for (let i = 0; i < batch; i++) acc += fn(ctx, i) ? 1 : 0
        sink(acc)
      }
      const elapsedMs = performance.now() - t0
      nsPerOpSamples.push((elapsedMs * 1e6) / totalOpsPerSample)
    }

    const raw = stats(nsPerOpSamples)
    const { unit, scale } = spec.unit === "ms/op"
      ? { unit: "ms/op", scale: 1e-6 }
      : spec.unit === "us/op"
        ? { unit: "us/op", scale: 1e-3 }
        : spec.unit === "ns/op"
          ? { unit: "ns/op", scale: 1 }
          : chooseUnit(raw.median)

    return {
      name: spec.name,
      unit,
      value: raw.median * scale,
      min: raw.min * scale,
      median: raw.median * scale,
      mean: raw.mean * scale,
      p95: raw.p95 * scale,
      max: raw.max * scale,
      nsPerOp: raw.median,
      opsPerSec: raw.median > 0 ? 1e9 / raw.median : 0,
      batch,
      opsPerSample: totalOpsPerSample,
      samples: raw.samples.map((v) => Number((v * scale).toPrecision(6))),
      ...(spec.extra ? { extra: spec.extra } : {})
    }
  } finally {
    if (spec.teardown) await spec.teardown(ctx)
  }
}

export async function runSuite({ suite, category, description = "", cases, meta = {}, argv = process.argv.slice(2) }) {
  const opts = parseBenchArgs(argv)
  const filterRe = opts.filter ? new RegExp(opts.filter) : null
  const selected = filterRe ? cases.filter((c) => filterRe.test(c.name)) : cases
  if (selected.length === 0) {
    throw new Error(`bench suite ${suite}: no benchmark cases matched filter ${opts.filter}`)
  }

  const startedAt = new Date().toISOString()
  const t0 = performance.now()
  const benchmarks = []
  for (const spec of selected) {
    const result = await runCase(spec, opts)
    benchmarks.push(result)
  }
  const durationMs = performance.now() - t0

  const payload = {
    schemaVersion: 1,
    suite,
    category,
    description,
    startedAt,
    durationMs: Number(durationMs.toFixed(2)),
    machine: machineInfo(),
    meta,
    benchmarks
  }

  console.log(`\n[${category}] ${suite} (${payload.machine.runtime}, ${durationMs.toFixed(0)} ms)`)
  for (const b of benchmarks) {
    const val = b.value < 10 ? b.value.toFixed(2) : b.value < 1000 ? b.value.toFixed(1) : b.value.toFixed(0)
    const min = b.min < 10 ? b.min.toFixed(2) : b.min.toFixed(1)
    const p95 = b.p95 < 10 ? b.p95.toFixed(2) : b.p95.toFixed(1)
    console.log(`  ${b.name.padEnd(48)} ${val.padStart(10)} ${b.unit.padEnd(6)}  (min ${min}, p95 ${p95})`)
  }

  if (opts.out) {
    writeResultJson(opts.out, payload)
  }
  return payload
}
