// Compare archived harness --report trials. Alerts are informational; malformed
// evidence exits 2. This never changes a hang guard or silently accepts a failed
// case as a performance sample. See docs/maintainers/compiler-case-performance.md.
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const threshold = 1.5
const requireEvidence = (ok, message) => { if (!ok) throw new Error(message) }
const positive = (value, name) => requireEvidence(Number.isFinite(value) && value > 0, name + " must be finite and positive")
const median = values => {
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle] : sorted[middle - 1] / 2 + sorted[middle] / 2
}

function measure(report) {
  requireEvidence(report?.complete === true, "incomplete trial")
  requireEvidence(report.version === 1, "unsupported report version")
  requireEvidence(report.jobs === 1, "timing comparisons require --jobs 1")
  requireEvidence(Array.isArray(report.selected) && report.selected.length > 0 &&
    report.selected.every(name => typeof name === "string" && name.length > 0) &&
    new Set(report.selected).size === report.selected.length, "invalid selection")
  requireEvidence(Array.isArray(report.cases) && report.cases.length === report.selected.length &&
    new Set(report.cases.map(c => c?.name)).size === report.selected.length &&
    report.cases.every(c => report.selected.includes(c?.name)), "case selection does not match report")
  requireEvidence(/^[a-f0-9]{64}$/.test(report.compiler?.sha256 ?? ""), "missing compiler SHA-256")
  requireEvidence(typeof report.startedAt === "string" && Number.isFinite(Date.parse(report.startedAt)), "missing trial start time")
  requireEvidence(typeof report.isolated === "boolean" && typeof report.lateStart === "boolean", "missing environment flags")
  for (const key of ["node", "effectVersion", "runtimeVersion"]) {
    requireEvidence(typeof report[key] === "string" && report[key].length > 0, "missing environment " + key)
  }
  const system = report.system
  requireEvidence(system && ["platform", "arch", "release", "cpu"].every(key =>
    typeof system[key] === "string" && system[key].length > 0), "missing system environment")
  requireEvidence(Number.isSafeInteger(system.availableParallelism) && system.availableParallelism > 0, "invalid parallelism")

  const samples = new Map()
  for (const item of report.cases) {
    requireEvidence(item.status === "ok", item.name + ": non-ok outcome " + item.status)
    positive(item.wallMs, item.name + " wallMs")
    samples.set(JSON.stringify([item.name, null]), item.wallMs)
    requireEvidence(Array.isArray(item.commands) && item.commands.some(c => c?.phase === "compile"), item.name + ": missing compile phase")
    for (const command of item.commands) {
      requireEvidence(typeof command?.phase === "string" && command.phase.length > 0, item.name + ": missing phase")
      requireEvidence(!command.error && !command.errorCode, item.name + ": spawn error")
      requireEvidence(command.timedOut === false, item.name + ": command timeout")
      requireEvidence(command.signal === null, item.name + ": command signal")
      // An expected-error case can legitimately pass with compiler exit 1/2.
      const allowed = command.phase.startsWith("compile") ? [0, 1, 2] : [0]
      requireEvidence(allowed.includes(command.exitCode), item.name + ": invalid command exit")
      positive(command.wallMs, item.name + " " + command.phase + " wallMs")
      const key = JSON.stringify([item.name, command.phase])
      const sum = (samples.get(key) ?? 0) + command.wallMs
      positive(sum, item.name + " phase sum")
      samples.set(key, sum)
    }
  }
  const environment = {
    node: report.node, effectVersion: report.effectVersion, runtimeVersion: report.runtimeVersion,
    jobs: report.jobs, isolated: report.isolated, lateStart: report.lateStart,
    system: Object.fromEntries(["platform", "arch", "release", "cpu", "availableParallelism"].map(key => [key, system[key]])),
  }
  return { samples, environment, phases: [...samples.keys()].sort() }
}

