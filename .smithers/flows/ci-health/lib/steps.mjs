// The ci-health flow's analysis. It reads the graph results and logs CI wrote
// (<id>-graph.json, from CI_RESULTS, beside <id>-graph.log) and says which
// targets are slow, which are flaky, and which tests and causes are behind them.
//
// A flake here is a target whose key, the hash of its declared inputs, both
// passed and failed: a code change cannot explain that, because the code did
// not change. Load, a timing budget or an undeclared input can.
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync, mkdirSync } from "node:fs"
import path from "node:path"

export const STEPS = ["collect", "analyze", "report"]

export const paths = (run) => Object.fromEntries([["options", path.join(run, "options.json")], ...STEPS.map((s) => [s, path.join(run, `${s}.json`)])])

const read = (file) => JSON.parse(readFileSync(file, "utf8"))
const save = (file, value) => {
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify(value, null, 2) + "\n")
  return value
}
const once = (run, step, work) => {
  const file = paths(run)[step]
  return existsSync(file) ? read(file) : save(file, work(read(paths(run).options)))
}

// A results file: { results: [{ label, status, key, durationMs }] }.
// A target that replayed from the cache did not run, so its time means nothing.
export function parseRun(id, text, at) {
  let results
  try {
    results = JSON.parse(text).results
  } catch {
    return null // a run cut off while writing
  }
  if (!Array.isArray(results)) return null
  return { id, at, targets: results.filter((r) => r.key).map((r) => ({ label: r.label, status: r.status, key: r.key, ms: r.durationMs ?? 0 })) }
}

// collect reads every results file at the top of dir, oldest first.
export const collect = (run) => once(run, "collect", ({ results, since }) => {
  const runs = []
  let unreadable = 0
  for (const name of readdirSync(results).filter((n) => n.endsWith("-graph.json")).sort()) {
    const file = path.join(results, name)
    const at = statSync(file).mtime.toISOString()
    if (since && at < since) continue
    const parsed = parseRun(name.slice(0, -"-graph.json".length), readFileSync(file, "utf8"), at)
    if (parsed) runs.push(parsed)
    else unreadable++
  }
  runs.sort((a, b) => a.at.localeCompare(b.at))
  return { ok: runs.length > 0, runs, unreadable, summary: `${runs.length} runs, ${unreadable} unreadable` }
})

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b)
  return s.length ? s[Math.floor(s.length / 2)] : 0
}
const percentile = (xs, p) => {
  const s = [...xs].sort((a, b) => a - b)
  return s.length ? s[Math.min(s.length - 1, Math.floor(s.length * p))] : 0
}

// slow ranks targets by the time they cost: how often they ran, and for how long.
export function slow(runs) {
  const by = new Map()
  for (const r of runs) {
    for (const t of r.targets) {
      if (t.status !== "ran" && t.status !== "failed") continue
      by.set(t.label, [...(by.get(t.label) ?? []), t.ms])
    }
  }
  return [...by].map(([label, ms]) => ({
    label,
    runs: ms.length,
    medianS: Math.round(median(ms) / 1000),
    p90S: Math.round(percentile(ms, 0.9) / 1000),
    totalS: Math.round(ms.reduce((a, b) => a + b, 0) / 1000)
  })).sort((a, b) => b.totalS - a.totalS)
}

// flakes lists every (target, key) that both passed and failed, with the runs
// that failed: the same inputs gave two answers.
export function flakes(runs) {
  const by = new Map()
  for (const r of runs) {
    for (const t of r.targets) {
      const id = `${t.label} ${t.key}`
      const f = by.get(id) ?? { label: t.label, key: t.key, passed: 0, failed: [] }
      if (t.status === "failed") {
        f.failed.push(r.id)
        f.last = r.at
      }
      else if (t.status === "ran" || t.status === "hit") f.passed++
      by.set(id, f)
    }
  }
  return [...by.values()].filter((f) => f.passed > 0 && f.failed.length > 0)
}

// failedTests names what failed in one target's output lines, across the
// runners the graph uses: bun, node --test and go test.
export function failedTests(lines) {
  const out = new Set()
  for (const line of lines) {
    const m = /^\s*\(fail\) (.+?)(?: \[[\d.]+m?s\])?$/.exec(line)
      ?? /^\s*✖ (?!failing tests)(.+?)(?: \([\d.]+m?s\))?$/.exec(line)
      ?? /^\s*--- FAIL: (\S+)/.exec(line)
    if (m) out.add(m[1])
  }
  return [...out]
}

// CAUSES classifies a failure from its output; the first match wins, so the
// causes a code change cannot explain come first. A property test draws a new
// seed each run, so its key can pass and fail with no flakiness: what it found
// is a bug, and the log prints the replay.
export const CAUSES = [
  ["property counterexample", /property \S+ failed; saved/],
  ["disk full", /ENOSPC|no space left on device/i],
  ["killed", /signal: killed|SIGKILL|out of memory|exit code 137/i],
  ["timeout", /timed? ?out|exceeded (?:the )?time|timeout of \d+|deadline exceeded|\bwithin \d+ ?m?s\b/i],
  ["connection", /ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|socket hang up|rate.?limit/i],
  ["missing file", /ENOENT|Cannot find module|no such file or directory|missing output/i],
  ["assertion", /AssertionError|expected|--- FAIL|\(fail\)|✖/i]
]

