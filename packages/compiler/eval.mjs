// vibelang eval: finds *.eval.vibe and *.eval.vibex files, imports each
// through the Node loader (vibelang/register) and runs its suites with the
// runtime's Experimental.Eval (VIP-59, VIP-69).
//
//   vibelang eval [path...]            replay recordings; calls no model
//   vibelang eval --list [path...]     print suites and cases; calls no target
//   vibelang eval --live [path...]     call models, write recordings
//   vibelang eval --update [path...]   rewrite baselines from this run
//   vibelang eval --trials N           run each case N times; N > 1 needs --live
//
// Beside src/greet.eval.vibe:
//
//   greet.eval.baseline.json    the committed scores a run is compared with
//   greet.eval.recording.json   the model calls the default run replays
//
// Exit codes: 0 every suite passed, 1 a suite failed or regressed, 5 a suite
// could not be decided (an unrecorded model call, an inconclusive scorer, a
// file that does not load), 2 the command line is wrong. A model call with no
// recording is never sent without --live, and no environment variable turns
// a run live.
import { existsSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs"
import { registerHooks } from "node:module"
import { basename, dirname, join, relative, resolve } from "node:path"
import { pathToFileURL } from "node:url"

/** Whether a path names an eval file (VIP-59 rule 1). */
export const isEvalFile = (path) => /\.eval\.vibex?$/.test(path)

const usage = `Usage: vibelang eval [--list] [--live] [--update] [--trials N] [path...]

Runs the suites in *.eval.vibe and *.eval.vibex files under each path
(default: the working directory).

  (no flag)    replay recorded model calls; a call with no recording is not sent
  --list       print suites and cases; call no target
  --live       call models and write recordings
  --update     rewrite each baseline from this run; never when a case failed
               or went undecided
  --trials N   run each case N times; N above 1 requires --live

Exit codes: 0 passed, 1 failed or regressed, 5 could not decide, 2 usage.
`

class UsageError extends Error {}

/** Parses the arguments after `eval`. Throws on a command line it refuses. */
export function parseArguments(argv) {
  const options = { list: false, live: false, update: false, trials: undefined, help: false, paths: [] }
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index]
    if (argument === "--list") options.list = true
    else if (argument === "--live") options.live = true
    else if (argument === "--update") options.update = true
    else if (argument === "--help" || argument === "-h") options.help = true
    else if (argument === "--trials" || argument.startsWith("--trials=")) {
      const value = argument === "--trials" ? argv[++index] : argument.slice("--trials=".length)
      if (value === undefined || !/^[1-9]\d*$/.test(value)) throw new UsageError(`--trials needs a positive integer, not ${value === undefined ? "nothing" : JSON.stringify(value)}`)
      options.trials = Number(value)
    } else if (argument === "--") {
      options.paths.push(...argv.slice(index + 1))
      break
    } else if (argument.startsWith("-")) throw new UsageError(`unknown option ${argument}`)
    else options.paths.push(argument)
  }
  if (options.list && (options.live || options.update || options.trials !== undefined)) {
    throw new UsageError("--list runs nothing, so it takes no --live, --update or --trials")
  }
  // A replayed trial is the same recorded answer again: it measures the recording.
  if (options.trials !== undefined && options.trials > 1 && !options.live) {
    throw new UsageError(`--trials ${options.trials} requires --live: replaying one recorded answer ${options.trials} times measures the recording, not the model`)
  }
  return options
}

const skipped = new Set(["node_modules", "dist", "build", "coverage"])

/** The eval files under each path, sorted. A path that is a file must be an eval file. */
export function discover(paths, cwd = process.cwd()) {
  const found = new Set()
  const walk = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) {
        if (!entry.name.startsWith(".") && !skipped.has(entry.name)) walk(path)
      } else if (isEvalFile(entry.name)) found.add(path)
    }
  }
  for (const given of paths.length ? paths : ["."]) {
    const path = resolve(cwd, given)
    const stat = statSync(path, { throwIfNoEntry: false })
    if (stat === undefined) throw new UsageError(`no such file or directory: ${given}`)
    if (stat.isDirectory()) walk(path)
    else if (isEvalFile(path)) found.add(path)
    else throw new UsageError(`${given} is not an eval file: an eval file is named *.eval.vibe or *.eval.vibex`)
  }
  return [...found].sort()
}

/** The baseline file beside an eval file: greet.eval.vibe has greet.eval.baseline.json. */
export const baselinePath = (file) => file.replace(/\.vibex?$/, ".baseline.json")
/** The recording beside an eval file: greet.eval.vibe has greet.eval.recording.json. */
export const recordingPath = (file) => file.replace(/\.vibex?$/, ".recording.json")

