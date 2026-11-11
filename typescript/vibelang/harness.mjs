// Compiles and runs the VibeLang acceptance cases in vibelang/cases.
//
//   node vibelang/harness.mjs [--status] [--verbose] [--jobs N] [--late-start] [--isolated] [--scratch dir] [--report new.json] [case...]
//
// smoke.sh builds tsc and the runtime, then runs this script; run smoke.sh,
// not this file. A case argument selects the case with that name, or else
// every case whose name contains it. Each case is a directory with a
// tsconfig.json, and its kind comes from its sources:
//
//   - A failing case has a source whose first line is `// expect: EK9201 ...`.
//     It passes when the error codes tsc reports are exactly those codes.
//   - A runnable case has a source with a `// expect-result: <json>` line.
//     That source must export main(), a function that returns an Effect. The
//     harness writes out/run.mjs, which runs main() and prints the JSON of its
//     success value on a line that starts with @@result, and the case passes
//     when that line holds <json>. What the program logs does not count.
//   - Any other case runs <case>/run.mjs, or else out/main.js, and compares
//     what it prints with expected/stdout.txt. A run.mjs has 60 s unless one
//     of its lines says `// run-seconds: N`. A runner that is a pipeline of
//     bounded stages sets N to the sum of its stage deadlines, so a slow stage
//     trips its own deadline, which names the stage, before the runner's. A
//     shared helper that is such a pipeline carries the line, and a runner
//     without its own takes the largest N among the helpers it imports. A
//     runner without a line never gets less than the sum of the stage
//     deadlines written in it and its helpers. A runner that starts a
//     process, itself or through a helper, carries the line or imports a
//     helper that does (harness-deadlines.test.mjs): it runs at the host's
//     pace, and 60 s killed healthy runs on loaded post-merge boxes. A
//     passing case that used over half of a phase's deadline gets a
//     `deadline:` line under its result and a count in the summary.
//
// --jobs must be a positive safe integer. At most one worker per selected
// case starts; invalid counts exit 2 before reading or modifying cases.
//
// --late-start (or VIBELANG_LATE_START=1) delays scheduler dispatch by 100 ms.
// Use it to expose parents that sleep instead of waiting for child readiness.
// --isolated copies each case into a fresh directory under os.tmpdir().
// --scratch dir selects its parent directory and implies --isolated. The
// repository is read-only input: emits, installs, failure logs and helpers'
// TMPDIR and HOME live in scratch. Successful copies are removed; failed runs
// print and retain their scratch path. Relative reports live there too.
//
// --report new.json retains full-precision case and phase wall times, outcomes,
// commands and tool identities for successful and failing cases alike. The path
// must be new: previous trials are never overwritten. Interrupted reports have
// complete: false. Timings describe this invocation, not a performance baseline.
//
// Every runner must exit successfully, including when its stdout matches.
// Every case except a failing one must compile without errors. Every file in
// expected/ other than stdout.txt and diagnostics.txt must equal the file at
// the same path under out/. A runnable case with expected/stdout.txt compares
// with that file. A case of any kind with expected/diagnostics.txt passes only
// when tsc reports exactly the diagnostics it lists, one per line, in tsc's
// order and without message text: `main.vibe(5,23): error EK1001`. A case with
// expected/messages.txt passes only when each of its lines appears in what
// tsc printed, which checks a diagnostic's text.
//
// A case with a typescript/ directory holding a tsconfig.json is a
// declaration identity case: typescript/ holds the Effect TypeScript that the
// case's .vibe sources rewrite, and both must declare the same API. The
// harness compiles typescript/ with the same compiler and node_modules, and
// each declaration module must export the same names, identical types checked
// in both directions by tsc, and the same JSDoc. Formatting and equivalent
// import spellings do not count. Give typescript/tsconfig.json its
// own outDir, "out". Such a case needs nothing else to compare; it runs only
// when it also has a run.mjs, an expect-result line or expected/stdout.txt.
//
// A case is pending when it has a file named `pending` whose first word names
// the lane that owns the missing feature and whose rest says what is missing.
// A pending case runs but never fails the suite; when it passes, the harness
// reports XPASS, and its owner deletes the file in the commit that fixed it.
//
// Every failed check, including pending cases and --status runs, retains a
// JSON log under .cache/vibelang-harness/<run>/<case>.json (scratch's logs/
// directory with isolation). Its status names
// the log: command/argv, phase, cwd, start/deadline, exit code, timeout/signal,
// and separate stdout/stderr tails. Reruns preserve earlier logs.
//
// Each case gets node_modules/effect from $EFFECT_NODE_MODULES and
// node_modules/vibelang-runtime from $VIBELANG_RUNTIME's published files,
// without its development dependencies. Its peers resolve in the case. A directory under the
// case's stubs/ with a package.json stands in for the package it names: the
// case's node_modules links it under that name, so the compiler and Node
// resolve the package there, as they would an installed one.
import { createHash } from "node:crypto"
import { CaseCommands, nearDeadline, runnerSeconds } from "./harness-command.mjs"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const casesDir = path.join(root, "vibelang", "cases")
const tsc = path.join(root, "built", "local", "tsc")
// scripts/build-vibelang.sh and the //typescript:compiler target write tsc. One older than a file that target builds
// from (typescript/tsc without its tests and testdata) is an earlier compiler: the cases then say nothing about the
// checkout's change (2026-10-31: 21 lane reports had run cases against an earlier compiler).
const staleCompiler = (() => {
  let built
  try {
    built = fs.statSync(tsc).mtimeMs
  } catch {
    return undefined
  }
  const newer = (dir) => {
    let entries
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return undefined
    }
    for (const entry of entries) {
      const at = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        const found = entry.name === "testdata" ? undefined : newer(at)
        if (found) return found
      } else if (!entry.name.endsWith("_test.go") && fs.statSync(at).mtimeMs > built) return at
    }
  }
  const source = newer(path.join(root, "tsc"))
  return source &&
    `warning: ${path.relative(root, tsc)} is older than ${path.relative(root, source)}, so these cases run an earlier ` +
      "compiler; rebuild it with sh scripts/build-vibelang.sh"
})()
const effectModules = process.env.EFFECT_NODE_MODULES
const runtimeDir = process.env.VIBELANG_RUNTIME
// A new directory per invocation preserves intermittent failures across reruns.
const runId = String(Date.now()) + "-" + process.pid