export const cause = (lines) => CAUSES.find(([, pattern]) => lines.some((l) => pattern.test(l)))?.[0] ?? "unknown"

// targetLines returns one target's output from a graph log. Live lines start
// with "<label>: " up to a limit; the line "<label>  failed  ..." is followed
// by the target's whole captured output, without the prefix.
export function targetLines(log, label) {
  const prefix = `${label}: `, failed = `${label}  failed`
  const out = []
  let captured = false
  for (const line of log.split("\n")) {
    if (line.startsWith("//")) {
      captured = line.startsWith(failed)
      if (line.startsWith(prefix)) out.push(line.slice(prefix.length))
    } else if (captured) out.push(line)
  }
  return out
}

// analyze attributes each flaky target to its tests and causes through the
// logs of the runs where it failed.
export const analyze = (run) => once(run, "analyze", ({ results }) => {
  const { runs } = read(paths(run).collect)
  const logs = new Map()
  const log = (id) => {
    if (!logs.has(id)) {
      const file = path.join(results, `${id}-graph.log`)
      logs.set(id, existsSync(file) ? readFileSync(file, "utf8") : "")
    }
    return logs.get(id)
  }
  const at = new Map(runs.map((r) => [r.id, r.at]))
  const found = flakes(runs)
  const targets = new Map()
  for (const f of found) {
    const t = targets.get(f.label) ?? { label: f.label, keys: 0, failures: 0, passes: 0, last: "", causes: {}, tests: {} }
    t.keys++
    t.passes += f.passed
    if (f.last > t.last) t.last = f.last
    for (const id of f.failed) {
      t.failures++
      const lines = targetLines(log(id), f.label)
      const c = cause(lines)
      t.causes[c] = (t.causes[c] ?? 0) + 1
      for (const name of failedTests(lines)) {
        const test = t.tests[name] ?? { failures: 0, last: "" }
        test.failures++
        if (at.get(id) > test.last) test.last = at.get(id)
        t.tests[name] = test
      }
    }
    targets.set(f.label, t)
  }
  const ranked = [...targets.values()].sort((a, b) => b.failures - a.failures).map((t) => ({
    ...t,
    tests: Object.entries(t.tests).map(([name, test]) => ({ name, ...test })).sort((a, b) => b.failures - a.failures)
  }))
  return { ok: true, runs: runs.length, flaky: ranked, slow: slow(runs), summary: `${ranked.length} flaky targets over ${runs.length} runs` }
})

// ACTIONS says what a cause usually needs; the report quotes it per target.
export const ACTIONS = {
  "property counterexample": "Not a flake: replay the seed the log prints and fix the bug it found",
  "disk full": "Free the host; no code change",
  killed: "Reduce the target's memory, or run it alone on a smaller slot",
  timeout: "Find what the test waits for; a timeout that scales with load, or less work, beats a larger number",
  connection: "Replace the network dependency with a local fixture",
  "missing file": "Declare the input or output the target reads: its key ignored it",
  assertion: "Read the test: it depends on timing, order or an input its key ignores",
  unknown: "Read the log"
}

const cell = (s) => String(s).replaceAll("|", "\\|")
const day = (iso) => iso.slice(0, 16).replace("T", " ")

// report writes report.md and the ranking a follow-up reads.
export const report = (run) => once(run, "report", () => {
  const a = read(paths(run).analyze)
  const lines = [`# CI health: ${a.runs} runs`, ""]
  lines.push("## Flaky targets", "", "The same key, so the same declared inputs, both passed and failed.", "")
  lines.push("| Target | Keys | Failures | Passes | Last failed | Causes | Next step |", "| --- | --- | --- | --- | --- | --- | --- |")
  for (const t of a.flaky) {
    const top = Object.entries(t.causes).sort((x, y) => y[1] - x[1])
    lines.push(`| \`${t.label}\` | ${t.keys} | ${t.failures} | ${t.passes} | ${day(t.last)} | ${top.map(([c, n]) => `${c} ${n}`).join(", ")} | ${ACTIONS[top[0][0]]} |`)
  }
  lines.push("", "## Flaky tests", "", "A test that stopped failing was probably fixed: check the last failure before fixing it again.", "", "| Target | Test | Failures | Last failed |", "| --- | --- | --- | --- |")
  const tests = a.flaky.flatMap((t) => t.tests.map((x) => ({ label: t.label, ...x }))).sort((x, y) => y.failures - x.failures).slice(0, 30)
  for (const t of tests) lines.push(`| \`${t.label}\` | ${cell(t.name)} | ${t.failures} | ${day(t.last)} |`)
  lines.push("", "## Slow targets", "", "| Target | Runs | Median | p90 | Total |", "| --- | --- | --- | --- | --- |")
  for (const t of a.slow.slice(0, 15)) lines.push(`| \`${t.label}\` | ${t.runs} | ${t.medianS} s | ${t.p90S} s | ${t.totalS} s |`)
  writeFileSync(path.join(run, "report.md"), lines.join("\n") + "\n")
  return { ok: true, flaky: a.flaky.map((t) => t.label), tests: tests.map((t) => t.name), slow: a.slow.slice(0, 5).map((t) => t.label), summary: `report.md: ${a.flaky.length} flaky targets, ${tests.length} tests` }
})

export const run = { collect, analyze, report }

export const start = (runDir, options) => (existsSync(paths(runDir).options) ? read(paths(runDir).options) : save(paths(runDir).options, options))
