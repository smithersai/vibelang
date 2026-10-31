// The ts-bump flow's steps. Each reads the run directory, does its work in the
// repository the run names, and writes <run>/<step>.json; a step whose result
// exists returns it, so a stopped run resumes where it stopped.
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import path from "node:path"

export const STEPS = ["fetch", "merge", "regenerate", "build", "probe", "report"]

// typescript/ is upstream's tree without these; the fork never carries them.
const EXCLUDED = ["tsc/testdata"]
// Never part of either tree: build outputs, installs, caches.
const IGNORED = new Set(["built", "node_modules", ".cache"])
const PIN = "typescript/VIBELANG.md"

// The graph targets probe runs: the compiler, the Go suites over the fork's
// packages, the tests that pin the shims' layout, and every compiler case.
export const TARGETS = [
  "//typescript:compiler",
  "//:spec-tests",
  "//:go-vibelang",
  "//:go-vibelangmapper",
  "//typescript/vibelang/..."
]

export const paths = (run) => Object.fromEntries([["options", path.join(run, "options.json")], ...STEPS.map((s) => [s, path.join(run, `${s}.json`)])])

const read = (file) => JSON.parse(readFileSync(file, "utf8"))
const save = (file, value) => {
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify(value, null, 2) + "\n")
  return value
}

function sh(command, cwd, env = {}) {
  const started = Date.now()
  const p = spawnSync("bash", ["-c", command], { cwd, env: { ...process.env, ...env }, encoding: "utf8", maxBuffer: 256 << 20 })
  const output = (p.stdout ?? "") + (p.stderr ?? "")
  return { command, cwd, code: p.status ?? 1, seconds: Math.round((Date.now() - started) / 1000), output }
}

const tail = (text, lines = 40) => text.trimEnd().split("\n").slice(-lines).join("\n")

function once(run, step, work) {
  const file = paths(run)[step]
  if (existsSync(file)) return read(file)
  return save(file, work(read(paths(run).options)))
}

// pinned reads the upstream commit typescript/VIBELANG.md records.
export function pinned(repo) {
  const text = readFileSync(path.join(repo, PIN), "utf8")
  const sha = /^\| Upstream commit \| `([0-9a-f]{40})`/m.exec(text)?.[1]
  if (!sha) throw new Error(`${PIN} has no "| Upstream commit | \`<sha>\`" row`)
  return sha
}

// resolve turns a commit, an npm dist-tag or a typescript version into a commit
// and, for npm, the version whose gitHead it is.
export function resolve(to) {
  if (/^[0-9a-f]{40}$/.test(to)) return { sha: to, version: null }
  const r = sh(`npm view typescript@${to} gitHead version --json`, process.cwd())
  if (r.code) throw new Error(`npm view typescript@${to}: ${tail(r.output, 5)}`)
  const info = JSON.parse(r.output)
  const one = Array.isArray(info) ? info.at(-1) : info
  if (!/^[0-9a-f]{40}$/.test(one?.gitHead ?? "")) throw new Error(`typescript@${to} names no gitHead`)
  return { sha: one.gitHead, version: one.version }
}

// download unpacks microsoft/TypeScript at sha into dir, without EXCLUDED.
// <dir>.complete, beside the tree, marks a finished download.
function download(sha, dir) {
  if (existsSync(`${dir}.complete`)) return
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  const excludes = EXCLUDED.map((e) => `--exclude='*/${e}'`).join(" ")
  const r = sh(`curl -fsSL https://codeload.github.com/microsoft/TypeScript/tar.gz/${sha} | tar -xz --strip-components=1 ${excludes}`, dir)
  if (r.code) throw new Error(`download ${sha}: ${tail(r.output, 5)}`)
  writeFileSync(`${dir}.complete`, sha + "\n")
}

// commitInfo reads a commit's title and date from GitHub, for the pin's row.
function commitInfo(sha) {
  const r = sh(`curl -fsSL --max-time 20 https://api.github.com/repos/microsoft/TypeScript/commits/${sha}`, process.cwd())
  try {
    const c = JSON.parse(r.output).commit
    return { title: c.message.split("\n")[0], date: c.committer.date.slice(0, 10) }
  } catch {
    return { title: "unknown", date: "unknown" }
  }
}