if (!effectModules || !runtimeDir) {
  console.error("harness.mjs: set EFFECT_NODE_MODULES and VIBELANG_RUNTIME, or run vibelang/smoke.sh")
  process.exit(2)
}

if (!path.isAbsolute(effectModules)) {
  console.error("harness.mjs: EFFECT_NODE_MODULES must be an absolute directory")
  process.exit(2)
}

// Check the requested installation before staging any case. A dangling link
// can silently fall back to the runtime's install or cause compiler failures,
// after each case's previous output has already been removed.
const effectPackage = path.join(effectModules, "effect")
let effectInstalled = false
try {
  effectInstalled = fs.statSync(effectPackage).isDirectory() &&
    fs.statSync(path.join(effectPackage, "package.json")).isFile()
} catch {}
if (!effectInstalled) {
  console.error("harness.mjs: missing Effect package at " + effectPackage +
    "; install dependencies with (cd experiments && bun install --frozen-lockfile)" +
    " or set EFFECT_NODE_MODULES to a node_modules directory containing effect")
  process.exit(2)
}

// Reject a broken test installation before selecting cases or replacing their
// outputs. Missing runtime files are setup errors, not compiler regressions.
try {
  if (!path.isAbsolute(runtimeDir)) throw new Error("use an absolute directory")
  if (!fs.statSync(runtimeDir).isDirectory()) throw new Error("not a directory")
  const manifest = JSON.parse(fs.readFileSync(path.join(runtimeDir, "package.json"), "utf8"))
  if (manifest?.name !== "vibelang-runtime") throw new Error("expected the vibelang-runtime package")
  if (!Array.isArray(manifest.files) || !manifest.files.every((file) => typeof file === "string")) {
    throw new Error("package.json files must be an array of paths")
  }
  if (!fs.statSync(path.join(runtimeDir, "dist/index.js")).isFile()) throw new Error("dist/index.js is not a file")
} catch (error) {
  console.error("harness.mjs: invalid VIBELANG_RUNTIME " + runtimeDir + ": " + error.message +
    "; use the built packages/runtime directory or run vibelang/smoke.sh")
  process.exit(2)
}

const args = process.argv.slice(2)
// Reject unknown switches before case selection or filesystem writes. A value
// belongs to --jobs, --report or --scratch; validate those values below.
const switches = new Set(["--status", "--late-start", "--isolated", "--verbose", "-v"])
for (let i = 0; i < args.length; i++) {
  const arg = args[i]
  if (arg === "--jobs" || arg === "--report" || arg === "--scratch") {
    i++
  } else if (arg.startsWith("-") && !switches.has(arg)) {
    console.error("harness.mjs: unknown option " + arg)
    process.exit(2)
  }
}
const statusOnly = args.includes("--status")
const lateStart = args.includes("--late-start") || process.env.VIBELANG_LATE_START === "1"
const scratchAt = args.indexOf("--scratch")
const isolated = args.includes("--isolated") || scratchAt >= 0
const verbose = args.includes("--verbose") || args.includes("-v")
const jobsAt = args.indexOf("--jobs")
const jobs = jobsAt >= 0 ? Number(args[jobsAt + 1]) : Math.max(2, Math.min(8, os.availableParallelism() >> 1))
if (!Number.isSafeInteger(jobs) || jobs < 1) {
  console.error("harness.mjs: --jobs must be a positive safe integer")
  process.exit(2)
}
const reportAt = args.indexOf("--report")
if (reportAt >= 0 && (!args[reportAt + 1] || args[reportAt + 1].startsWith("-") || args.lastIndexOf("--report") !== reportAt)) {
  console.error("harness.mjs: --report requires one new JSON file path")
  process.exit(2)
}
if (scratchAt >= 0 && (!args[scratchAt + 1] || args[scratchAt + 1].startsWith("-") || args.lastIndexOf("--scratch") !== scratchAt)) {
  console.error("harness.mjs: --scratch requires one directory path")
  process.exit(2)
}
// Resolve existing parents too, so a symlink cannot put scratch or reports
// back inside the repository. Validate before creating any directory.
const repository = fs.realpathSync(path.dirname(root))
function physicalPath(file) {
  const absolute = path.resolve(file)
  let parent = absolute
  while (!fs.existsSync(parent)) {
    const next = path.dirname(parent)
    if (next === parent) break
    parent = next
  }
  return path.resolve(fs.realpathSync(parent), path.relative(parent, absolute))
}
function outsideRepository(file) {
  const relative = path.relative(repository, physicalPath(file))
  if (relative === "" || (!relative.startsWith(".." + path.sep) && relative !== ".." && !path.isAbsolute(relative))) {
    throw new Error("path must be outside the repository: " + file)
  }
}
let scratchParent, scratchDir, workDir, reportPath
try {
  if (isolated) {
    scratchParent = path.resolve(scratchAt >= 0 ? args[scratchAt + 1] : os.tmpdir())
    outsideRepository(scratchParent)
    if (reportAt >= 0 && path.isAbsolute(args[reportAt + 1])) outsideRepository(args[reportAt + 1])
  }
} catch (error) {
  console.error("harness.mjs: " + error.message)
  process.exit(2)
}
const selectors = args.filter((a, i) => !a.startsWith("-") &&
  !(jobsAt >= 0 && i === jobsAt + 1) && !(reportAt >= 0 && i === reportAt + 1) &&
  !(scratchAt >= 0 && i === scratchAt + 1))