// The runtime and effect an eval file runs with are the ones its own imports
// resolve to, so a suite, a layer and a model service are each one copy. An
// import of `vibelang-eval:<name>` resolves <name> as the eval file would.
const scheme = "vibelang-eval:"
let resolveFrom
let hooked = false
async function importFrom(file, name) {
  if (!hooked) {
    hooked = true
    registerHooks({
      resolve(specifier, context, nextResolve) {
        if (!specifier.startsWith(scheme)) return nextResolve(specifier, context)
        return nextResolve(specifier.slice(scheme.length), { ...context, parentURL: resolveFrom })
      }
    })
  }
  resolveFrom = pathToFileURL(file).href
  try {
    return await import(scheme + name)
  } catch (error) {
    throw new Error(`cannot load ${name} for ${file}: ${error.message}\nInstall vibelang-runtime and effect where the eval file resolves its imports.`)
  }
}

const suiteType = "~vibelang/experimental/Eval"
const isSuite = (value) => typeof value === "object" && value !== null && value[suiteType] === suiteType

// The default export of an eval file: one suite or an array of suites.
function suitesOf(module, file) {
  if (!("default" in module)) throw new Error(`${file} has no default export; export default Experimental.Eval.suite(name, { target, cases, scorers }), or an array of suites`)
  const suites = Array.isArray(module.default) ? module.default : [module.default]
  suites.forEach((suite, index) => {
    if (!isSuite(suite)) throw new Error(`the default export of ${file}${Array.isArray(module.default) ? `, item ${index},` : ""} is not a suite; build it with Experimental.Eval.suite`)
  })
  if (suites.length === 0) throw new Error(`the default export of ${file} is an empty array; export at least one suite`)
  const names = suites.map((suite) => suite.name)
  const repeated = names.find((name, index) => names.indexOf(name) !== index)
  if (repeated !== undefined) throw new Error(`${file} declares the suite ${JSON.stringify(repeated)} twice; a baseline is keyed by suite name`)
  return suites
}

// A task or workflow carries its derived tag; a plain function, its name (rule 4).
const targetTag = (target) =>
  typeof target !== "function" && (typeof target !== "object" || target === null) ? "?" :
    [target.tag, target._tag, target.name].find((value) => typeof value === "string" && value.length > 0) ?? "(anonymous)"

const casesOf = (suite) => Array.isArray(suite.cases) ? suite.cases : []
const plural = (count, one, many = one + "s") => `${count} ${count === 1 ? one : many}`

// A baseline file holds one suite's baseline as Eval.write prints it, or,
// for an eval file with several suites, {"suites":[...],"version":1}.
function readBaselines(path) {
  if (!existsSync(path)) return undefined
  const text = readFileSync(path, "utf8")
  let value
  try { value = JSON.parse(text) } catch (error) { throw new Error(`${path} is not JSON: ${error.message}`) }
  const several = typeof value === "object" && value !== null && Array.isArray(value.suites)
  return (several ? value.suites : [value]).map((item) => JSON.stringify(item))
}

function writeBaselines(path, texts) {
  const text = texts.length === 1 ? texts[0] : `{"suites":[\n${texts.map((item) => item.trimEnd()).join(",\n")}\n],"version":1}\n`
  const temporary = `${path}.${process.pid}.tmp`
  writeFileSync(temporary, text)
  renameSync(temporary, path)
}

const recordedCalls = (path) => {
  if (!existsSync(path)) return { calls: [] }
  try { return JSON.parse(readFileSync(path, "utf8")) } catch (error) { throw new Error(`${path} is not JSON: ${error.message}`) }
}

// The members Test.record uses, over node:fs. The runtime's own FileSystem
// layers need @effect/platform-node, which a project may not install.
function nodeFileSystem(Effect, FileSystem) {
  const fs = (run) => Effect.try({ try: run, catch: (error) => error }).pipe(Effect.orDie)
  return FileSystem.layerNoop({
    exists: (path) => Effect.sync(() => existsSync(path)),
    readFileString: (path) => fs(() => readFileSync(path, "utf8")),
    writeFileString: (path, data) => fs(() => writeFileSync(path, data)),
    makeDirectory: () => Effect.void,
    rename: (from, to) => fs(() => renameSync(from, to))
  })
}

const unrecorded = (error) => {
  const tag = error?.cause?._tag
  return tag === "UnrecordedCall" || tag === "UnrecordedDecision"
}

const score = (value) => value.toFixed(2)
const meanOf = (values) => values.reduce((sum, value) => sum + value, 0) / values.length