// fetch downloads the pinned upstream tree and the target one.
export const fetch = (run) => once(run, "fetch", ({ repo, to }) => {
  const from = pinned(repo)
  const target = resolve(to)
  for (const sha of [from, target.sha]) download(sha, path.join(run, "upstream", sha))
  const same = from === target.sha
  const { title, date } = commitInfo(target.sha)
  return { ok: true, from, to: target.sha, version: target.version, title, date, same, summary: same ? `already at ${from.slice(0, 12)}` : `${from.slice(0, 12)} -> ${target.sha.slice(0, 12)}` }
})

// files lists a tree's files, relative, without EXCLUDED and IGNORED.
export function files(root) {
  const out = new Set()
  const walk = (rel) => {
    for (const e of readdirSync(path.join(root, rel), { withFileTypes: true })) {
      const p = rel ? `${rel}/${e.name}` : e.name
      if (e.isDirectory()) {
        if (!IGNORED.has(e.name) && !EXCLUDED.includes(p) && e.name !== ".jj" && e.name !== ".git") walk(p)
      } else if (e.isFile()) out.add(p)
    }
  }
  walk("")
  return out
}

const same = (a, b) => {
  if (statSync(a).size !== statSync(b).size) return false
  return readFileSync(a).equals(readFileSync(b))
}

// classify compares base (upstream at the pin), ours (the fork) and theirs
// (upstream at the target) file by file. Exported for the tests.
export function classify(base, ours, theirs) {
  const B = files(base), O = files(ours), T = files(theirs)
  const c = { theirsOnly: [], theirsAdded: [], theirsDeleted: [], both: [], deleteModify: [], bothAdded: [], oursOnly: 0, unchanged: 0, oursAdded: 0 }
  for (const p of [...new Set([...B, ...O, ...T])].sort()) {
    const [b, o, t] = [base, ours, theirs].map((r) => path.join(r, p))
    if (!B.has(p)) {
      if (O.has(p) && T.has(p)) { if (!same(o, t)) c.bothAdded.push(p) }
      else if (O.has(p)) c.oursAdded++
      else c.theirsAdded.push(p)
      continue
    }
    const oChanged = !O.has(p) || !same(b, o)
    const tChanged = !T.has(p) || !same(b, t)
    if (!oChanged && !tChanged) c.unchanged++
    else if (!tChanged) c.oursOnly++
    else if (!oChanged) (T.has(p) ? c.theirsOnly : c.theirsDeleted).push(p)
    else if (!O.has(p) || !T.has(p)) c.deleteModify.push(p)
    else c.both.push(p)
  }
  return c
}

// merge3 merges one file both sides changed; markers name the sides.
export function merge3(base, ours, theirs, p) {
  const r = spawnSync("diff3", ["-m", "-L", "vibelang", "-L", "upstream-pinned", "-L", "upstream-target", ...[ours, base, theirs].map((r) => path.join(r, p))], { maxBuffer: 256 << 20 })
  if (r.status !== 0 && r.status !== 1) throw new Error(`diff3 ${p}: ${r.stderr}`)
  const text = r.stdout
  return { text, hunks: r.status === 1 ? text.toString().split("\n").filter((l) => l.startsWith("<<<<<<< ")).length : 0 }
}

// seams maps each upstream file the fork changes to its row in VIBELANG.md's
// "Seams in upstream files" table.
export function seams(repo) {
  const text = readFileSync(path.join(repo, PIN), "utf8")
  const out = {}
  for (const m of text.matchAll(/^\| `(tsc\/[^`]+)`[^|]*\| (.+?) \|[^|\n]*\|$/gm)) out[m[1]] = m[2]
  return out
}

// repin records the target commit as the pin, so the next bump merges from it.
export function repin(repo, to, version, title, date) {
  const file = path.join(repo, PIN)
  let text = readFileSync(file, "utf8")
  const row = /^\| Upstream commit \| .*\|$/m
  text = text.replace(row, `| Upstream commit | \`${to}\`, ${JSON.stringify(title)}, ${date} |`)
  const why = version
    ? `| Why that commit | It is the \`gitHead\` of npm \`typescript@next\` ${version} (\`npm view typescript@next gitHead version\`) |`
    : "| Why that commit | A ts-bump run named it; no npm `typescript` version was looked up |"
  text = text.replace(/^\| Why that commit \| .*\|$/m, why)
  writeFileSync(file, text)
  if (pinned(repo) !== to) throw new Error(`${PIN}: the pin still says ${pinned(repo)}`)
}