const allCases = fs
  .readdirSync(casesDir)
  .filter((name) => fs.existsSync(path.join(casesDir, name, "tsconfig.json")))
  .sort()
const selected = selectors.length === 0 ? allCases : [...new Set(selectors.flatMap(select))]

// A sparse mirror keeps runners' repository-relative reads working. Only
// selected cases and helper inputs are writable copies. Copying helpers also keeps
// caches based on import.meta.url inside scratch. Other inputs are linked;
// repository metadata and caches are excluded. Unselected sibling cases
// remain readable as source inputs.
let isolatedCasesDir
if (isolated) {
  fs.mkdirSync(scratchParent, { recursive: true })
  scratchDir = fs.mkdtempSync(path.join(scratchParent, "vibelang-harness-"))
  // Reports may use any ordinary relative directory name. Keep all disposable
  // state under a fresh child so cleanup and failure logs cannot collide.
  workDir = fs.mkdtempSync(path.join(scratchDir, "work-"))
  const mirror = (source, target, except) => {
    fs.mkdirSync(target, { recursive: true })
    for (const entry of fs.readdirSync(source)) {
      if ([except, ".git", ".jj", ".cache", ".flows"].includes(entry)) continue
      const from = path.join(source, entry), to = path.join(target, entry)
      if (except === "cases" && (entry === "test" || entry === "tests" || entry.endsWith(".mjs"))) {
        fs.cpSync(from, to, {
          recursive: true, verbatimSymlinks: true,
          filter: file => !path.relative(from, file).split(path.sep).some(part =>
            ["node_modules", "out", ".cache"].includes(part)),
        })
        makeWritable(to)
      } else fs.symlinkSync(from, to)

    }
  }
  const shadow = path.join(workDir, "repo")
  mirror(path.dirname(root), shadow, "typescript")
  mirror(root, path.join(shadow, "typescript"), "vibelang")
  mirror(path.join(root, "vibelang"), path.join(shadow, "typescript/vibelang"), "cases")
  isolatedCasesDir = path.join(shadow, "typescript/vibelang/cases")
  fs.mkdirSync(isolatedCasesDir)
  const selectedNames = new Set(selected), caseNames = new Set(allCases)
  for (const entry of fs.readdirSync(casesDir, { withFileTypes: true })) {
    const from = path.join(casesDir, entry.name), to = path.join(isolatedCasesDir, entry.name)
    if (entry.isFile()) fs.copyFileSync(from, to)
    else if (entry.isDirectory() && !selectedNames.has(entry.name) &&
      !["node_modules", "out", ".cache", ".flows", ".git", ".jj"].includes(entry.name) && !entry.name.startsWith(".smthrs-")) {
      if (caseNames.has(entry.name)) fs.symlinkSync(from, to, "dir")
      else {
        // Input-only helper directories may also create file-relative caches.
        fs.cpSync(from, to, {
          recursive: true, verbatimSymlinks: true,
          filter: file => !path.relative(from, file).split(path.sep).some(part =>
            [".git", ".jj", ".cache", ".flows"].includes(part)),
        })
        makeWritable(to)
      }
    }
  }
}
const failureDir = isolated ? path.join(workDir, "logs") : path.join(root, ".cache", "vibelang-harness", runId)
if (reportAt >= 0) {
  reportPath = path.resolve(isolated ? scratchDir : process.cwd(), args[reportAt + 1])
  if (isolated) {
    try { outsideRepository(reportPath) }
    catch (error) {
      fs.rmSync(scratchDir, { recursive: true, force: true })
      console.error("harness.mjs: " + error.message)
      process.exit(2)
    }
  }
}