// One line per case and scorer: greet  ada  exact 1.00  (baseline 1.00)
function caseLines(suite, result, baseline) {
  const lines = []
  for (const item of result.cases) {
    const head = `${suite.name}  ${item.case}  `
    if (item.error !== undefined) {
      lines.push(head + (item.error.cause?._tag === "UnrecordedDecision"
        ? "undecided: a decision call has no recording; add its response to the .eval.decisions.json fixture"
        : unrecorded(item.error)
        ? "undecided: a model call has no recording; run vibelang eval --live to record it"
        : `failed: ${item.error.message}`))
      continue
    }
    const byScorer = new Map()
    for (const observation of item.observations) {
      const list = byScorer.get(observation.scorer) ?? []
      list.push(observation)
      byScorer.set(observation.scorer, list)
    }
    if (byScorer.size === 0) lines.push(head + "no scorer")
    for (const [key, observations] of byScorer) {
      const name = observations[0].scorerName || key.slice(0, 8)
      const scores = observations.filter((observation) => observation.kind === "score").map((observation) => observation.score)
      const inconclusive = observations.find((observation) => observation.kind === "inconclusive")
      const recorded = baseline?.records.filter((record) => (record.targetTag === undefined || record.targetTag === result.targetTag) && record.case === item.case && record.scorer === key).map((record) => record.score) ?? []
      const against = recorded.length ? `(baseline ${score(meanOf(recorded))})` : "(no baseline)"
      const trials = observations.length > 1 ? `  ${plural(observations.length, "trial")}` : ""
      lines.push(head + (scores.length
        ? `${name} ${score(meanOf(scores))}  ${against}${trials}${inconclusive ? `  undecided: ${inconclusive.reason}` : ""}`
        : `${name} undecided: ${inconclusive.reason}`))
    }
  }
  return lines
}

async function listFile(file, shown, out) {
  const suites = suitesOf(await import(pathToFileURL(file).href), file)
  out(shown)
  let cases = 0
  for (const suite of suites) {
    out(`  ${suite.name}  target ${suite.targetTag ?? targetTag(suite.target)}`)
    for (const item of casesOf(suite)) {
      cases++
      out(`    ${typeof item?.name === "string" ? item.name : "(unnamed case)"}`)
    }
  }
  return { suites: suites.length, cases }
}

async function runFile(file, shown, options, out, err) {
  const module = await import(pathToFileURL(file).href)
  const suites = suitesOf(module, file)
  const { Effect, Layer, FileSystem } = await importFrom(file, "effect")
  const Eval = await importFrom(file, "vibelang-runtime/experimental/Eval")
  const Test = await importFrom(file, "vibelang-runtime/experimental/Test")
  const recording = recordingPath(file)
  const before = recordedCalls(recording)
  let model
  if (options.live) {
    // The live model is the eval file's own `live` export, such as
    // Experimental.Model.use("anthropic:..."). It is built at the first call no
    // recording answers, so a suite that calls no model needs none.
    const live = Layer.isLayer(module.live) ? module.live : Layer.effectContext(Effect.die(new Error(
      `${shown} called a model with no recording, and exports no live model; add: export const live = Experimental.Model.use("<provider>:<model>")`
    )))
    model = Layer.provide(Test.record(recording, { live }), nodeFileSystem(Effect, FileSystem))
  } else model = Test.replay(before)
  const decisions = recordedCalls(file.replace(/\.vibex?$/, ".decisions.json"))
  model = Layer.merge(model, Test.decisions(decisions))

  const stored = readBaselines(baselinePath(file))
  const baselines = new Map()
  for (const text of stored ?? []) {
    const loaded = await Effect.runPromise(Eval.load(text))
    baselines.set(loaded.suite, loaded)
  }

  const totals = { suites: suites.length, cases: 0, regressed: 0, failed: 0, undecided: 0, exitCode: 0, updated: false }
  const fresh = []
  let clean = true
  // One model for the file: a recorded call is claimed once across its suites.
  const results = await Effect.runPromise(Effect.forEach(suites, (suite) =>
    Effect.result(Eval.run(suite, options.trials === undefined ? {} : { trials: options.trials })), { concurrency: 1 }
  ).pipe(Effect.provide(model), Effect.scoped))
  for (const [index, suite] of suites.entries()) {
    const outcome = results[index]
    if (outcome._tag === "Failure") {
      err(`${suite.name}  could not run: ${outcome.failure.message}`)
      totals.undecided++
      totals.exitCode = Math.max(totals.exitCode, 5)
      clean = false
      continue
    }
    const result = outcome.success
    totals.cases += result.cases.length
    const failed = result.cases.filter((item) => item.error !== undefined && !unrecorded(item.error))
    const missing = result.cases.filter((item) => item.error !== undefined && unrecorded(item.error))
    const inconclusive = result.observations.some((observation) => observation.kind === "inconclusive")
    const committed = baselines.get(suite.name)
    for (const line of caseLines(suite, result, committed)) out(line)
    const next = await Effect.runPromise(Eval.baseline(result))
    fresh.push(Eval.write(next))
    if (failed.length || missing.length || inconclusive) clean = false
    // Under --update the run is graded against the baseline it writes: the
    // gate's thresholds still decide, and no score can have moved.
    const report = await Effect.runPromise(Eval.compare(options.update ? next : committed ?? { version: Eval.baselineVersion, suite: suite.name, records: [] }, result))
    const grade = Eval.gate(report, suite.gate ?? {})
    totals.failed += failed.length
    totals.undecided += missing.length
    totals.regressed += new Set(report.regressions.map((item) => `${item.case}`)).size
    // An unrecorded call decides nothing about the case: the gate counts a
    // failed target as a failure, the command as a recording to make.
    const code = failed.length ? 1 : missing.length ? 5 : grade.exitCode
    if (code !== 0) {
      const why = missing.length && !failed.length
        ? `inconclusive: ${plural(missing.length, "case")} called a model with no recording`
        : grade.summary
      err(`${suite.name}  ${why}`)
      if (!options.update && committed === undefined && code === 1) err(`${suite.name}  no baseline in ${basename(baselinePath(file))}; run vibelang eval --update to write it`)
    }
    // 1 outranks 5: a regression is a result, an undecided suite is not.
    totals.exitCode = totals.exitCode === 1 || code === 1 ? 1 : Math.max(totals.exitCode, code)
  }
  if (options.update) {
    if (clean) {
      writeBaselines(baselinePath(file), fresh)
      totals.updated = true
      out(`wrote ${relative(process.cwd(), baselinePath(file)) || baselinePath(file)}`)
    } else err(`${shown}  baseline not updated: a case failed or went undecided`)
  }
  totals.calls = options.live ? Math.max(0, recordedCalls(recording).calls.length - before.calls.length) : 0
  return totals
}

