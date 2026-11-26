// The spec-review flow's steps. Each reads and writes the run directory, so a
// stopped or failed execution resumes where it stopped: a reviewer whose answer
// is saved for the same prompt is not asked again. README.md describes the run
// directory.
import { execFileSync, spawn } from "node:child_process"
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

/** The four reviewers the acceptance rule names, in the order a record lists them. */
export const REVIEWERS = { astra: "Codex Astra", sol: "Codex Sol", fable: "Claude Fable", opus: "Claude Opus" }

/** The trees a reviewer grades: the chapters and the VIPs. */
export const SPEC_PATHS = ["docs/design/src", "docs/design/vips"]

const GRADES = ["A+", "A", "A-", "B+", "B", "B-", "C+", "C", "C-", "D+", "D", "D-", "F"]
const PASSING = GRADES.indexOf("A-")

const here = path.dirname(fileURLToPath(import.meta.url))
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex")
const readJson = (file) => JSON.parse(readFileSync(file, "utf8"))
const writeJson = (file, value) => writeFileSync(file, JSON.stringify(value, null, 2) + "\n")

/** passes: the grade is A- or better. A grade the scale does not have never passes. */
export const passes = (grade) => GRADES.includes(grade) && GRADES.indexOf(grade) <= PASSING

function walk(dir, out = []) {
  for (const name of readdirSync(dir).sort()) {
    const file = path.join(dir, name)
    if (statSync(file).isDirectory()) walk(file, out)
    else out.push(file)
  }
  return out
}

/** treeDigest is the SHA-256 of every file's path and bytes under dir, in path order. */
export function treeDigest(dir) {
  const hash = createHash("sha256")
  for (const file of walk(dir)) {
    hash.update(path.relative(dir, file).split(path.sep).join("/") + "\0")
    hash.update(readFileSync(file))
    hash.update("\0")
  }
  return hash.digest("hex")
}

// jj's own messages stay out of the caller's output; a failure carries them.
const jj = (repo, args) => execFileSync("jj", ["--ignore-working-copy", ...args], { cwd: repo, maxBuffer: 1 << 28, stdio: ["ignore", "pipe", "pipe"] })

/** resolveRevision names the one commit a revision means, by its full id. */
export function resolveRevision(repo, revision) {
  const ids = jj(repo, ["log", "--no-graph", "-r", revision, "-T", 'commit_id ++ "\\n"']).toString().split("\n").filter(Boolean)
  if (ids.length !== 1) throw new Error(`revision ${revision} names ${ids.length} commits; a panel grades exactly one`)
  return ids[0]
}

/** exportSpec writes the specification as the commit has it into dir, and returns how many files it wrote. */
export function exportSpec(repo, revision, dir) {
  rmSync(dir, { recursive: true, force: true })
  const files = jj(repo, ["file", "list", "-r", revision, ...SPEC_PATHS]).toString().split("\n").filter(Boolean)
  if (files.length === 0) throw new Error(`commit ${revision} has no file under ${SPEC_PATHS.join(" or ")}`)
  for (const file of files) {
    const target = path.join(dir, file)
    mkdirSync(path.dirname(target), { recursive: true })
    writeFileSync(target, jj(repo, ["file", "show", "-r", revision, file]))
  }
  return files.length
}

/** renderPrompt fills the reviewer prompt for one reviewer and one snapshot. */
export const renderPrompt = (template, reviewer, snapshot) =>
  template.replaceAll("@REVIEWER@", REVIEWERS[reviewer]).replaceAll("@REVISION@", snapshot.revision).replaceAll("@SPEC_DIGEST@", snapshot.specDigest)

/**
 * snapshot fixes what the panel grades: the commit's full id and its
 * specification, exported to <run>/spec. A run directory holds one revision; a
 * second execution reuses the export when its bytes still match.
 */
export function snapshot(run, repo, revision, template = readFileSync(path.join(here, "../prompt.md"), "utf8")) {
  mkdirSync(run, { recursive: true })
  const id = resolveRevision(repo, revision)
  const file = path.join(run, "snapshot.json")
  const spec = path.join(run, "spec")
  if (existsSync(file)) {
    const saved = readJson(file)
    if (saved.revision !== id) throw new Error(`${run} holds the panel for ${saved.revision}; use a new run directory for ${id}`)
    if (existsSync(spec) && treeDigest(spec) === saved.specDigest && saved.template === template) return { ok: true, summary: `reused the export of ${id}`, ...saved }
  }
  const files = exportSpec(repo, id, spec)
  const saved = { revision: id, specDigest: treeDigest(spec), files, template }
  writeJson(file, saved)
  return { ok: true, summary: `exported ${files} files of ${id}`, ...saved }
}