// Reserve the file before running a case. A killed process leaves an explicit
// incomplete invocation; a repeated path cannot destroy an earlier sample.
let reportFd, reportState
function writeReport(value) {
  const json = JSON.stringify(value, null, 2) + "\n"
  fs.writeSync(reportFd, json, 0, "utf8")
  fs.ftruncateSync(reportFd, Buffer.byteLength(json))
}
if (reportPath) {
  try {
    const version = (dir) => JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8")).version
    reportState = {
      version: 1, complete: false, startedAt: new Date().toISOString(),
      selected, jobs, isolated, lateStart,
      compiler: { path: tsc, sha256: createHash("sha256").update(fs.readFileSync(tsc)).digest("hex") },
      node: process.version, effectVersion: version(path.join(effectModules, "effect")),
      runtimeVersion: version(runtimeDir),
      system: {
        platform: os.platform(), release: os.release(), arch: os.arch(),
        cpu: os.cpus()[0]?.model, availableParallelism: os.availableParallelism(),
      },
    }
    fs.mkdirSync(path.dirname(reportPath), { recursive: true })
    reportFd = fs.openSync(reportPath, "wx")
    writeReport(reportState)
  } catch (error) {
    console.error("harness.mjs: report " + reportPath + ": " +
      (error.code === "EEXIST" ? "already exists; choose a new path" : error.message))
    if (isolated) fs.rmSync(scratchDir, { recursive: true, force: true })
    process.exit(2)
  }
}

function select(selector) {
  if (allCases.includes(selector)) return [selector]
  const matches = allCases.filter((name) => name.includes(selector))
  if (matches.length === 0) {
    console.error(`harness.mjs: no case matches ${selector}`)
    process.exit(2)
  }
  return matches
}

// Diagnostics as `tsc --pretty false` prints them: `file(line,col): error EK9201: message`,
// or without the location for diagnostics that have no file.
const diagnosticLine = /^(?:(.+)\((\d+),(\d+)\): )?(error|warning|message|suggestion) ([A-Za-z]+\d+): /

function parseDiagnostics(text) {
  const diagnostics = []
  for (const line of text.split("\n")) {
    const m = diagnosticLine.exec(line)
    if (m) diagnostics.push({ category: m[4], code: m[5], text: line })
    else if (diagnostics.length > 0 && line.startsWith(" ")) diagnostics.at(-1).text += `\n${line}`
  }
  return diagnostics
}

function link(target, at) {
  try {
    if (fs.readlinkSync(at) === target) return
    fs.unlinkSync(at)
  } catch {}
  fs.symlinkSync(target, at)
}

function linkNodeModules(dir) {
  const modules = path.join(dir, "node_modules")
  // Rebuild this install on reruns so removed dependencies cannot linger.
  fs.rmSync(modules, { recursive: true, force: true })
  fs.mkdirSync(modules, { recursive: true })
  link(path.join(effectModules, "effect"), path.join(modules, "effect"))
  // Copy the published files, rather than linking the checkout: realpath
  // resolution through a link exposes the runtime's development dependencies
  // and hides the case's optional platform peers. The runtime has only peers,
  // so it needs no private production node_modules.
  const runtime = path.join(modules, "vibelang-runtime")
  const manifest = JSON.parse(fs.readFileSync(path.join(runtimeDir, "package.json"), "utf8"))
  fs.mkdirSync(runtime, { recursive: true })
  for (const file of ["package.json", ...manifest.files]) {
    const source = path.join(runtimeDir, file)
    if (fs.existsSync(source)) fs.cpSync(source, path.join(runtime, file), { recursive: true, dereference: true })
  }
  const stubs = path.join(dir, "stubs")
  for (const stub of fs.existsSync(stubs) ? fs.readdirSync(stubs) : []) {
    const manifest = path.join(stubs, stub, "package.json")
    if (!fs.existsSync(manifest)) continue
    const at = path.join(modules, JSON.parse(fs.readFileSync(manifest, "utf8")).name)
    fs.mkdirSync(path.dirname(at), { recursive: true })
    link(path.join(stubs, stub), at)
  }
  // Cases that exercise real platform code declare its package themselves.
  // Stubs above take precedence; the remaining dependencies come from the
  // pinned test installations, never from implicit runtime dependency access.
  const manifestFile = path.join(dir, "package.json")
  const dependencies = fs.existsSync(manifestFile) ? JSON.parse(fs.readFileSync(manifestFile, "utf8")).dependencies : {}
  for (const name of Object.keys(dependencies ?? {})) {
    const at = path.join(modules, name)
    if (fs.existsSync(at)) continue
    const source = [effectModules, path.join(runtimeDir, "node_modules")]
      .map((base) => path.join(base, name))
      .find((candidate) => fs.existsSync(candidate))
    if (!source) throw new Error(`case dependency ${name} is missing from EFFECT_NODE_MODULES and VIBELANG_RUNTIME/node_modules`)
    fs.mkdirSync(path.dirname(at), { recursive: true })
    link(source, at)
  }
}

// readHeaders finds the expected codes and the expected result in a case's sources.
function readHeaders(dir) {
  const headers = { codes: undefined, result: undefined, entry: undefined }
  for (const name of fs.readdirSync(dir).sort()) {
    if (!/\.(vibex?|ts|mts|cts)$/.test(name) || name.endsWith(".d.ts")) continue
    const lines = fs.readFileSync(path.join(dir, name), "utf8").split("\n")
    const codes = /^\/\/ expect:\s*(.*)$/.exec(lines[0])
    if (codes) headers.codes = [...(headers.codes ?? []), ...codes[1].split(/\s+/).filter(Boolean)]
    const result = lines.find((line) => line.startsWith("// expect-result:"))
    if (result) {
      headers.result = JSON.stringify(JSON.parse(result.slice("// expect-result:".length)))
      headers.entry = name.replace(/\.(vibex?|ts|mts|cts)$/, ".js")
    }
  }
  return headers
}

