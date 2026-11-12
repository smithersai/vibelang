// Builds the benchmark with the VibeLang compiler, then times every loop in
// its own Node process and writes the results as JSON.
//
//   node run.mjs [--trials 10] [--warmup 2] [--cpu N] [--commit ID] [--out results.json] [--no-build]
//
// The compiler is `node_modules/.bin/vibelang`, or the binary named by the
// VIBELANG environment variable. `--cpu N` runs each loop under `taskset -c N`.
// `--commit ID` records the source commit a compiler built from a checkout
// came from.
import { execFileSync, spawnSync } from "node:child_process"
import { readFileSync, writeFileSync } from "node:fs"
import os from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { expected, loops, tableHeader, tableRows } from "./loops.mjs"

const here = dirname(fileURLToPath(import.meta.url))
const args = process.argv.slice(2)
const option = (name, fallback) => {
  const at = args.indexOf(name)
  return at === -1 ? fallback : args[at + 1]
}

if (args[0] === "--child") {
  await child(args[1], Number(option("--warmup", "2")), Number(option("--trials", "10")))
} else {
  main()
}

// Runs one loop: a correctness check, the warm-up runs, then the timed trials.
// It prints one JSON line with the trial times in milliseconds.
async function child(id, warmup, trials) {
  const { Effect } = await import("effect")
  const loop = loops.find((candidate) => candidate.id === id)
  const run = (await import(pathToFileURL(join(here, "dist", loop.module)).href))[loop.exportName]
  for (const count of [1_000, 250_001, loop.calls]) {
    if (count > 250_000 && loop.calls < 250_000) continue
    const value = Effect.runSync(run(count))
    if (value !== expected(loop, count)) throw new Error(`${id}(${count}) returned ${value}, expected ${expected(loop, count)}`)
  }
  for (let i = 0; i < warmup; i++) Effect.runSync(run(loop.calls))
  const trialsMs = []
  for (let i = 0; i < trials; i++) {
    const start = performance.now()
    Effect.runSync(run(loop.calls))
    trialsMs.push(performance.now() - start)
  }
  console.log(JSON.stringify({ id, node: process.version, trialsMs }))
}

function main() {
  const trials = Number(option("--trials", "10"))
  const warmup = Number(option("--warmup", "2"))
  const cpu = option("--cpu", undefined)
  const out = resolve(here, option("--out", "results.json"))
  const compiler = process.env.VIBELANG ?? join(here, "node_modules", ".bin", "vibelang")
  const compilerVersion = execFileSync(compiler, ["--version"], { encoding: "utf8" }).trim()
  if (!args.includes("--no-build")) execFileSync(compiler, ["-p", here, "--pretty", "false"], { stdio: "inherit" })
  const packageVersion = (name) =>
    JSON.parse(readFileSync(join(here, "node_modules", name, "package.json"), "utf8")).version

  const loadStart = os.loadavg()
  const measured = []
  for (const loop of loops) {
    const command = [process.execPath, join(here, "run.mjs"), "--child", loop.id, "--warmup", String(warmup), "--trials", String(trials)]
    const [file, ...rest] = cpu === undefined ? command : ["taskset", "-c", cpu, ...command]
    const result = spawnSync(file, rest, { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] })
    if (result.status !== 0) throw new Error(`${loop.id} exited with ${result.status ?? result.signal}`)
    const { trialsMs } = JSON.parse(result.stdout.trim().split("\n").at(-1))
    const sorted = [...trialsMs].sort((a, b) => a - b)
    const median = sorted.length % 2 ? sorted[(sorted.length - 1) / 2] : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
    const round = (value) => Math.round(value * 1000) / 1000
    measured.push({
      id: loop.id,
      label: loop.label,
      calls: loop.calls,
      trialsMs: trialsMs.map(round),
      minMs: round(sorted[0]),
      medianMs: round(median),
      maxMs: round(sorted.at(-1)),
      medianNsPerCall: round((median * 1e6) / loop.calls),
    })
    console.error(`${loop.id}: ${trialsMs.map((value) => value.toFixed(1)).join(", ")} ms`)
  }

  const results = {
    method: {
      timer: "performance.now() around Effect.runSync, one Node process per loop",
      warmupRuns: warmup,
      trials,
      pinnedCpu: cpu === undefined ? null : Number(cpu),
    },
    machine: {
      os: `${os.type()} ${os.release()}`,
      arch: process.arch,
      cpuModel: os.cpus()[0]?.model ?? "unknown",
      logicalCpus: os.cpus().length,
      loadAverageStart: loadStart.map((value) => Math.round(value * 100) / 100),
      loadAverageEnd: os.loadavg().map((value) => Math.round(value * 100) / 100),
    },
    versions: {
      node: process.version,
      compiler: compilerVersion,
      compilerCommit: option("--commit", null),
      effect: packageVersion("effect"),
      vibelangRuntime: packageVersion("vibelang-runtime"),
    },
    loops: measured,
  }
  writeFileSync(out, JSON.stringify(results, null, 2) + "\n")
  console.log([...tableHeader, ...tableRows(results)].join("\n"))
}
