import assert from "node:assert/strict"
import { execFileSync, spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { after, test } from "node:test"
import { fileURLToPath } from "node:url"
import { Effect, Exit, Layer } from "effect"
import { ReviewerFailed, Reviewers } from "../flow.ts"
import { execute } from "../run.ts"
import { ask, parseAnswer, passes, record, renderRecord, REVIEWERS, snapshot, tally, treeDigest } from "../lib/steps.mjs"

const here = path.dirname(fileURLToPath(import.meta.url))
const fixture = path.join(here, "fixture/reviewer.mjs")
const reviewerCommand = (...args) => [process.execPath, fixture, ...args].map((arg) => `'${arg}'`).join(" ")
const names = Object.keys(REVIEWERS)

const temp = mkdtempSync(path.join(tmpdir(), "spec-review-"))
after(() => rmSync(temp, { recursive: true, force: true }))
let counter = 0
const fresh = (name) => path.join(temp, `${name}-${counter++}`)

const jj = (repo, ...args) => execFileSync("jj", args, { cwd: repo, stdio: ["ignore", "pipe", "ignore"] }).toString()

// A jj repository whose first commit holds a two-file specification, and whose
// working copy has since changed a chapter and added one.
function repository() {
  const repo = fresh("repo")
  mkdirSync(path.join(repo, "docs/design/src"), { recursive: true })
  mkdirSync(path.join(repo, "docs/design/vips"), { recursive: true })
  jj(repo, "git", "init")
  writeFileSync(path.join(repo, "docs/design/src/001-intro.md"), "# Intro\n")
  writeFileSync(path.join(repo, "docs/design/vips/README.md"), "# VIPs\n")
  writeFileSync(path.join(repo, "README.md"), "not the specification\n")
  const revision = jj(repo, "log", "--no-graph", "-r", "@", "-T", "commit_id").trim()
  writeFileSync(path.join(repo, "docs/design/src/001-intro.md"), "# Intro, edited after the commit\n")
  writeFileSync(path.join(repo, "docs/design/src/002-later.md"), "# Later\n")
  jj(repo, "status")
  return { repo, revision }
}

const answer = (verdict, grade, revision) => `VERDICT: ${verdict}\nGRADE: ${grade}\nREVISION: ${revision}\n\nOne sentence.\n`

// scripted answers each reviewer from a table of [verdict, grade] or a failure
// message, and counts who was asked.
function scripted(table, revision) {
  const asked = []
  const layer = Layer.succeed(Reviewers, {
    ask: (reviewer, prompt, cwd) => {
      asked.push(reviewer)
      assert.ok(prompt.includes(REVIEWERS[reviewer]) && prompt.includes(revision), "the prompt names the reviewer and the revision")
      assert.ok(existsSync(path.join(cwd, "docs/design/src/001-intro.md")), "the reviewer works in the exported specification")
      const entry = table[reviewer]
      return typeof entry === "string" ? Effect.fail(new ReviewerFailed({ reviewer, message: entry })) : Effect.succeed(answer(entry[0], entry[1], entry[2] ?? revision))
    }
  })
  return { asked, layer }
}

const value = (exit) => {
  assert.ok(Exit.isSuccess(exit), JSON.stringify(exit))
  return exit.value
}

const passing = { astra: ["LGTM", "A"], sol: ["LGTM", "A"], fable: ["LGTM", "A-"], opus: ["LGTM", "A-"] }

test("a grade passes at A- or better, and a grade off the scale never passes", () => {
  assert.deepEqual(["A+", "A", "A-"].map(passes), [true, true, true])
  assert.deepEqual(["B+", "B", "C-", "F", "", "A--", "E", "a"].map(passes), [false, false, false, false, false, false, false, false])
})

test("parseAnswer reads one verdict, one grade and one revision, each on its own line", () => {
  const revision = "0123456789abcdef0123456789abcdef01234567"
  assert.deepEqual(parseAnswer(`Preamble.\r\nVERDICT: LGTM\r\nGRADE: A-  \r\nREVISION: ${revision}\r\n\r\nNo findings.`), { verdict: "LGTM", grade: "A-", revision })
  assert.deepEqual(parseAnswer(answer("CHANGES", "B+", revision)), { verdict: "CHANGES", grade: "B+", revision })
  assert.deepEqual(parseAnswer(answer("CHANGES", "F", revision)).grade, "F")
  assert.throws(() => parseAnswer(answer("LGTM", "A", revision) + answer("LGTM", "A", revision)), /2 valid VERDICT lines/)
  assert.throws(() => parseAnswer(answer("lgtm", "A", revision)), /0 valid VERDICT lines/)
  assert.throws(() => parseAnswer(answer("LGTM", "A-ish", revision)), /0 valid GRADE lines/)
  assert.throws(() => parseAnswer(answer("LGTM", "F+", revision)), /0 valid GRADE lines/)
  assert.throws(() => parseAnswer(answer("LGTM", "A", "0123456789ab")), /0 valid REVISION lines/)
  assert.throws(() => parseAnswer(`The verdict is VERDICT: LGTM\nGRADE: A\nREVISION: ${revision}`), /0 valid VERDICT lines/)
})

test("tally passes only when all four answer LGTM with A- or better on the panel's revision", () => {
  const revision = "a".repeat(40)
  const opinion = (reviewer, verdict, grade, graded = revision) => ({ reviewer, verdict, grade, revision: graded, answer: "0".repeat(64), problem: "" })
  const panelOf = (changes = {}) => ({ ...Object.fromEntries(names.map((name) => [name, opinion(name, "LGTM", name === "opus" ? "A-" : "A")])), ...changes })
  assert.equal(tally(panelOf(), revision).accepted, true)
  const reasons = (opinions) => {
    const result = tally(opinions, revision)
    assert.equal(result.accepted, false)
    return result.rows.filter((row) => !row.pass).map((row) => `${row.reviewer}: ${row.reason}`)
  }
  assert.deepEqual(reasons(panelOf({ sol: opinion("sol", "LGTM", "B+") })), ["sol: graded below A-"])
  assert.deepEqual(reasons(panelOf({ fable: opinion("fable", "CHANGES", "A") })), ["fable: asked for changes"])
  assert.deepEqual(reasons(panelOf({ astra: opinion("astra", "LGTM", "A", "b".repeat(40)) })), [`astra: graded ${"b".repeat(40)}, not the panel's revision`])
  assert.deepEqual(reasons(panelOf({ opus: { reviewer: "opus", verdict: "none", grade: "", revision: "", answer: "", problem: "the command exited 3" } })), ["opus: the command exited 3"])
  const { sol, ...three } = panelOf()
  assert.deepEqual(reasons(three), ["sol: did not review"])
  assert.deepEqual(tally({ ...panelOf(), extra: opinion("extra", "CHANGES", "F") }, revision).rows.map((row) => row.reviewer), names)
})

test("renderRecord keeps a command's output out of the record, and an answer's problem inside its table cell", () => {
  const rows = tally({ astra: { reviewer: "astra", verdict: "none", grade: "", revision: "", answer: "", problem: "exited 1: a | b\nsecond line" } }, "a".repeat(40)).rows
  const text = renderRecord({ revision: "a".repeat(40), specDigest: "d", files: 2, promptDigest: "p", date: "2026-01-02", accepted: false, rows })
  assert.ok(text.includes("| Codex Astra | none | none | no: did not answer | none |"), text)
  const unread = tally({ sol: { reviewer: "sol", verdict: "none", grade: "", revision: "", answer: "0".repeat(64), problem: "a | b\nsecond line" } }, "a".repeat(40)).rows
  assert.ok(renderRecord({ revision: "a".repeat(40), specDigest: "d", files: 2, promptDigest: "p", date: "2026-01-02", accepted: false, rows: unread }).includes("| Codex Sol | none | none | no: a \\| b second line | `"))
  assert.ok(text.includes("**Not passed.**") && text.includes("| Recorded | 2026-01-02 |"))
})

test("snapshot exports the specification as the commit has it, not the working copy", () => {
  const { repo, revision } = repository()
  const run = fresh("run")
  const first = snapshot(run, repo, revision, "template")
  assert.equal(first.revision, revision)
  assert.equal(first.files, 2)
  assert.equal(readFileSync(path.join(run, "spec/docs/design/src/001-intro.md"), "utf8"), "# Intro\n")
  assert.ok(!existsSync(path.join(run, "spec/docs/design/src/002-later.md")) && !existsSync(path.join(run, "spec/README.md")))
  assert.equal(first.specDigest, treeDigest(path.join(run, "spec")))

  assert.match(snapshot(run, repo, revision, "template").summary, /^reused/)
  writeFileSync(path.join(run, "spec/docs/design/src/001-intro.md"), "tampered\n")
  const again = snapshot(run, repo, revision, "template")
  assert.match(again.summary, /^exported 2 files/)
  assert.equal(again.specDigest, first.specDigest)
  assert.match(snapshot(run, repo, revision, "a new template").summary, /^exported/)

  assert.throws(() => snapshot(run, repo, "@", "template"), /holds the panel for .*use a new run directory/)
  assert.throws(() => snapshot(fresh("run"), repo, "all()", "template"), /names \d+ commits; a panel grades exactly one/)
  assert.throws(() => snapshot(fresh("run"), repo, "root()", "template"), /has no file under docs\/design\/src or docs\/design\/vips/)
})

test("the flow runs the four-reviewer panel on a revision and records each grade", async () => {
  const { repo, revision } = repository()
  const run = fresh("run")
  const recordDir = fresh("records")
  const reviewers = scripted(passing, revision)
  const outcome = value(await execute({ run, repo, revision, record: recordDir }, reviewers.layer))
  assert.deepEqual(outcome, { accepted: true, revision, grades: { astra: "A", sol: "A", fable: "A-", opus: "A-" }, problems: {}, record: path.join(recordDir, `${revision.slice(0, 12)}.md`) })
  assert.deepEqual([...reviewers.asked].sort(), [...names].sort())

  const text = readFileSync(outcome.record, "utf8")
  assert.ok(text.includes("**Passed.**") && text.includes(`| Revision | \`${revision}\` |`), text)
  for (const [name, grade] of Object.entries(outcome.grades)) assert.ok(text.includes(`| ${REVIEWERS[name]} | LGTM | ${grade} | yes | \``), text)
  assert.equal(text, readFileSync(path.join(run, "panel.md"), "utf8"))
  assert.equal(readFileSync(path.join(run, "reviewers/fable/answer.md"), "utf8"), answer("LGTM", "A-", revision))

  // A second execution on the same run directory replays the panel from the
  // saved answers: no reviewer is asked again.
  const replay = scripted({}, revision)
  assert.deepEqual(value(await execute({ run, repo, revision, record: "" }, replay.layer)), { ...outcome, record: "" })
  assert.deepEqual(replay.asked, [])
})

test("a failed reviewer leaves the panel not passed, and the next execution asks only that reviewer", async () => {
  const { repo, revision } = repository()
  const run = fresh("run")
  const recordDir = fresh("records")
  const first = value(await execute({ run, repo, revision, record: recordDir }, scripted({ ...passing, sol: "the model refused: usage limit" }, revision).layer))
  assert.equal(first.accepted, false)
  assert.deepEqual(first.grades, { astra: "A", sol: "", fable: "A-", opus: "A-" })
  assert.deepEqual(first.problems, { sol: "the model refused: usage limit" })
  assert.ok(readFileSync(first.record, "utf8").includes("| Codex Sol | none | none | no: did not answer | none |"))
  assert.ok(!readFileSync(first.record, "utf8").includes("usage limit"))

  const retry = scripted(passing, revision)
  const second = value(await execute({ run, repo, revision, record: recordDir }, retry.layer))
  assert.deepEqual(retry.asked, ["sol"])
  assert.equal(second.accepted, true)
  assert.ok(readFileSync(second.record, "utf8").includes("**Passed.**"))
})

test("a low grade, a request for changes, another revision or an unreadable answer each stop the panel", async () => {
  const { repo, revision } = repository()
  const cases = [
    [{ ...passing, opus: ["LGTM", "B+"] }, "| Claude Opus | LGTM | B+ | no: graded below A- |"],
    [{ ...passing, astra: ["CHANGES", "A"] }, "| Codex Astra | CHANGES | A | no: asked for changes |"],
    [{ ...passing, fable: ["LGTM", "A", "c".repeat(40)] }, `| Claude Fable | LGTM | A | no: graded ${"c".repeat(40)}, not the panel's revision |`],
    [{ ...passing, sol: ["Looks good", "A"] }, "| Codex Sol | none | none | no: the answer has 0 valid VERDICT lines; it needs exactly one | `"]
  ]
  for (const [table, row] of cases) {
    const run = fresh("run")
    const outcome = value(await execute({ run, repo, revision, record: "" }, scripted(table, revision).layer))
    assert.equal(outcome.accepted, false)
    assert.ok(readFileSync(path.join(run, "panel.md"), "utf8").includes(row), readFileSync(path.join(run, "panel.md"), "utf8"))
  }
})

test("a revision the repository does not have fails the flow before any reviewer is asked", async () => {
  const { repo, revision } = repository()
  const reviewers = scripted(passing, revision)
  const exit = await execute({ run: fresh("run"), repo, revision: "no-such-bookmark", record: "" }, reviewers.layer)
  assert.ok(Exit.isFailure(exit))
  assert.match(JSON.stringify(exit.cause), /StepFailed.*snapshot/)
  assert.deepEqual(reviewers.asked, [])
})

test("record refuses to tally before the snapshot exists", () => {
  assert.throws(() => record(fresh("run"), {}, "", 0), /snapshot\.json/)
})

test("ask gives the command the prompt and the directory, reports a failure's output, and stops with its signal", async () => {
  const { repo, revision } = repository()
  const run = fresh("run")
  snapshot(run, repo, revision, "REVISION: @REVISION@\n")
  const spec = path.join(run, "spec")
  assert.equal(await ask(reviewerCommand("LGTM", "A"), `REVISION: ${revision}\n`, spec), `${answer("LGTM", "A", revision).trimEnd().replace("One sentence.", "Read the chapters here: true.")}\n`)
  await assert.rejects(ask(reviewerCommand("--fail", "no credit left"), "", spec), /exited 3: no credit left/)
  await assert.rejects(ask(reviewerCommand("--refuse", "Not logged in"), "", spec), /exited 1: Not logged in/)

  const started = path.join(fresh("hang"))
  const controller = new AbortController()
  const hung = ask(reviewerCommand("--hang", started), "", spec, controller.signal)
  while (!existsSync(started)) await new Promise((resolve) => setTimeout(resolve, 20))
  controller.abort()
  await assert.rejects(hung, /was stopped by SIGTERM/)
})

test("the command line asks each reviewer's configured command, and its exit code says whether the panel passed", () => {
  const { repo, revision } = repository()
  const cli = (run, env) => spawnSync(process.execPath, [path.join(here, "../run.ts"), "--run", run, "--repo", repo, "--revision", revision], { encoding: "utf8", env: { ...process.env, ...env } })
  const agents = (grade) => Object.fromEntries(names.map((name) => [`SPEC_REVIEW_AGENT_${name.toUpperCase()}`, reviewerCommand("LGTM", grade)]))

  const run = fresh("run")
  const { SPEC_REVIEW_AGENT_OPUS: opus, ...three } = agents("A")
  const missing = cli(run, { ...three, SPEC_REVIEW_AGENT_OPUS: "" })
  assert.equal(missing.status, 1, missing.stderr)
  assert.deepEqual(JSON.parse(missing.stdout).problems, { opus: "SPEC_REVIEW_AGENT_OPUS is not set" })
  assert.ok(readFileSync(path.join(run, "panel.md"), "utf8").includes("| Claude Opus | none | none | no: did not answer | none |"))

  const failing = cli(run, { ...three, SPEC_REVIEW_AGENT_OPUS: reviewerCommand("--fail", "no credit left") })
  assert.equal(failing.status, 1, failing.stderr)
  assert.match(JSON.parse(failing.stdout).problems.opus, /exited 3: no credit left$/)

  const passed = cli(run, { ...three, SPEC_REVIEW_AGENT_OPUS: opus })
  assert.equal(passed.status, 0, passed.stderr)
  assert.deepEqual(JSON.parse(passed.stdout), { accepted: true, revision, grades: { astra: "A", sol: "A", fable: "A", opus: "A" }, problems: {}, record: "" })

  const low = cli(fresh("run"), agents("B"))
  assert.equal(low.status, 1, low.stderr)

  const absent = spawnSync(process.execPath, [path.join(here, "../run.ts"), "--run", fresh("run"), "--repo", repo, "--revision", "no-such-bookmark"], { encoding: "utf8" })
  assert.equal(absent.status, 2)
  assert.match(absent.stderr, /spec-review: .*StepFailed.*snapshot/)

  const usage = spawnSync(process.execPath, [path.join(here, "../run.ts"), "--run", fresh("run")], { encoding: "utf8" })
  assert.equal(usage.status, 2)
  assert.match(usage.stderr, /^usage: /)
})