// resultMarker starts the line on which out/run.mjs prints main()'s result.
const resultMarker = "@@result "

// A case proves a program ends, not how fast: stack-depth takes 4 s alone and
// passed 10 s at load 200.
const runSeconds = 30

function runner(entry) {
  return `// Generated by vibelang/harness.mjs: runs main() and prints its result.
import { Cause, Effect, Exit, Scheduler } from "effect"
import { lateStartScheduler } from ${JSON.stringify(new URL("./late-start-scheduler.mjs", import.meta.url).href)}
import { main } from "./${entry}"

const timeout = new Promise((resolve) => setTimeout(resolve, ${runSeconds * 1000}, "timeout"))
const exit = await Promise.race([Effect.runPromiseExit(main(), ${lateStart ? "{ scheduler: lateStartScheduler(Scheduler) }" : "{}"}), timeout])
if (exit === "timeout") console.log("${resultMarker}timed out after ${runSeconds} s")
else if (Exit.isSuccess(exit)) console.log("${resultMarker}" + JSON.stringify(exit.value))
else {
  console.log("${resultMarker}failed: " + Cause.pretty(exit.cause).split("\\n")[0])
  console.error(Cause.pretty(exit.cause))
}
// Flush prior writes before the forced exit, including large results and defects.
await Promise.all([process.stdout, process.stderr].map((stream) =>
  new Promise((resolve, reject) => stream.write("", (error) => error ? reject(error) : resolve()))
))
process.exit(0)
`
}

function readPending(dir) {
  const file = path.join(dir, "pending")
  if (!fs.existsSync(file)) return undefined
  const text = fs.readFileSync(file, "utf8").trim()
  if (!text) throw new Error("pending file must name its owner as the first word")
  const space = text.indexOf(" ")
  return space < 0 ? { owner: text, reason: "" } : { owner: text.slice(0, space), reason: text.slice(space + 1) }
}

const sameSet = (a, b) => a.size === b.size && [...a].every((x) => b.has(x))

// declarationFiles lists the .d.ts files under dir, relative to it.
function declarationFiles(dir) {
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir, { recursive: true }).map(String).filter((file) => /\.d\.[cm]?ts$/.test(file)).sort()
}

// checkDeclarationIdentity compiles typescript/, the Effect TypeScript that a
// declaration identity case rewrites, and compares its declaration files with
// the case's. It resolves with undefined when they are identical.
async function checkDeclarationIdentity(dir, commands) {
  const original = path.join(dir, "typescript")
  fs.rmSync(path.join(original, "out"), { recursive: true, force: true })
  // typescript/ must compile against the Effect the case compiles against.
  // Runners that check a pinned reference twin (cov-ch004, match-vip7) link
  // typescript/node_modules/effect to that pin, and the link outlives the run:
  // every later run in the tree then compared declarations built on two Effect
  // versions and stopped at "Ambient declaration load order differs".
  const linkedEffect = path.join(original, "node_modules", "effect")
  if (fs.lstatSync(linkedEffect, { throwIfNoEntry: false })?.isSymbolicLink()) fs.unlinkSync(linkedEffect)
  const compiled = await commands.run(tsc, ["-p", ".", "--pretty", "false"], { phase: "compile typescript", cwd: original, timeout: 120_000 })
  if (compiled.code !== 0) {
    return { ok: false, detail: `typescript/ did not compile (exit ${compiled.code})`, log: compiled.stdout + compiled.stderr }
  }
  const want = declarationFiles(path.join(original, "out"))
  if (want.length === 0) return { ok: false, detail: "typescript/ emitted no declaration files", log: compiled.stdout }
  const compared = await commands.run(process.execPath, [
    path.join(root, "../scripts/api-identity.mjs"),
    "--before", path.join(original, "out"), "--after", path.join(dir, "out")
  ], { phase: "compare declarations", cwd: dir, timeout: 120_000 })
  if (compared.code !== 0) {
    const unavailable = compared.code !== 1
    const command = commands.records.at(-1)
    const receipt = unavailable ? "comparison receipt: " + JSON.stringify({
      phase: command.phase, code: compared.code, exitCode: command.exitCode,
      signal: command.signal, timedOut: command.timedOut,
      wallMs: command.wallMs, timeoutMs: command.timeoutMs,
    }) : ""
    return { ok: false, detail: unavailable ? "declaration API comparison unavailable" : "declaration API differs from typescript/",
      log: [compared.stdout + compared.stderr, receipt].filter(Boolean).join("\n") }
  }

  return undefined
}