// merge applies upstream's changes since the pin to typescript/ and moves the pin.
export const merge = (run) => once(run, "merge", ({ repo }) => {
  const f = read(paths(run).fetch)
  if (f.same) return { ok: true, conflicts: [], summary: "nothing to merge" }
  const base = path.join(run, "upstream", f.from), theirs = path.join(run, "upstream", f.to), ours = path.join(repo, "typescript")
  const c = classify(base, ours, theirs)
  const put = (p, data) => { mkdirSync(path.dirname(path.join(ours, p)), { recursive: true }); writeFileSync(path.join(ours, p), data) }
  for (const p of [...c.theirsOnly, ...c.theirsAdded]) put(p, readFileSync(path.join(theirs, p)))
  for (const p of c.theirsDeleted) rmSync(path.join(ours, p))
  const conflicts = [], merged = []
  for (const p of c.both) {
    const m = merge3(base, ours, theirs, p)
    put(p, m.text)
    if (m.hunks) conflicts.push({ file: p, hunks: m.hunks })
    else merged.push(p)
  }
  repin(repo, f.to, f.version, f.title, f.date)
  const s = seams(repo)
  const seam = (p) => s[p.replace(/^typescript\//, "")] ?? null
  return {
    ok: conflicts.length === 0 && c.deleteModify.length === 0 && c.bothAdded.length === 0,
    from: f.from, to: f.to,
    updated: c.theirsOnly.length, added: c.theirsAdded.length, deleted: c.theirsDeleted.length,
    merged: merged.map((file) => ({ file, seam: seam(file) })),
    conflicts: conflicts.map((x) => ({ ...x, seam: seam(x.file) })),
    deleteModify: c.deleteModify, bothAdded: c.bothAdded,
    kept: c.oursOnly, unchanged: c.unchanged,
    summary: `${c.theirsOnly.length} updated, ${c.theirsAdded.length} added, ${c.theirsDeleted.length} deleted, ${merged.length} merged, ${conflicts.length} conflicted, ${c.deleteModify.length + c.bothAdded.length} need a hand`
  }
})

// regenerate reruns the vendored Effect rules' sync at the tag it records: it
// reapplies nothing it already applied, regenerates tsc/internal/diagnostics
// and generates the shims over the merged compiler's structs.
export const regenerate = (run) => once(run, "regenerate", ({ repo }) => {
  const upstream = readFileSync(path.join(repo, "typescript/tsc/internal/effecttsgo/UPSTREAM"), "utf8")
  const tag = /^tag: (\S+)$/m.exec(upstream)?.[1]
  if (!tag) throw new Error("effecttsgo/UPSTREAM names no tag")
  const r = sh(`sh tsc/internal/effecttsgo/sync.sh ${tag}`, path.join(repo, "typescript"), { EFFECTTSGO_WORK: path.join(run, "effecttsgo") })
  return { ok: r.code === 0, code: r.code, tag, seconds: r.seconds, output: tail(r.output), summary: r.code ? `effecttsgo sync ${tag} failed` : `effecttsgo sync ${tag}` }
})

// failures lists Go compile errors, failing Go tests and failing graph targets.
export function failures(output) {
  const out = new Set()
  for (const m of output.matchAll(/^(\S+\.go:\d+:\d+: .*)$/gm)) out.add(m[1])
  for (const m of output.matchAll(/^\s*--- FAIL: (\S+)/gm)) out.add(m[1])
  for (const m of output.matchAll(/^\s*"?(\/\/[^",\s]+)"?,[^,]+,failed/gm)) out.add(m[1])
  for (const m of output.matchAll(/^(\/\/\S+)\s+failed\b/gm)) out.add(m[1])
  return [...out]
}

// build compiles every package and test of the Go module, and the compiler.
export const build = (run) => once(run, "build", ({ repo }) => {
  const results = [
    { name: "vet", cwd: "typescript/tsc", command: "CGO_ENABLED=0 go vet ./..." },
    { name: "compiler", cwd: ".", command: "sh scripts/build-vibelang.sh" }
  ].map((b) => {
    const r = sh(b.command, path.join(repo, b.cwd))
    return { ...b, code: r.code, seconds: r.seconds, failures: r.code ? failures(r.output) : [], output: r.code ? tail(r.output) : "" }
  })
  const red = results.filter((r) => r.code)
  return { ok: red.length === 0, results, summary: red.length ? `${red.map((r) => r.name).join(", ")} failed` : "builds" }
})

// probe runs the graph targets that cover the fork, unless the build failed.
export const probe = (run) => once(run, "probe", ({ repo, targets }) => {
  if (!read(paths(run).build).ok) return { ok: false, skipped: true, results: [], summary: "skipped: the build failed" }
  const list = targets ?? TARGETS
  const r = sh(`sh scripts/ci.sh ${list.join(" ")} --jobs 8`, repo)
  const result = { name: "targets", command: `scripts/ci.sh ${list.join(" ")}`, code: r.code, seconds: r.seconds, failures: r.code ? failures(r.output) : [], output: r.code ? tail(r.output, 80) : "" }
  return { ok: r.code === 0, results: [result], summary: r.code ? `${result.failures.length} failures` : `${list.length} target patterns pass` }
})

// report writes report.md: the conflicts with the seam each one touches, the
// build's compile errors and the failing targets and tests.
export const report = (run) => once(run, "report", () => {
  const f = read(paths(run).fetch), m = read(paths(run).merge), g = read(paths(run).regenerate), b = read(paths(run).build), p = read(paths(run).probe)
  const lines = [`# TypeScript ${f.from.slice(0, 12)} -> ${f.to.slice(0, 12)}${f.version ? ` (${f.version})` : ""}: what to change`, ""]
  lines.push(`Merge: ${m.summary}. typescript/VIBELANG.md now pins ${f.to}.`, "")
  if (m.conflicts?.length) {
    lines.push("## Conflicts", "", "Each file holds diff3 markers (`vibelang`, `upstream-pinned`, `upstream-target`).", "", "| File | Hunks | Seam (VIBELANG.md) |", "| --- | --- | --- |")
    for (const c of m.conflicts) lines.push(`| \`${c.file}\` | ${c.hunks} | ${c.seam ?? "not in the seam table"} |`)
    lines.push("")
  }
  for (const [title, list] of [["Upstream deleted a file the fork changed (kept)", m.deleteModify], ["Both added a file (the fork's kept)", m.bothAdded]]) {
    if (list?.length) lines.push(`## ${title}`, "", ...list.map((x) => `- \`${x}\``), "")
  }
  if (m.merged?.length) lines.push("## Merged without conflict (review the seam)", "", ...m.merged.map((x) => `- \`${x.file}\`${x.seam ? `: ${x.seam}` : ""}`), "")
  lines.push("## Checks", "", "| Check | Result | Failures |", "| --- | --- | --- |")
  const checks = [{ name: "regenerate", code: g.code, seconds: g.seconds, failures: [], output: g.output }, ...b.results, ...p.results]
  for (const r of checks) lines.push(`| ${r.name} | ${r.code ? "fail" : "pass"} (${r.seconds} s) | ${r.failures.slice(0, 20).map((x) => "`" + x.replaceAll("|", "\\|") + "`").join(", ")} |`)
  if (p.skipped) lines.push("| targets | skipped: the build failed | |")
  for (const r of checks.filter((r) => r.code)) lines.push("", `### ${r.name}`, "", "```text", r.output, "```")
  lines.push("", "docs/maintainers/typescript-upgrade.md says what to do with each section.")
  writeFileSync(path.join(run, "report.md"), lines.join("\n") + "\n")
  const failing = [...(m.conflicts ?? []).map((c) => c.file), ...checks.flatMap((r) => r.code ? (r.failures.length ? r.failures : [r.name]) : [])]
  return { ok: failing.length === 0 && !p.skipped, failing, conflicts: (m.conflicts ?? []).map((c) => c.file), summary: `report.md: ${failing.length} findings` }
})

export const run = { fetch, merge, regenerate, build, probe, report }

// start records the run's options; the steps read them.
export function start(runDir, options) {
  const file = paths(runDir).options
  if (existsSync(file)) {
    const old = read(file)
    if (old.repo !== options.repo || old.to !== options.to) throw new Error(`${runDir} is a run to ${old.to} on ${old.repo}`)
    return old
  }
  return save(file, options)
}