/**
 * parseAnswer reads a reviewer's verdict, grade and graded revision. Each is
 * one line of its own, written exactly once; anything else is the report.
 */
export function parseAnswer(text) {
  const one = (name, pattern) => {
    const found = text.split(/\r?\n/).flatMap((line) => {
      const match = new RegExp(`^${name}: (${pattern})\\s*$`).exec(line)
      return match ? [match[1]] : []
    })
    if (found.length !== 1) throw new Error(`the answer has ${found.length} valid ${name} lines; it needs exactly one`)
    return found[0]
  }
  return { verdict: one("VERDICT", "LGTM|CHANGES"), grade: one("GRADE", "[A-D][+-]?|F"), revision: one("REVISION", "[0-9a-f]{40}") }
}

const reviewerDir = (run, reviewer) => path.join(run, "reviewers", reviewer)

/**
 * prepare returns the reviewer's saved opinion when it answered this prompt
 * before, and otherwise the prompt to ask and the directory to ask it in.
 */
export function prepare(run, reviewer) {
  if (!Object.hasOwn(REVIEWERS, reviewer)) throw new Error(`unknown reviewer ${reviewer}; the panel is ${Object.keys(REVIEWERS).join(", ")}`)
  const saved = readJson(path.join(run, "snapshot.json"))
  const prompt = renderPrompt(saved.template, reviewer, saved)
  const dir = reviewerDir(run, reviewer)
  mkdirSync(dir, { recursive: true })
  writeFileSync(path.join(dir, "prompt.md"), prompt)
  const file = path.join(dir, "opinion.json")
  if (existsSync(file)) {
    const { prompt: asked, ...opinion } = readJson(file)
    const answer = path.join(dir, "answer.md")
    if (asked === sha256(prompt) && opinion.verdict !== "none" && existsSync(answer)) {
      const bytes = readFileSync(answer)
      if (sha256(bytes) === opinion.answer) {
        return { opinion: { ...opinion, ...parseAnswer(bytes.toString("utf8")), reviewer } }
      }
    }
  }
  return { prompt, cwd: path.join(run, "spec") }
}

/**
 * settle saves what the reviewer said and returns its opinion. A reviewer that
 * failed, or whose answer has no single verdict, grade and revision, gets the
 * verdict "none": the panel records it and cannot pass, and the next execution
 * asks that reviewer again.
 */
export function settle(run, reviewer, result) {
  const dir = reviewerDir(run, reviewer)
  const prompt = sha256(readFileSync(path.join(dir, "prompt.md")))
  const none = (problem, answer = "") => ({ reviewer, verdict: "none", grade: "", revision: "", answer, problem })
  let opinion
  if (result.failure !== undefined) opinion = none(result.failure)
  else {
    writeFileSync(path.join(dir, "answer.md"), result.answer)
    const answer = sha256(result.answer)
    try {
      opinion = { reviewer, ...parseAnswer(result.answer), answer, problem: "" }
    } catch (error) {
      opinion = none(error.message, answer)
    }
  }
  writeJson(path.join(dir, "opinion.json"), { ...opinion, prompt })
  return opinion
}

/**
 * tally applies the acceptance rule: every one of the four reviewers answers
 * LGTM with a grade of A- or better on the panel's revision.
 */
export function tally(opinions, revision) {
  const rows = Object.keys(REVIEWERS).map((reviewer) => {
    const opinion = opinions[reviewer]
    if (opinion === undefined) return { reviewer, verdict: "none", grade: "", answer: "", pass: false, reason: "did not review" }
    const reason = opinion.verdict === "none" ? opinion.problem || "did not answer"
      : opinion.revision !== revision ? `graded ${opinion.revision}, not the panel's revision`
      : opinion.verdict !== "LGTM" ? "asked for changes"
      : !passes(opinion.grade) ? "graded below A-"
      : ""
    return { reviewer, verdict: opinion.verdict, grade: opinion.grade, answer: opinion.answer, pass: reason === "", reason }
  })
  return { accepted: rows.every((row) => row.pass), rows }
}

const cell = (text) => text.replaceAll("|", "\\|").replace(/\s+/g, " ").trim()