// Copy the entire case, including package scope and nested fixture packages.
// The root install is rebuilt; generated output from earlier runs stays behind.
const preparedCases = new Set()
function caseDirectory(name) {
  const source = path.join(casesDir, name)
  if (!isolated) return source
  const dir = path.join(isolatedCasesDir, name)
  if (preparedCases.has(name)) return dir
  fs.cpSync(source, dir, {
    recursive: true,
    // Keep fixture package copies and workspace links inside the private case.
    // Only the root install is rebuilt by linkNodeModules; nested installs are
    // intentional inputs, including duplicate packages below stubs/.
    verbatimSymlinks: true,
    filter: (file) => {
      const parts = path.relative(source, file).split(path.sep)
      return parts[0] !== "node_modules" && !parts.some((part) => part === "out" || part === ".cache")
    },
  })
  makeWritable(dir)
  preparedCases.add(name)
  return dir
}

// A source checkout may itself be read-only. Change only private copies,
// preserving executability and never following fixture symlinks.
function makeWritable(at) {
  const stat = fs.lstatSync(at)
  if (stat.isSymbolicLink()) return
  fs.chmodSync(at, stat.mode | 0o200 | (stat.isDirectory() ? 0o700 : 0))
  if (stat.isDirectory()) for (const entry of fs.readdirSync(at)) makeWritable(path.join(at, entry))
}

// removeNativeDeclarations deletes the native declarations a compile wrote
// into a case: x.d.ts beside x.vibe, x.vibex or their relocated sidecar,
// holding only the re-export vibelang writes (VIP-27). Sidecars are ignored
// by name; these share .d.ts with the hand-written declarations cases keep.
function removeNativeDeclarations(dir) {
  if (!fs.existsSync(dir)) return
  // Walk real directories only: a case's node_modules can link back into
  // itself, and a recursive readdir follows the loop until ELOOP.
  const files = []
  const walk = (relative) => {
    for (const entry of fs.readdirSync(path.join(dir, relative), { withFileTypes: true })) {
      const file = path.join(relative, entry.name)
      if (entry.isDirectory() && entry.name !== "node_modules") walk(file)
      else if (entry.isFile()) files.push(file)
    }
  }
  walk("")
  for (const file of files) {
    if (!file.endsWith(".d.ts") || /\.d\.[^./\\]+\.ts$/.test(file)) continue
    const stem = path.join(dir, file.slice(0, -".d.ts".length))
    for (const extension of [".vibe", ".vibex"]) {
      if (![stem + extension, stem + ".d" + extension + ".ts"].some((candidate) => fs.existsSync(candidate))) continue
      const specifier = JSON.stringify("./" + path.basename(stem) + extension)
      const text = fs.readFileSync(path.join(dir, file), "utf8")
      const forms = [
        `export * from ${specifier};\n`,
        `export * from ${specifier};\nexport { default } from ${specifier};\n`,
        `import vibe = require(${specifier});\nexport = vibe;\n`,
      ]
      if (forms.includes(text)) fs.unlinkSync(path.join(dir, file))
    }
  }
}

