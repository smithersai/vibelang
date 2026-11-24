// The first-bad flow's steps. Given a good commit and a bad one on a linear
// history, and graph targets that fail at the bad one, it says which failures
// reproduce, and for each that does, the first commit it fails at.
//
// A target that fails at bad and then passes on a rerun with the same inputs is
// flaky there: no commit broke it, so the flow names its cause (the ci-health
// flow's classification) instead of bisecting it. A target that also fails at
// good was broken earlier; the flow says so and does not bisect it either.
//
// Every run checks out one commit in the flow's own jj workspace and runs
// `sh scripts/ci.sh <targets>` there, so the commit's own graph, scripts and
// lockfiles decide what runs. The result cache keeps only passes, so a failing
// target runs again on every try while unchanged dependencies (the compiler)
// replay.
import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import path from "node:path"
import { cause, failedTests, targetLines } from "../../ci-health/lib/steps.mjs"

export const STEPS = ["prepare", "reproduce", "bisect", "report"]

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

function sh(command, cwd) {
  const started = Date.now()
  const p = spawnSync("bash", ["-c", command], { cwd, encoding: "utf8", maxBuffer: 512 << 20 })
  return { code: p.status ?? 1, seconds: Math.round((Date.now() - started) / 1000), output: (p.stdout ?? "") + (p.stderr ?? "") }
}
const must = (command, cwd) => {
  const r = sh(command, cwd)
  if (r.code) throw new Error(`${command} (in ${cwd}) exited ${r.code}:\n${r.output.trimEnd().split("\n").slice(-20).join("\n")}`)
  return r.output
}
const quote = (s) => `'${String(s).replaceAll("'", `'\\''`)}'`

// parseHistory reads `jj log` lines (commit, parents, title; tab-separated,
// oldest first) and refuses a history with merges or gaps: bisection walks one
// line of commits.
export function parseHistory(text, good) {
  const commits = text.split("\n").filter(Boolean).map((line) => {
    const [commit, parents, ...title] = line.split("\t")
    return { commit, parents: parents ? parents.split(",") : [], title: title.join("\t") }
  })
  if (!commits.length) throw new Error("the range has no commits: bad must descend from good")
  commits.forEach((c, i) => {
    const want = i ? commits[i - 1].commit : good
    if (c.parents.length !== 1 || c.parents[0] !== want) throw new Error(`${c.commit.slice(0, 12)} is not the only child of ${want.slice(0, 12)}: the range is not linear`)
  })
  return commits.map(({ commit, title }) => ({ commit, title }))
}

// history resolves good and bad to commit ids and lists the commits after good
// up to bad.
export function history(repo, good, bad) {
  const id = (rev) => must(`jj --ignore-working-copy log --no-graph -r ${quote(rev)} -T 'commit_id'`, repo).trim()
  const g = id(good), b = id(bad)
  const template = `commit_id ++ "\\t" ++ parents.map(|p| p.commit_id()).join(",") ++ "\\t" ++ description.first_line() ++ "\\n"`
  const text = must(`jj --ignore-working-copy log --no-graph --reversed -r ${quote(`${g}..${b}`)} -T ${quote(template)}`, repo)
  return { good: g, bad: b, commits: parseHistory(text, g) }
}

// The flow's workspace sits in the run directory. Each checkout moves it
// without a snapshot, so files a run leaves behind never become a commit.
const workspace = (run) => path.join(run, "ws")
export const workspaceName = (run) => `first-bad-${createHash("sha256").update(path.resolve(run)).digest("hex").slice(0, 10)}`

export function checkout(run, commit) {
  const ws = workspace(run)
  if (!existsSync(path.join(ws, ".jj"))) {
    const { repo } = read(paths(run).options)
    must(`jj workspace add ${quote(ws)} --name ${workspaceName(run)} -r ${quote(commit)}`, repo)
  }
  must(`jj --ignore-working-copy new ${quote(commit)}`, ws)
  must("jj workspace update-stale", ws)
}

// parseResults reads a CI_RESULTS file into one status per label, or null for
// a run that wrote none (ci.sh failed before the graph ran).
export function parseResults(text) {
  try {
    const results = JSON.parse(text).results
    return Array.isArray(results) ? Object.fromEntries(results.map((r) => [r.label, r.status])) : null
  } catch {
    return null
  }
}

// verdict says what one target did in one run: pass (ran or replayed), fail
// (its own command failed), or untestable (it never ran: a dependency failed,
// or the graph did not start). An untestable commit is skipped, as git bisect
// skips a commit that does not build.
export function verdict(statuses, label) {
  const s = statuses?.[label]
  if (s === "ran" || s === "hit") return "pass"
  if (s === "failed") return "fail"
  return "untestable"
}

// The Go targets whose failing tests bisect runs alone, with the package and
// the environment PACKAGE.ts gives each target's go test. A whole
// //:go-vibelangfuzz run took over 15 minutes on loaded nyc-01 (11-02 17:20Z),
// and bisect reran it at every commit; one named test takes its compile and
// seconds. The graph cannot run part of a target: its cache would record the
// part's pass as the target's. A suite's leaves (the go-vibelang shards, the
// fuzz seed partitions, support packages and VIP check) run the same
// packages' tests, so a failing leaf narrows as its suite does.
// Test: test/steps.test.mjs reads PACKAGE.ts.
export const GO_TARGETS = [
  { label: /^\/\/:go-vibelangfuzz(?:-topic-[a-z0-9]+|-seeds-\d+|-package-[a-z0-9-]+|-vip)?$/, pkg: "./internal/vibelangfuzz/...", env: "CGO_ENABLED=0 VIBELANG_FUZZ_REQUIRE=1 VIBELANG_FUZZ_HANG=120s", flags: "-short -count=1 -timeout=40m -trimpath" },
  { label: /^\/\/:go-vibelang(?:-shard-\d+)?$/, pkg: "./internal/vibelang/...", env: "CGO_ENABLED=0", flags: "-count=1 -timeout=45m -trimpath" }
]
// The runtime the Go tests run compiled programs against: goVibelang's data.
export const GO_DEPS = ["//packages:runtime-dist"]

// narrowed says how to run only a target's named failing tests: null for a
// target not in GO_TARGETS, or tests that are not Go Test or Fuzz functions.
// A subtest's failure runs its top-level function; a Fuzz function runs its seeds.
export function narrowed(label, tests) {
  const g = GO_TARGETS.find((x) => x.label.test(label))
  const names = [...new Set((tests ?? []).map((n) => n.split("/")[0]))].sort()
  if (!g || !names.length || !names.every((n) => /^(Test|Fuzz)[A-Za-z0-9_]+$/.test(n))) return null
  return { ...g, names, run: `^(${names.join("|")})$` }
}

// goVerdict reads one narrowed go test run: a build or setup failure means the
// commit could not run the tests (untestable), as a graph dependency failure does.
export function goVerdict(code, text) {
  if (code === 0) return "pass"
  if (/\[(build|setup) failed\]/.test(text) || !/^(--- FAIL|FAIL\s)/m.test(text)) return "untestable"
  return "fail"
}

// attempt runs targets at one commit once and keeps the run's results and log
// under runs/<name>.json and .log. A target with an entry in tests runs only
// those tests (narrowed), after the graph builds GO_DEPS; its log is
// runs/<name>-go.log.
function attempt(run, commit, targets, name, tests = {}, confirm = false) {
  const dir = path.join(run, "runs")
  mkdirSync(dir, { recursive: true })
  const results = path.join(dir, `${name}.json`), log = path.join(dir, `${name}.log`)
  rmSync(results, { force: true })
  checkout(run, commit)
  const { jobs } = read(paths(run).options)
  const narrow = Object.fromEntries(targets.map((t) => [t, narrowed(t, tests[t])]).filter(([, n]) => n))
  const graph = [...targets.filter((t) => !narrow[t]), ...(Object.keys(narrow).length ? GO_DEPS : [])]
  const r = sh(`CI_RESULTS=${quote(results)} sh scripts/ci.sh ${graph.map(quote).join(" ")} --jobs ${jobs}${confirm ? " --no-cache" : ""} > ${quote(log)} 2>&1`, workspace(run))
  const statuses = existsSync(results) ? parseResults(readFileSync(results, "utf8")) : null
  const text = existsSync(log) ? readFileSync(log, "utf8") : ""
  const depsOk = GO_DEPS.every((d) => verdict(statuses, d) === "pass")
  let seconds = r.seconds, go = ""
  const out = {}
  for (const [t, n] of Object.entries(narrow)) {
    if (!depsOk) { out[t] = { verdict: "untestable", tests: [], cause: "", excerpt: "", narrowed: n.names }; continue }
    const goLog = path.join(dir, `${name}-go.log`)
    const g = sh(`cd typescript/tsc && GOCACHE=$HOME/.cache/go-build-smthrs ${n.env} EFFECT_NODE_MODULES=$PWD/../../experiments/node_modules go test ${n.flags} -run ${quote(n.run)} ${n.pkg} > ${quote(goLog)} 2>&1`, workspace(run))
    seconds += g.seconds
    go = existsSync(goLog) ? readFileSync(goLog, "utf8") : ""
    const lines = go.split("\n")
    const v = goVerdict(g.code, go)
    out[t] = { verdict: v, tests: v === "fail" ? failedTests(lines) : [], cause: "", excerpt: v === "pass" ? "" : lines.slice(-30).join("\n"), narrowed: n.names }
  }
  return {
    code: r.code, seconds,
    targets: Object.fromEntries(targets.map((t) => {
      if (out[t]) return [t, out[t]]
      const v = verdict(statuses, t)
      const lines = v === "fail" ? targetLines(text, t) : []
      return [t, { verdict: v, tests: failedTests(lines), cause: v === "fail" ? cause(lines) : "", excerpt: lines.slice(-30).join("\n") }]
    }))
  }
}

// probe runs targets at one commit. A target that never ran is run once more:
// on a shared host its dependency's build can die of the host (a build cache
// file deleted mid-link, 2026-11-01), not of the commit.
export function probe(run, commit, targets, n, once = attempt, tests = {}, confirm = false) {
  const first = once(run, commit, targets, `${n}`, tests, confirm)
  const again = targets.filter((t) => first.targets[t].verdict === "untestable")
  if (!again.length) return { n, commit, ...first }
  const second = once(run, commit, again, `${n}b`, tests, confirm)
  return { n, commit, code: second.code, seconds: first.seconds + second.seconds, retried: again, targets: { ...first.targets, ...second.targets } }
}

// prepare records the history; checkout creates the workspace on demand.
export const prepare = (run) => once(run, "prepare", ({ repo, good, bad }) => {
  const h = history(repo, good, bad)
  const ws = workspace(run)
  return { ok: true, ...h, workspace: ws, summary: `${h.commits.length} commits from ${h.good.slice(0, 12)} to ${h.bad.slice(0, 12)}` }
})

// classify turns the runs at bad into each target's state: broken when it
// failed every try, flaky when it failed and then passed, not-reproduced when
// it passed on the first try, untestable when it never ran.
export function classify(runs, targets) {
  return Object.fromEntries(targets.map((t) => {
    const vs = runs.map((r) => r.targets[t]?.verdict).filter(Boolean)
    const state = vs[0] === "untestable" ? "untestable"
      : vs[0] === "pass" ? "not-reproduced"
      : vs.includes("pass") ? "flaky" : vs.includes("untestable") ? "untestable" : "broken"
    return [t, state]
  }))
}

// parseTests reads the tests option: "<target>=<Test>,<Test> ...", the
// failing tests post-merge named for each target. A target without an entry
// runs whole.
export function parseTests(text) {
  return Object.fromEntries((text ?? "").split(/\s+/).filter(Boolean).map((pair) => {
    const at = pair.lastIndexOf("=")
    if (at <= 0) throw new Error(`tests: "${pair}" is not <target>=<Test>,<Test>`)
    return [pair.slice(0, at), pair.slice(at + 1).split(",").filter(Boolean)]
  }))
}

// reproduceRuns runs the targets at bad, and reruns the ones that failed until
// they pass or the tries run out. A Go target with named tests runs only those
// (narrowed): a whole //:go-vibelangfuzz run at bad waited 55+ minutes for the
// loaded host (11-02 18:00Z), and the RED line already names what failed.
export function reproduceRuns(run, bad, targets, tries, tests = {}, probeAt = probe) {
  const runs = [probeAt(run, bad, targets, 1, attempt, tests)]
  let failing = targets.filter((t) => runs[0].targets[t].verdict === "fail")
  while (failing.length && runs.length < tries) {
    const r = probeAt(run, bad, failing, runs.length + 1, attempt, tests)
    runs.push(r)
    failing = failing.filter((t) => r.targets[t].verdict === "fail")
  }
  return runs
}

export const reproduce = (run) => once(run, "reproduce", ({ targets, tries, tests }) => {
  const p = read(paths(run).prepare)
  const runs = reproduceRuns(run, p.bad, targets, tries, tests ?? {})
  const states = classify(runs, targets)
  const broken = targets.filter((t) => states[t] === "broken")
  return { ok: true, runs, states, broken, summary: targets.map((t) => `${t} ${states[t]}`).join(", ") }
})

// next picks the commit index to test: the middle of the widest open range
// among the targets still bisecting, or the nearest commit to it not already
// found untestable. A range is [last passing index, first failing index];
// good is -1. Null when every range is closed.
const skippedAt = (skipped, target) => skipped instanceof Set ? skipped : skipped[target]

export function next(ranges, skipped) {
  const open = Object.entries(ranges).filter(([, [lo, hi]]) => hi - lo > 1).sort(([, a], [, b]) => (b[1] - b[0]) - (a[1] - a[0]))
  for (const [target, [lo, hi]] of open) {
    const mid = Math.floor((lo + hi) / 2)
    const inside = Array.from({ length: hi - lo - 1 }, (_, k) => lo + 1 + k).filter((i) => !skippedAt(skipped, target).has(i))
    inside.sort((a, b) => Math.abs(a - mid) - Math.abs(b - mid) || a - b)
    if (inside.length) return inside[0]
  }
  return null
}

// record narrows each open range that contains index i with the target's
// verdict there; an untestable verdict adds i to skipped and leaves the range.
export function record(ranges, i, verdicts, skipped) {
  const out = { ...ranges }
  for (const [t, [lo, hi]] of Object.entries(ranges)) {
    if (i <= lo || i >= hi) continue
    const v = verdicts[t]
    if (v === "pass") out[t] = [i, hi]
    else if (v === "fail") out[t] = [lo, i]
    else skippedAt(skipped, t).add(i)
  }
  return out
}

// closed is true once no open range has a testable commit left.
const closed = (ranges, skipped) => next(ranges, skipped) === null

// bisect checks the broken targets at good, then narrows each one's range to
// the first commit it fails at. Untestable commits widen the answer to a range
// the report names. Targets that share a midpoint share its run.
function leafTests(names) {
  return names.filter((name) => !names.some((other) => other.startsWith(name + "/")))
}

function matchingVerdict(result, tests) {
  if (result.verdict !== "fail") return result.verdict
  return leafTests(result.tests).some((test) => tests.includes(test)) ? "fail" : "untestable"
}

export const bisect = (run, probeAt = probe) => once(run, "bisect", () => {
  const p = read(paths(run).prepare), r = read(paths(run).reproduce)
  const runs = []
  let n = r.runs.length
  if (!r.broken.length) return { ok: true, runs, ranges: {}, atGood: [], goodUntestable: [], skipped: [], summary: "nothing to bisect" }
  // A Go target bisects on the tests that failed at bad (narrowed).
  const tests = Object.fromEntries(r.broken.map((t) => {
    const attempts = r.runs.flatMap((x) => x.targets[t] ? [leafTests(x.targets[t].tests)] : [])
    const repeated = (attempts[0] ?? []).filter((test) => attempts.every((names) => names.includes(test)))
    return [t, repeated]
  }))
  const atGoodRun = probeAt(run, p.good, r.broken, ++n, attempt, tests)
  runs.push({ ...atGoodRun, index: -1 })
  // Only a matching failure at good proves the break predates the range.
  // Even initially untestable good endpoints must pass confirmation if retained.
  const identifiable = r.broken.filter((t) => tests[t].length)
  const unconfirmed = r.broken.filter((t) => !tests[t].length)
  const atGood = identifiable.filter((t) => matchingVerdict(atGoodRun.targets[t], tests[t]) === "fail")
  const goodUntestable = identifiable.filter((t) => matchingVerdict(atGoodRun.targets[t], tests[t]) === "untestable")
  let ranges = Object.fromEntries(identifiable.filter((t) => !atGood.includes(t)).map((t) => [t, [-1, p.commits.length - 1]]))
  const skipped = Object.fromEntries(Object.keys(ranges).map((t) => [t, new Set()]))
  const probed = new Set()
  while (!closed(ranges, skipped)) {
    const i = next(ranges, skipped)
    if (probed.has(i)) throw new Error(`bisection made no progress at ${p.commits[i].commit}`)
    probed.add(i)
    const open = Object.keys(ranges).filter((t) => ranges[t][0] < i && i < ranges[t][1])
    const result = probeAt(run, p.commits[i].commit, open, ++n, attempt, tests)
    runs.push({ ...result, index: i })
    ranges = record(ranges, i, Object.fromEntries(open.map((t) => [t, matchingVerdict(result.targets[t], tests[t])])), skipped)
  }
  for (const [target, [lo, hi]] of Object.entries(ranges)) {
    const last = probeAt(run, lo < 0 ? p.good : p.commits[lo].commit, [target], ++n, attempt, tests, true)
    const first = probeAt(run, p.commits[hi].commit, [target], ++n, attempt, tests, true)
    runs.push({ ...last, index: lo }, { ...first, index: hi })
    if (matchingVerdict(last.targets[target], tests[target]) !== "pass" ||
        matchingVerdict(first.targets[target], tests[target]) !== "fail") {
      unconfirmed.push(target)
      delete ranges[target]
    }
  }
  const summary = Object.entries(ranges).map(([t, [lo, hi]]) => `${t}: ${p.commits[hi].commit.slice(0, 12)}${hi - lo > 1 ? ` (or one of ${hi - lo - 1} untestable before it)` : ""}`)
  return { ok: true, runs, ranges, atGood, goodUntestable, unconfirmed, tests, skipped: [...new Set(Object.values(skipped).flatMap((indices) => [...indices]))], summary: [...summary, ...unconfirmed.map((t) => `${t}: unconfirmed`)].join(", ") || "every broken target already fails at good" }
})

const cell = (s) => String(s).replaceAll("|", "\\|").replaceAll("\n", " ")

// explain turns the recorded runs into each target's answer: its state, and
// for a target a commit broke, the first bad commit, the last good one, and
// what failed there. Only a flake gets a cause: a break's cause is the commit,
// and a classifier reading its output misleads (a case that prints an error
// named Timeout reads as a timeout).
export function explain(p, r, b, targets) {
  const allRuns = [...r.runs, ...b.runs]
  return Object.fromEntries(targets.map((t) => {
    const state = r.states[t]
    if (state === "flaky") {
      const failed = r.runs.find((x) => x.targets[t]?.verdict === "fail")
      return [t, { state, cause: failed.targets[t].cause, tests: failed.targets[t].tests }]
    }
    if (state !== "broken") return [t, { state }]
    if (b.unconfirmed?.includes(t)) return [t, { state: "unconfirmed" }]
    if (b.atGood.includes(t)) return [t, { state: "broken-at-good" }]
    const [lo, hi] = b.ranges[t]
    const c = p.commits[hi]
    // The first bad commit is a recorded failure (bad itself, or a probe), but
    // read it defensively: a missing run must not lose the rest of the answer.
    const failedAt = allRuns.find((x) => x.commit === c.commit && x.targets[t]?.verdict === "fail")?.targets[t]
    return [t, {
      state, firstBad: c.commit, title: c.title, lastGood: lo < 0 ? p.good : p.commits[lo].commit, untestable: hi - lo - 1,
      ...(b.goodUntestable?.includes(t) && lo >= 0 ? { goodUntestable: true } : {}),
      tests: (failedAt?.tests ?? []).filter((test) =>
        !b.tests || b.tests[t].some((name) => name === test || name.startsWith(test + "/"))),
      excerpt: failedAt?.excerpt ?? ""
    }]
  }))
}

// report writes report.md and the answer a lane or the eval reads.
export const report = (run) => once(run, "report", ({ repo, targets }) => {
  const p = read(paths(run).prepare), r = read(paths(run).reproduce), b = read(paths(run).bisect)
  const found = explain(p, r, b, targets)
  const runs = r.runs.length + b.runs.length
  const lines = [`# First bad commit: ${p.good.slice(0, 12)}..${p.bad.slice(0, 12)} (${p.commits.length} commits, ${runs} runs)`, ""]
  lines.push("| Target | State | First bad commit | Failing tests | Flake cause |", "| --- | --- | --- | --- | --- |")
  for (const [t, e] of Object.entries(found)) {
    const where = e.firstBad ? `\`${e.firstBad.slice(0, 12)}\` ${cell(e.title)}${e.untestable ? ` (or one of ${e.untestable} untestable commits before it)` : ""}` : ""
    lines.push(`| \`${t}\` | ${e.state} | ${where} | ${cell((e.tests ?? []).slice(0, 5).join(", "))} | ${e.cause ?? ""} |`)
  }
  lines.push("", "`broken`: failed every try at bad and passes at good. `broken-at-good`: fails at good too; start from an older good.",
    "`flaky`: failed, then passed with the same inputs; no commit broke it. `not-reproduced`: passed at bad on the first try.",
    "`untestable`: at least one reproduction attempt did not run the target.",
    "`unconfirmed`: the failing test could not be identified or the final pair did not reproduce.")
  for (const [t, e] of Object.entries(found).filter(([, e]) => e.firstBad)) {
    const files = sh(`jj --ignore-working-copy diff --name-only -r ${e.firstBad}`, repo).output.split("\n").filter(Boolean)
    const passes = `passes at \`${e.lastGood}\``
    const only = b.runs.find((x) => x.targets[t]?.narrowed)?.targets[t].narrowed
    const first = e.untestable ? "First observed failure" : "First failure"
    lines.push("", `## \`${t}\``, "", `${first} at \`${e.firstBad}\` (${e.title}); ${passes}.`)
    if (only) lines.push("", `Bisected on the tests that failed at bad, run alone: ${only.map((x) => `\`${x}\``).join(", ")}.`)
    lines.push("", "Files that commit changes:", "", ...files.slice(0, 40).map((f) => `- \`${f}\``))
    if (e.excerpt) lines.push("", "```text", e.excerpt, "```")
  }
  writeFileSync(path.join(run, "report.md"), lines.join("\n") + "\n")
  const summary = Object.entries(found).map(([t, e]) => `${t} ${e.state}${e.firstBad ? ` at ${e.firstBad.slice(0, 12)}` : ""}`).join(", ")
  return { ok: true, targets: found, runs, summary: `report.md: ${summary}` }
})

// finish forgets the flow's workspace and deletes its checkout; runs/ and the
// step results stay.
export function finish(run) {
  const ws = workspace(run)
  if (!existsSync(ws)) return
  const { repo } = read(paths(run).options)
  sh(`jj workspace forget ${workspaceName(run)}`, repo)
  rmSync(ws, { recursive: true, force: true })
}

export const run = { prepare, reproduce, bisect, report }

// start records the run's options; the steps read them. A run directory
// answers one question: one repository, pair of commits and set of targets.
export function start(runDir, options) {
  const file = paths(runDir).options
  const o = { tries: 3, jobs: 8, ...options, targets: [...options.targets], tests: options.tests ?? {} }
  if (!o.targets.length) throw new Error("name at least one target")
  if (existsSync(file)) {
    const old = read(file)
    if (old.repo !== o.repo || old.good !== o.good || old.bad !== o.bad || old.targets.join(" ") !== o.targets.join(" ")
      || JSON.stringify(old.tests ?? {}) !== JSON.stringify(o.tests)) {
      throw new Error(`${runDir} is a run of ${old.good}..${old.bad} for ${old.targets.join(" ")}`)
    }
    return old
  }
  return save(file, o)
}