/**
 * Runs `vibelang eval` with the arguments after `eval` and returns its exit
 * code. `io` replaces the working directory and the output streams in tests.
 */
export async function main(argv, io = {}) {
  const cwd = io.cwd ?? process.cwd()
  const out = io.stdout ?? ((line) => process.stdout.write(line + "\n"))
  const err = io.stderr ?? ((line) => process.stderr.write(line + "\n"))
  let options, files
  try {
    options = parseArguments(argv)
    if (options.help) {
      out(usage.trimEnd())
      return 0
    }
    files = discover(options.paths, cwd)
  } catch (error) {
    if (!(error instanceof UsageError)) throw error
    err(`vibelang eval: ${error.message}`)
    err(usage.trimEnd())
    return 2
  }
  const shown = (file) => relative(cwd, file) || file
  if (files.length === 0) {
    err(`vibelang eval: no *.eval.vibe or *.eval.vibex file under ${options.paths.length ? options.paths.join(", ") : "the working directory"}`)
    return options.list ? 0 : 5
  }
  // The Node loader compiles each eval file with its project.
  await import("./register.mjs")
  const totals = { suites: 0, cases: 0, regressed: 0, failed: 0, undecided: 0, calls: 0, exitCode: 0 }
  for (const file of files) {
    try {
      const result = options.list ? await listFile(file, shown(file), out) : await runFile(file, shown(file), options, out, err)
      for (const key of ["suites", "cases", "regressed", "failed", "undecided", "calls"]) totals[key] += result[key] ?? 0
      totals.exitCode = totals.exitCode === 1 || result.exitCode === 1 ? 1 : Math.max(totals.exitCode, result.exitCode ?? 0)
    } catch (error) {
      // A file that does not load decides nothing.
      err(`vibelang eval: ${shown(file)}: ${error?.message ?? error}`)
      totals.exitCode = totals.exitCode === 1 ? 1 : 5
      totals.undecided++
    }
  }
  if (options.list) {
    out(`${plural(totals.suites, "suite")}, ${plural(totals.cases, "case")} in ${plural(files.length, "file")}.`)
    return totals.exitCode
  }
  const extra = [
    ...(totals.failed ? [`${totals.failed} failed`] : []),
    ...(totals.undecided ? [`${totals.undecided} undecided`] : [])
  ]
  out(`${plural(totals.suites, "suite")}, ${plural(totals.cases, "case")}, ${[`${totals.regressed} regressed`, ...extra].join(", ")}. ${plural(totals.calls, "model call")}.`)
  return totals.exitCode
}