// check compiles and runs one case. It resolves with { ok, detail, log }.
async function check(name, commands) {
  const dir = caseDirectory(name)
  const headers = readHeaders(dir)
  fs.rmSync(path.join(dir, "out"), { recursive: true, force: true })
  linkNodeModules(dir)

  const compiled = await commands.run(tsc, ["-p", ".", "--pretty", "false"], { phase: "compile", cwd: dir, timeout: 120_000 })
  const output = compiled.stdout + compiled.stderr
  const diagnostics = parseDiagnostics(output)
  const errors = diagnostics.filter((d) => d.category === "error")
  // Exit 1/2 can accompany expected diagnostics; they cannot establish a
  // successful compilation when the compiler reported no errors.
  if (compiled.code !== 0 && (errors.length === 0 || (compiled.code !== 1 && compiled.code !== 2))) {
    return { ok: false, detail: `tsc exited with ${compiled.code}`, log: output }
  }

  const diagnosticsFile = path.join(dir, "expected", "diagnostics.txt")
  if (fs.existsSync(diagnosticsFile)) {
    const want = fs.readFileSync(diagnosticsFile, "utf8").trim().split("\n").map((line) => line.trim()).filter(Boolean)
    const got = diagnostics.map((d) => d.text.split("\n")[0].replace(/^(.*?: (?:error|warning|message|suggestion) [A-Za-z]+\d+):.*$/, "$1"))
    if (want.join("\n") !== got.join("\n")) {
      return { ok: false, detail: "diagnostics differ from expected/diagnostics.txt", log: [`want:\n  ${want.join("\n  ")}`, `got:\n  ${got.join("\n  ")}`, output].join("\n") }
    }
  }

  const messagesFile = path.join(dir, "expected", "messages.txt")
  if (fs.existsSync(messagesFile)) {
    const lines = fs.readFileSync(messagesFile, "utf8").split("\n").map((line) => line.trim()).filter(Boolean)
    const missing = lines.filter((line) => !output.includes(line))
    if (missing.length > 0) {
      return { ok: false, detail: "tsc did not print every line of expected/messages.txt", log: [`missing:\n  ${missing.join("\n  ")}`, output].join("\n") }
    }
  }

  if (headers.codes) {
    const want = new Set(headers.codes)
    const got = new Set(errors.map((d) => d.code))
    if (sameSet(want, got)) return { ok: true, detail: `reported ${[...want].join(" ")}`, log: output }
    const missing = [...want].filter((c) => !got.has(c))
    const extra = [...got].filter((c) => !want.has(c))
    const parts = [missing.length > 0 && `missing ${missing.join(" ")}`, extra.length > 0 && `unexpected ${extra.join(" ")}`]
    return { ok: false, detail: parts.filter(Boolean).join("; "), log: output }
  }

  if (errors.length > 0) {
    return { ok: false, detail: `tsc reported ${errors.length} error(s): ${[...new Set(errors.map((d) => d.code))].join(" ")}`, log: output }
  }

  const expectedDir = path.join(dir, "expected")
  const expectedFiles = fs.existsSync(expectedDir) ? fs.readdirSync(expectedDir, { recursive: true }) : []
  for (const file of expectedFiles.map(String).sort()) {
    const want = path.join(expectedDir, file)
    if (file === "stdout.txt" || file === "diagnostics.txt" || file === "messages.txt" || fs.statSync(want).isDirectory()) continue
    const got = path.join(dir, "out", file)
    if (!fs.existsSync(got)) return { ok: false, detail: `out/${file} is missing`, log: output }
    if (fs.readFileSync(want, "utf8") !== fs.readFileSync(got, "utf8")) {
      const diff = await commands.run("diff", ["-u", want, got], { phase: "compare", cwd: dir, timeout: 10_000 })
      return { ok: false, detail: `out/${file} differs from expected/${file}`, log: diff.stdout }
    }
  }

  const identity = fs.existsSync(path.join(dir, "typescript", "tsconfig.json"))
  if (identity) {
    const failed = await checkDeclarationIdentity(dir, commands)
    if (failed) return failed
    if (!fs.existsSync(path.join(dir, "run.mjs")) && !headers.entry && !fs.existsSync(path.join(expectedDir, "stdout.txt"))) {
      return { ok: true, detail: "declaration API identical to typescript/", log: output }
    }
  }

  let entry = path.join(dir, "out", "main.js")
  let runTimeout = 60_000
  if (fs.existsSync(path.join(dir, "run.mjs"))) {
    entry = path.join(dir, "run.mjs")
    runTimeout = runnerSeconds(entry) * 1000
  } else if (headers.entry) {
    entry = path.join(dir, "out", "run.mjs")
    fs.writeFileSync(entry, runner(headers.entry))
  }
  const stdoutFile = path.join(expectedDir, "stdout.txt")
  const ran = await commands.run("node", [entry], {
    phase: "run", cwd: dir, timeout: runTimeout,
    env: { ...commands.env, VIBELANG_BINARY: tsc },
  })
  let want, got
  if (fs.existsSync(stdoutFile)) {
    want = fs.readFileSync(stdoutFile, "utf8")
    got = ran.stdout
  } else if (headers.result !== undefined) {
    want = headers.result
    got = ran.stdout.split("\n").findLast((line) => line.startsWith(resultMarker))?.slice(resultMarker.length)
  } else {
    return { ok: false, detail: "nothing to compare: no expected/stdout.txt and no expect-result line", log: "" }
  }
  if (got !== want) {
    const detail = got?.trim().split("\n")[0] || `printed no result (exit ${ran.code})`
    const log = [`want: ${want.trimEnd()}`, `stdout:\n${ran.stdout.trimEnd()}`, ran.stderr.trimEnd()].filter(Boolean).join("\n")
    return { ok: false, detail: `${path.relative(dir, entry)} printed ${detail.slice(0, 160)}`, log }
  }
  if (ran.code !== 0) {
    const log = [`stdout:\n${ran.stdout.trimEnd()}`, ran.stderr.trimEnd()].filter(Boolean).join("\n")
    return { ok: false, detail: `${path.relative(dir, entry)} exited with ${ran.code} despite matching output`, log }
  }
  return { ok: true, detail: "", log: output }
}