function summarize(reports, label) {
  requireEvidence(Array.isArray(reports) && reports.length >= 3, label + ": at least 3 trials required")
  let first
  const samples = new Map()
  const invocations = new Set()
  const compilerSha256 = reports[0]?.compiler?.sha256
  for (const report of reports) {
    let measured
    try { measured = measure(report) } catch (error) { throw new Error(label + ": " + error.message) }
    requireEvidence(!invocations.has(report.startedAt), label + ": duplicate trial start time")
    invocations.add(report.startedAt)
    requireEvidence(report.compiler.sha256 === compilerSha256, label + ": mixed compiler builds")
    first ??= measured
    requireEvidence(JSON.stringify(measured.environment) === JSON.stringify(first.environment), label + ": mixed environment")
    requireEvidence(JSON.stringify(measured.phases) === JSON.stringify(first.phases), label + ": case/command phases differ")
    for (const [key, value] of measured.samples) {
      if (!samples.has(key)) samples.set(key, [])
      samples.get(key).push(value)
    }
  }
  return { samples, compilerSha256, trials: reports.length, environment: first.environment, phases: first.phases }
}

export function compareTrials(baselineReports, currentReports) {
  const baseline = summarize(baselineReports, "baseline")
  const current = summarize(currentReports, "current")
  requireEvidence(JSON.stringify(baseline.environment) === JSON.stringify(current.environment), "baseline/current environment differs")
  requireEvidence(JSON.stringify(baseline.phases) === JSON.stringify(current.phases), "baseline/current case/command phases differ")
  const rows = baseline.phases.map(key => {
    const [name, phase] = JSON.parse(key)
    const before = median(baseline.samples.get(key))
    const after = median(current.samples.get(key))
    const ratio = after / before
    positive(ratio, "median ratio")
    return { case: name, phase, baselineMedianMs: before, currentMedianMs: after, ratio, regression: ratio > threshold }
  })
  return {
    version: 1, valid: true, threshold, environment: baseline.environment,
    baseline: { trials: baseline.trials, compilerSha256: baseline.compilerSha256 },
    current: { trials: current.trials, compilerSha256: current.compilerSha256 },
    rows, regressions: rows.filter(row => row.regression),
  }
}

function readTrials(dir) {
  const files = fs.readdirSync(dir).filter(name => name.endsWith(".json")).sort().map(name => path.resolve(dir, name))
  const seen = new Set()
  const reports = files.map(file => {
    const real = fs.realpathSync(file)
    requireEvidence(!seen.has(real), "duplicate trial file " + file)
    seen.add(real)
    try { return JSON.parse(fs.readFileSync(file, "utf8")) }
    catch (error) { throw new Error(file + ": " + error.message) }
  })
  return { files, reports }
}

function main(args) {
  const usage = "usage: node scripts/bench/case-timings.mjs --baseline DIR --current DIR --out NEW.json"
  const options = {}
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i]
    if (!["--baseline", "--current", "--out"].includes(key) || options[key] ||
      !args[i + 1] || args[i + 1].startsWith("--")) {
      console.error(usage)
      process.exitCode = 2
      return
    }
    options[key] = path.resolve(args[i + 1])
  }
  if (Object.keys(options).length !== 3) {
    console.error(usage)
    process.exitCode = 2
    return
  }
  let fd
  try {
    fs.mkdirSync(path.dirname(options["--out"]), { recursive: true })
    fd = fs.openSync(options["--out"], "wx")
  } catch (error) {
    console.error(error.code === "EEXIST" ? "output already exists; choose a new path" : error.message)
    process.exitCode = 2
    return
  }
  let result
  try {
    const baseline = readTrials(options["--baseline"])
    const current = readTrials(options["--current"])
    result = compareTrials(baseline.reports, current.reports)
    result.baseline.files = baseline.files
    result.current.files = current.files
    for (const row of result.regressions) {
      console.log("REGRESSION " + row.case + " " + (row.phase ?? "case total") +
        ": " + row.baselineMedianMs.toFixed(3) + " -> " + row.currentMedianMs.toFixed(3) +
        " ms (" + row.ratio.toFixed(3) + "x)")
    }
    console.log("Slowest cases (current medians; milliseconds):")
    for (const row of result.rows.filter(row => row.phase === null)
      .sort((a, b) => b.currentMedianMs - a.currentMedianMs || a.case.localeCompare(b.case)).slice(0, 10)) {
      console.log(row.case + " " + row.currentMedianMs.toFixed(3))
    }
    console.log(result.regressions.length + " alerts; informational only")
  } catch (error) {
    result = { version: 1, valid: false, baselinePath: options["--baseline"], currentPath: options["--current"], error: error.message }
    console.error("invalid comparison: " + error.message)
    process.exitCode = 2
  }
  try { fs.writeFileSync(fd, JSON.stringify(result, null, 2) + "\n") }
  finally { fs.closeSync(fd) }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2))