// A reviewer that gave no answer failed outside the flow: its command was
// missing or exited non-zero. What the command printed can name hosts, paths
// and request ids, so the record says only that no answer came; the outcome
// and panel.json in the run directory carry the full reason.
const recorded = (row) => (row.verdict === "none" && row.answer === "" ? "did not answer" : row.reason)

/** renderRecord is the panel's checked-in record: who graded what, and whether the specification passed. */
export function renderRecord(panel) {
  const lines = [
    "<!-- Written by the spec-review flow (.smithers/flows/spec-review). Do not edit: run the flow again. -->",
    "",
    `# Specification panel at ${panel.revision.slice(0, 12)}`,
    "",
    panel.accepted
      ? "**Passed.** All four reviewers answered LGTM with a grade of A- or better on this revision."
      : "**Not passed.** The specification passes when all four reviewers answer LGTM with a grade of A- or better on this revision.",
    "",
    "| Reviewer | Verdict | Grade | Counts | Answer (SHA-256) |",
    "| --- | --- | --- | --- | --- |",
    ...panel.rows.map((row) =>
      `| ${REVIEWERS[row.reviewer]} | ${row.verdict} | ${row.grade || "none"} | ${row.pass ? "yes" : `no: ${cell(recorded(row))}`} | ${row.answer ? `\`${row.answer}\`` : "none"} |`),
    "",
    "| | |",
    "| --- | --- |",
    `| Revision | \`${panel.revision}\` |`,
    `| Specification (SHA-256 of the ${panel.files} files under \`docs/design/src\` and \`docs/design/vips\`) | \`${panel.specDigest}\` |`,
    `| Reviewer prompt (SHA-256) | \`${panel.promptDigest}\` |`,
    `| Recorded | ${panel.date} |`,
    ""
  ]
  return lines.join("\n")
}

/**
 * record tallies the opinions and writes panel.json and panel.md in the run
 * directory. With a record directory it also writes <revision, 12 digits>.md
 * there, the file an acceptance statement links to.
 */
export function record(run, opinions, recordDir, now) {
  const saved = readJson(path.join(run, "snapshot.json"))
  const { accepted, rows } = tally(opinions, saved.revision)
  const panel = {
    revision: saved.revision,
    specDigest: saved.specDigest,
    files: saved.files,
    promptDigest: sha256(saved.template),
    date: new Date(now).toISOString().slice(0, 10),
    accepted,
    rows
  }
  writeJson(path.join(run, "panel.json"), panel)
  const text = renderRecord(panel)
  writeFileSync(path.join(run, "panel.md"), text)
  let written = ""
  if (recordDir !== "") {
    mkdirSync(recordDir, { recursive: true })
    written = path.join(recordDir, `${saved.revision.slice(0, 12)}.md`)
    writeFileSync(written, text)
  }
  return {
    accepted,
    revision: saved.revision,
    grades: Object.fromEntries(rows.map((row) => [row.reviewer, row.grade])),
    problems: Object.fromEntries(rows.filter((row) => !row.pass).map((row) => [row.reviewer, row.reason])),
    record: written
  }
}

/**
 * ask runs a reviewer's command in cwd with the prompt on standard input and
 * resolves to its standard output. It rejects when the command cannot start,
 * exits non-zero, or the signal aborts. The command is a shell line, so it
 * runs as its own process group, and an abort stops the whole group: stopping
 * the shell alone would leave the agent it started running.
 */
export function ask(command, prompt, cwd, signal) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, { cwd, shell: true, detached: true, stdio: ["pipe", "pipe", "pipe"] })
    const out = []
    const err = []
    const stop = () => process.kill(-child.pid, "SIGTERM")
    signal?.addEventListener("abort", stop, { once: true })
    child.stdout.on("data", (chunk) => out.push(chunk))
    child.stderr.on("data", (chunk) => err.push(chunk))
    child.stdin.on("error", () => {})
    child.on("error", reject)
    child.on("close", (code, killed) => {
      signal?.removeEventListener("abort", stop)
      if (code === 0) resolve(Buffer.concat(out).toString("utf8"))
      else {
        // Some agents report a failure, such as a missing login, on standard output.
        const said = Buffer.concat(err).toString("utf8").trim() || Buffer.concat(out).toString("utf8").trim()
        reject(new Error(`${command} ${killed ? `was stopped by ${killed}` : `exited ${code}`}: ${said.slice(-400)}`))
      }
    })
    child.stdin.end(prompt)
  })
}