async function main() {
  const results = new Array(selected.length)
  let next = 0
  let printed = 0
  const preparationErrors = new Map(), preparationMs = new Map()
  // Prepare every selected input before runners start. A runner may read a
  // sibling selected earlier or later, including one executing concurrently.
  if (isolated) for (const name of selected) {
    const started = performance.now()
    try { caseDirectory(name) }
    catch (error) { preparationErrors.set(name, error) }
    preparationMs.set(name, performance.now() - started)
  }
  const flush = () => {
    while (printed < selected.length && results[printed]) report(results[printed++])
  }
  const worker = async () => {
    while (next < selected.length) {
      const index = next++
      const name = selected[index]
      let pending
      const started = performance.now() - (preparationMs.get(name) ?? 0)
      let result
      let env = process.env
      if (isolated) {
        const temporary = path.join(workDir, "tmp", name)
        const home = path.join(workDir, "home", name)
        fs.mkdirSync(temporary, { recursive: true })
        fs.mkdirSync(home, { recursive: true })
        env = { ...process.env, TMPDIR: temporary, TMP: temporary, TEMP: temporary, HOME: home, USERPROFILE: home,
          XDG_CACHE_HOME: path.join(home, ".cache"), XDG_CONFIG_HOME: path.join(home, ".config"),
          XDG_DATA_HOME: path.join(home, ".local/share"),
          BUN_INSTALL_CACHE_DIR: path.join(home, ".bun/install/cache"),
          npm_config_cache: path.join(home, ".npm"), YARN_CACHE_FOLDER: path.join(home, ".yarn"),
          VIBELANG_CACHE_DIR: path.join(home, ".cache/vibelang") }
      }
      const commands = new CaseCommands(env)
      try {
        pending = readPending(path.join(casesDir, name))
        if (preparationErrors.has(name)) throw preparationErrors.get(name)
        result = await check(name, commands)
      } catch (e) {
        result = { ok: false, detail: `harness error: ${e.message}`, log: e.stack }
      } finally {
        removeNativeDeclarations(isolated ? path.join(isolatedCasesDir, name) : path.join(casesDir, name))
      }
      if (!result.ok) {
        fs.mkdirSync(failureDir, { recursive: true })
        result.logFile = path.join(failureDir, name + ".json")
        fs.writeFileSync(result.logFile, JSON.stringify({
          case: name, detail: result.detail, logTail: result.log?.slice(-65_536),
          commands: commands.records,
        }, null, 2) + "\n")
      }
      if (isolated && result.ok) {
        // Keep fixture inputs until all readers finish, while releasing emits
        // and installs immediately so aggregate runs stay bounded on disk.
        for (const entry of ["out", "node_modules", ".cache"]) {
          fs.rmSync(path.join(isolatedCasesDir, name, entry), { recursive: true, force: true })
        }
      }
      const status = pending ? (result.ok ? "XPASS" : "pending") : result.ok ? "ok" : "FAIL"
      const deadline = result.ok ? nearDeadline(commands.records) : null
      results[index] = { name, pending, status, ms: performance.now() - started, commands: reportPath ? commands.records : undefined, deadline, ...result }
      flush()
    }
  }
  await Promise.all(Array.from({ length: Math.min(jobs, selected.length) }, worker))
  // Keep reports requested inside scratch, but remove successful case copies.
  // Failure logs and helper state remain together for inspection.
  const failed = results.some((result) => !result.ok)
  if (isolated) for (const result of results) {
    if (result.ok) fs.rmSync(path.join(isolatedCasesDir, result.name), { recursive: true, force: true })
  }
  if (isolated && !failed) {
    fs.rmSync(workDir, { recursive: true, force: true })
    if (!reportPath?.startsWith(scratchDir + path.sep)) fs.rmSync(scratchDir, { recursive: true, force: true })
  }
  if (isolated && (failed || reportPath?.startsWith(scratchDir + path.sep))) {
    console.log("scratch: " + scratchDir)
  }

  if (reportPath) {
    writeReport({
      ...reportState, complete: true, finishedAt: new Date().toISOString(),
      cases: results.map(({ name, status, detail, ms, commands, logFile }) => ({
        name, status, detail, wallMs: ms, commands, ...(logFile ? { logFile } : {}),
      })),
    })
    fs.closeSync(reportFd)
    console.log("report: " + reportPath)
  }

  const count = (status) => results.filter((r) => r.status === status).length
  console.log(
    `\n${results.length} cases: ${count("ok")} ok, ${count("FAIL")} FAIL, ${count("pending")} pending, ${count("XPASS")} XPASS`,
  )
  if (staleCompiler) console.log(staleCompiler)
  const near = results.filter((r) => r.deadline)
  if (near.length > 0) console.log(`${near.length} passed past half a deadline: ${near.map((r) => r.name).join(", ")}`)
  const xpass = results.filter((r) => r.status === "XPASS")
  if (xpass.length > 0) console.log(`XPASS: delete the pending file of ${xpass.map((r) => r.name).join(", ")}`)
  // Piped console output may still be buffered; let it drain before exiting.
  process.exitCode = count("FAIL") > 0 ? 1 : 0
}

function report(r) {
  const owner = r.pending?.owner ?? "-"
  if (statusOnly) {
    console.log(`${r.name.padEnd(36)} ${owner.padEnd(5)} ${r.status}${r.logFile ? ` (log: ${r.logFile})` : ""}`)
    reportDeadline(r)
    return
  }
  if (r.logFile) console.log(`log:    ${r.logFile}`)
  const time = verbose ? ` (${(r.ms / 1000).toFixed(1)} s)` : ""
  switch (r.status) {
    case "ok":
      console.log(`ok      ${r.name}${time}`)
      break
    case "XPASS":
      console.log(`XPASS   ${r.name} (pending on ${owner}; delete its pending file)${time}`)
      break
    case "pending":
      console.log(`pending ${r.name} (${owner}: ${r.pending.reason}): ${r.detail}${time}`)
      break
    default:
      console.log(`FAIL    ${r.name}: ${r.detail}${time}`)
  }
  reportDeadline(r)
  if (r.status === "FAIL" || (verbose && r.log)) {
    for (const line of r.log.trimEnd().split("\n").slice(0, verbose ? 200 : 40)) console.log(`        ${line}`)
  }
}

function reportDeadline({ name, deadline }) {
  if (deadline) {
    const { phase, seconds, limit } = deadline
    // Only a custom runner reads run-seconds; compiler, comparison and default
    // execution limits belong to the harness.
    const customRunner = phase === "run" && fs.existsSync(path.join(casesDir, name, "run.mjs"))
    const advice = customRunner
      ? "run.mjs: review its work and `// run-seconds: N`"
      : `harness.mjs: review the ${phase} phase and its fixed deadline`
    console.log(`        deadline: ${phase} took ${seconds.toFixed(1)} s of ${limit} s; a loaded host may hit this limit (${advice})`)
  }
}

await main()
