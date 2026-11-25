// VIP-59: `vibelang eval` finds *.eval.vibe files, imports them through the
// Node loader and runs their suites with the runtime's Experimental.Eval.
// The quoted rules are docs/design/vips/0059-eval-declarations.md, Rules.
import { requireOrSkip } from "./prerequisites.mjs"
import { strict as assert } from "node:assert"
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import { baselinePath, discover, isEvalFile, main, parseArguments, recordingPath } from "../eval.mjs"

const repo = fileURLToPath(new URL("../../../", import.meta.url))
const cli = fileURLToPath(new URL("../bin/vibelang", import.meta.url))
const native = process.env.VIBELANG_BINARY || join(repo, "typescript/built/local/tsc")
const effect = join(process.env.EFFECT_NODE_MODULES || join(repo, "experiments/node_modules"), "effect")
const runtime = process.env.VIBELANG_RUNTIME || join(repo, "packages/runtime")
const missing = [native, effect, join(runtime, "dist/experimental/Eval.js")].find((path) => !existsSync(path))
const skip = requireOrSkip(missing !== undefined && `run typescript/vibelang/smoke.sh first; missing ${missing}`)
const vip = readFileSync(join(repo, "docs/design/vips/0059-eval-declarations.md"), "utf8")

const tsconfig = JSON.stringify({
  compilerOptions: {
    target: "ES2022", module: "NodeNext", moduleResolution: "NodeNext", strict: true, types: [], skipLibCheck: true,
    allowImportingTsExtensions: true, rewriteRelativeImportExtensions: true, noEmit: true
  },
  include: ["src/**/*"],
  vibe: { experimental: ["builtins"] }
})

const greet = `effect function greet(name: string) {
  return \`Hello, \${name}\`
}

export default Experimental.Eval.suite("greet", {
  target: greet,
  cases: [{ name: "ada", input: ["Ada"], expected: "Hello, Ada" }],
  scorers: [Experimental.Scorer.exact]
})
`

// A target that asks a model, and the live model \`--live\` calls: it answers
// "Paris" and appends a line to live-calls.log, so a test counts real calls.
const model = `import { appendFileSync } from "node:fs"
import { Effect, Layer, Stream } from "effect"
import { LanguageModel } from "effect/ai"

export const ask = (question: string) =>
  Effect.map(LanguageModel.generateText({ prompt: question }), (reply) => reply.text)

export const scripted = Layer.effect(
  LanguageModel.LanguageModel,
  LanguageModel.make({
    generateText: () =>
      Effect.sync(() => {
        appendFileSync(new URL("../live-calls.log", import.meta.url), "call\\n")
        return [{ type: "text" as const, text: process.env.EVAL_TEST_ANSWER ?? "Paris" }]
      }),
    streamText: () => Stream.empty
  })
)
`

const capital = `import { ask, scripted } from "./model.ts"

export const live = scripted

export default Experimental.Eval.suite("capital", {
  target: ask,
  cases: [{ name: "france", input: ["What is the capital of France?"], expected: "Paris" }],
  scorers: [Experimental.Scorer.exact]
})
`

function project(t, files) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "vibelang-eval-")))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  mkdirSync(join(root, "node_modules"))
  if (existsSync(effect)) symlinkSync(realpathSync(effect), join(root, "node_modules/effect"))
  symlinkSync(runtime, join(root, "node_modules/vibelang-runtime"))
  for (const [path, text] of Object.entries({ "package.json": '{"type":"module"}', "tsconfig.json": tsconfig, ...files })) {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), text)
  }
  const run = (args = [], env = {}) => {
    const result = spawnSync(process.execPath, [cli, "eval", ...args], {
      cwd: root, encoding: "utf8",
      env: { ...process.env, VIBELANG_BINARY: native, VIBELANG_PROJECT: "", VIBELANG_CACHE_DIR: join(root, ".cache"), ...env }
    })
    return { ...result, text: `exit ${result.status}\n--- stdout\n${result.stdout}--- stderr\n${result.stderr}` }
  }
  const read = (path) => readFileSync(join(root, path), "utf8")
  const liveCalls = () => existsSync(join(root, "live-calls.log")) ? read("live-calls.log").trim().split("\n").length : 0
  return { root, run, read, liveCalls, exists: (path) => existsSync(join(root, path)) }
}

// ---------------------------------------------------------------------------
// The command line and discovery: no compiler needed.
// ---------------------------------------------------------------------------

test("VIP-59 names the command, its flags and its exit codes", () => {
  assert.ok(vip.includes("The toolchain learns one file kind and one command, `vibelang eval`, with `--list`, `--live`, `--update` and `--trials`."))
  assert.ok(vip.includes("A file named `*.eval.vibe` or `*.eval.vibex` is an eval file."))
  assert.ok(vip.includes("exit code    0 pass, 1 fail                       0 pass, 1 regressed, 5 could not decide"))
})

test("an eval file is named *.eval.vibe or *.eval.vibex", () => {
  for (const name of ["greet.eval.vibe", "src/greet.eval.vibex", "/a/b.c.eval.vibe"]) assert.equal(isEvalFile(name), true, name)
  for (const name of ["greet.vibe", "greet.test.vibe", "eval.vibe", "greet.eval.ts", "greet.eval.vibe.ts", "greet.eval.vibexx", "greet.evaluvibe"]) {
    assert.equal(isEvalFile(name), false, name)
  }
  assert.equal(baselinePath("/p/src/greet.eval.vibe"), "/p/src/greet.eval.baseline.json")
  assert.equal(baselinePath("/p/src/card.eval.vibex"), "/p/src/card.eval.baseline.json")
  assert.equal(recordingPath("/p/src/greet.eval.vibe"), "/p/src/greet.eval.recording.json")
})

test("the flags parse, and --trials above 1 requires --live", () => {
  assert.deepEqual(parseArguments([]), { list: false, live: false, update: false, trials: undefined, help: false, paths: [] })
  assert.deepEqual(parseArguments(["--live", "--update", "--trials", "3", "src"]),
    { list: false, live: true, update: true, trials: 3, help: false, paths: ["src"] })
  assert.equal(parseArguments(["--trials=1"]).trials, 1)
  assert.equal(parseArguments(["--live", "--trials=4"]).trials, 4)
  assert.deepEqual(parseArguments(["--list", "--", "--odd"]).paths, ["--odd"])
  assert.throws(() => parseArguments(["--trials", "2"]), /--trials 2 requires --live/)
  assert.throws(() => parseArguments(["--trials=3"]), /requires --live/)
  for (const bad of [["--trials"], ["--trials", "0"], ["--trials", "1.5"], ["--trials", "-2"], ["--trials=x"]]) {
    assert.throws(() => parseArguments(bad), /--trials needs a positive integer/, bad.join(" "))
  }
  assert.throws(() => parseArguments(["--watch"]), /unknown option --watch/)
  assert.throws(() => parseArguments(["--list", "--live"]), /--list runs nothing/)
  assert.throws(() => parseArguments(["--list", "--update"]), /--list runs nothing/)
})

test("discovery finds eval files by name, sorted, and skips node_modules, dot directories and build output", (t) => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "vibelang-eval-discover-")))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  for (const file of [
    "src/b.eval.vibe", "src/a.eval.vibe", "src/ui/card.eval.vibex", "src/a.vibe", "src/a.test.vibe", "src/a.eval.baseline.json",
    "node_modules/pkg/x.eval.vibe", ".cache/y.eval.vibe", "dist/z.eval.vibe", "other/c.eval.vibe"
  ]) {
    mkdirSync(dirname(join(root, file)), { recursive: true })
    writeFileSync(join(root, file), "")
  }
  const names = (paths) => discover(paths, root).map((file) => file.slice(root.length + 1))
  assert.deepEqual(names([]), ["other/c.eval.vibe", "src/a.eval.vibe", "src/b.eval.vibe", "src/ui/card.eval.vibex"])
  assert.deepEqual(names(["src/ui", "src/b.eval.vibe", "src/ui/card.eval.vibex"]), ["src/b.eval.vibe", "src/ui/card.eval.vibex"])
  assert.throws(() => discover(["src/a.vibe"], root), /src\/a\.vibe is not an eval file/)
  assert.throws(() => discover(["nowhere"], root), /no such file or directory: nowhere/)
})

test("a wrong command line exits 2 with the usage, and runs nothing", async (t) => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "vibelang-eval-usage-")))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  for (const [args, message] of [
    [["--trials", "3"], /--trials 3 requires --live/],
    [["--nope"], /unknown option --nope/],
    [["missing-directory"], /no such file or directory/]
  ]) {
    const lines = []
    assert.equal(await main(args, { cwd: root, stdout: (line) => lines.push(line), stderr: (line) => lines.push(line) }), 2)
    assert.match(lines.join("\n"), message)
    assert.match(lines.join("\n"), /Usage: vibelang eval/)
  }
  const result = spawnSync(process.execPath, [cli, "eval", "--trials", "2"], { cwd: root, encoding: "utf8" })
  assert.equal(result.status, 2, result.stderr)
  assert.match(result.stderr, /--trials 2 requires --live/)
  const help = spawnSync(process.execPath, [cli, "eval", "--help"], { cwd: root, encoding: "utf8" })
  assert.equal(help.status, 0, help.stderr)
  for (const flag of ["--list", "--live", "--update", "--trials N"]) assert.ok(help.stdout.includes(flag), flag)
})

test("a run that finds no eval file cannot decide (5); a listing of none is empty (0)", async (t) => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "vibelang-eval-empty-")))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  writeFileSync(join(root, "main.vibe"), "export const value = 1\n")
  const errors = []
  const io = { cwd: root, stdout: () => {}, stderr: (line) => errors.push(line) }
  assert.equal(await main([], io), 5)
  assert.match(errors.join("\n"), /no \*\.eval\.vibe or \*\.eval\.vibex file under the working directory/)
  assert.equal(await main(["--list"], io), 0)
})

// ---------------------------------------------------------------------------
// Running: the compiler, the runtime and effect.
// ---------------------------------------------------------------------------

test("--list prints suites and cases and calls no target (rule 5)", { skip }, (t) => {
  const { run, exists } = project(t, {
    "src/greet.eval.vibe": greet,
    // A target that would leave a file behind if discovery ran it.
    "src/touch.ts": `import { writeFileSync } from "node:fs"
import { Effect } from "effect"
export const touch = (name: string) =>
  Effect.sync(() => {
    writeFileSync(new URL("../ran.txt", import.meta.url), name)
    return name
  })
`,
    "src/touch.eval.vibe": `import { touch } from "./touch.ts"
export default [
  Experimental.Eval.suite("touch", { target: touch, cases: [{ name: "one", input: ["1"] }, { name: "two", input: ["2"] }], scorers: [] }),
  Experimental.Eval.suite("again", { target: touch, cases: [{ name: "three", input: ["3"] }], scorers: [] })
]
`
  })
  const result = run(["--list"])
  assert.equal(result.status, 0, result.text)
  assert.equal(result.stdout, [
    "src/greet.eval.vibe",
    "  greet  target greet",
    "    ada",
    "src/touch.eval.vibe",
    "  touch  target touch",
    "    one",
    "    two",
    "  again  target touch",
    "    three",
    "3 suites, 4 cases in 2 files.",
    ""
  ].join("\n"))
  assert.equal(exists("ran.txt"), false, "--list ran a target")
  assert.equal(exists("src/greet.eval.baseline.json"), false)
})

test("--update writes the baseline beside the eval file, and the next run passes against it", { skip }, (t) => {
  const { run, read, exists } = project(t, { "src/greet.eval.vibe": greet })

  // No baseline yet: every score is unaccounted for, and nothing is written.
  const first = run()
  assert.equal(first.status, 1, first.text)
  assert.match(first.stdout, /^greet  ada  exact 1\.00  \(no baseline\)$/m)
  assert.match(first.stderr, /no baseline in greet\.eval\.baseline\.json; run vibelang eval --update to write it/)
  assert.equal(exists("src/greet.eval.baseline.json"), false, "a plain run wrote a baseline")

  const updated = run(["--update"])
  assert.equal(updated.status, 0, updated.text)
  assert.match(updated.stdout, /wrote src\/greet\.eval\.baseline\.json/)
  const baseline = JSON.parse(read("src/greet.eval.baseline.json"))
  assert.equal(baseline.suite, "greet")
  assert.equal(baseline.version, 1)
  assert.deepEqual(baseline.records.map(({ case: name, scorerName, score }) => ({ name, scorerName, score })), [{ name: "ada", scorerName: "exact", score: 1 }])

  // The summary VIP-59 shows.
  const second = run()
  assert.equal(second.status, 0, second.text)
  assert.equal(second.stdout, "greet  ada  exact 1.00  (baseline 1.00)\n1 suite, 1 case, 0 regressed. 0 model calls.\n")
  assert.ok(vip.includes("greet  ada  exact 1.00  (baseline 1.00)\n1 suite, 1 case, 0 regressed. 0 model calls."))
  assert.equal(exists("src/greet.eval.recording.json"), false, "a run that called no model wrote a recording")
})

test("a score below its baseline is a regression and exits 1", { skip }, (t) => {
  const { root, run, read } = project(t, { "src/greet.eval.vibe": greet })
  assert.equal(run(["--update"]).status, 0)
  const before = read("src/greet.eval.baseline.json")
  writeFileSync(join(root, "src/greet.eval.vibe"), greet.replace("Hello, ${name}", "Go away, ${name}"))
  const result = run()
  assert.equal(result.status, 1, result.text)
  assert.match(result.stdout, /^greet  ada  exact 0\.00  \(baseline 1\.00\)$/m)
  assert.match(result.stdout, /^1 suite, 1 case, 1 regressed\. 0 model calls\.$/m)
  assert.match(result.stderr, /greet  failed: regression for ada\/exact/)
  assert.equal(read("src/greet.eval.baseline.json"), before, "a plain run rewrote the baseline")
})

test("renaming a target reports a missing baseline even for an identical score", { skip }, (t) => {
  const { root, run } = project(t, { "src/greet.eval.vibe": greet })
  const first = run(["--update"])
  assert.equal(first.status, 0, first.text)
  writeFileSync(join(root, "src/greet.eval.vibe"), greet.replace("function greet(", "function hello(").replace("target: greet", "target: hello"))
  const renamed = run()
  assert.equal(renamed.status, 1, renamed.text)
  assert.match(renamed.stdout, /greet  ada  exact 1.00  \(no baseline\)/)
})

test("a path argument selects eval files, and each file keeps its own baseline", { skip }, (t) => {
  const { run, exists } = project(t, {
    "src/greet.eval.vibe": greet,
    "src/deep/other.eval.vibe": greet.replace('suite("greet"', 'suite("other"')
  })
  const one = run(["--update", "src/deep"])
  assert.equal(one.status, 0, one.text)
  assert.match(one.stdout, /^1 suite, 1 case, 0 regressed\. 0 model calls\.$/m)
  assert.equal(exists("src/deep/other.eval.baseline.json"), true)
  assert.equal(exists("src/greet.eval.baseline.json"), false)
  const both = run(["--update"])
  assert.equal(both.status, 0, both.text)
  assert.match(both.stdout, /^2 suites, 2 cases, 0 regressed\. 0 model calls\.$/m)
  assert.equal(run(["src/greet.eval.vibe", "src/deep/other.eval.vibe"]).status, 0)
})

test("an eval file with several suites keeps every baseline in one file", { skip }, (t) => {
  const { run, read } = project(t, {
    "src/pair.eval.vibe": `effect function greet(name: string) {
  return \`Hello, \${name}\`
}
effect function shout(name: string) {
  return name.toUpperCase()
}
export default [
  Experimental.Eval.suite("greet", { target: greet, cases: [{ name: "ada", input: ["Ada"], expected: "Hello, Ada" }], scorers: [Experimental.Scorer.exact] }),
  Experimental.Eval.suite("shout", { target: shout, cases: [{ name: "ada", input: ["Ada"], expected: "ADA" }], scorers: [Experimental.Scorer.exact] })
]
`
  })
  const updated = run(["--update"])
  assert.equal(updated.status, 0, updated.text)
  const stored = JSON.parse(read("src/pair.eval.baseline.json"))
  assert.deepEqual(stored.suites.map((item) => item.suite), ["greet", "shout"])
  const again = run()
  assert.equal(again.status, 0, again.text)
  assert.match(again.stdout, /^greet  ada  exact 1\.00  \(baseline 1\.00\)\nshout  ada  exact 1\.00  \(baseline 1\.00\)\n2 suites, 2 cases, 0 regressed\. 0 model calls\.$/m)
})

test("the default run sends no model call: an unrecorded call is undecided and exits 5 (rule 6)", { skip }, (t) => {
  const { run, exists, liveCalls } = project(t, { "src/model.ts": model, "src/capital.eval.vibe": capital })
  const result = run()
  assert.equal(result.status, 5, result.text)
  assert.match(result.stdout, /^capital  france  undecided: a model call has no recording; run vibelang eval --live to record it$/m)
  assert.match(result.stdout, /^1 suite, 1 case, 0 regressed, 1 undecided\. 0 model calls\.$/m)
  assert.equal(liveCalls(), 0, "the default run called the live model")
  assert.equal(exists("src/capital.eval.recording.json"), false)

  // --update never writes a baseline when a case went undecided (rule 7).
  const updated = run(["--update"])
  assert.equal(updated.status, 5, updated.text)
  assert.match(updated.stderr, /baseline not updated: a case failed or went undecided/)
  assert.equal(exists("src/capital.eval.baseline.json"), false)
  assert.equal(liveCalls(), 0)
})

test("no environment variable turns the default run live (rule 6)", { skip }, (t) => {
  const { run, liveCalls } = project(t, { "src/model.ts": model, "src/capital.eval.vibe": capital })
  const result = run([], { VIBELANG_EVAL_LIVE: "1", EVAL_LIVE: "1", LIVE: "1", CI: "", VIBELANG_LIVE: "true" })
  assert.equal(result.status, 5, result.text)
  assert.equal(liveCalls(), 0)
})

test("--live calls the model and writes the recording the default run replays (rule 6)", { skip }, (t) => {
  const { run, read, liveCalls } = project(t, { "src/model.ts": model, "src/capital.eval.vibe": capital })
  const live = run(["--live", "--update"])
  assert.equal(live.status, 0, live.text)
  assert.match(live.stdout, /^capital  france  exact 1\.00  \(no baseline\)$/m)
  assert.match(live.stdout, /^1 suite, 1 case, 0 regressed\. 1 model call\.$/m)
  assert.equal(liveCalls(), 1)
  const recording = JSON.parse(read("src/capital.eval.recording.json"))
  assert.equal(recording.calls.length, 1)
  assert.match(JSON.stringify(recording.calls[0]), /What is the capital of France\?/)
  assert.match(JSON.stringify(recording.calls[0]), /Paris/)

  // The default run replays it: same score, no call, even with another answer live.
  const replayed = run([], { EVAL_TEST_ANSWER: "Lyon" })
  assert.equal(replayed.status, 0, replayed.text)
  assert.equal(replayed.stdout, "capital  france  exact 1.00  (baseline 1.00)\n1 suite, 1 case, 0 regressed. 0 model calls.\n")
  assert.equal(liveCalls(), 1, "the default run called the live model")

  // A live run with a complete recording spends nothing either.
  const again = run(["--live"])
  assert.equal(again.status, 0, again.text)
  assert.match(again.stdout, /0 model calls\.$/m)
  assert.equal(liveCalls(), 1)
})

test("--trials runs each case that many times under --live", { skip }, (t) => {
  const { run, read, liveCalls } = project(t, { "src/model.ts": model, "src/capital.eval.vibe": capital })
  const result = run(["--live", "--update", "--trials", "3"])
  assert.equal(result.status, 0, result.text)
  assert.match(result.stdout, /^capital  france  exact 1\.00  \(no baseline\)  3 trials$/m)
  assert.match(result.stdout, /3 model calls\.$/m)
  assert.equal(liveCalls(), 3)
  assert.equal(JSON.parse(read("src/capital.eval.recording.json")).calls.length, 3)
  const refused = run(["--trials", "3"])
  assert.equal(refused.status, 2, refused.text)
  assert.equal(liveCalls(), 3)
})

test("--live without a live model fails the case that called one, and names the export to add", { skip }, (t) => {
  const { run, exists } = project(t, {
    "src/model.ts": model,
    "src/capital.eval.vibe": capital.replace("export const live = scripted\n", "")
  })
  const result = run(["--live", "--update"])
  assert.equal(result.status, 1, result.text)
  assert.match(result.stdout, /exports no live model; add: export const live = Experimental\.Model\.use/)
  assert.equal(exists("src/capital.eval.baseline.json"), false, "--update wrote a baseline after a failed case")
})

test("a target that fails is a failed case: exit 1, and --update leaves the baseline alone (rule 7)", { skip }, (t) => {
  const failing = `error Down { reason: string }
effect function greet(name: string) {
  if (name === "Bob") throw new Down({ reason: "offline" })
  return \`Hello, \${name}\`
}
export default Experimental.Eval.suite("greet", {
  target: greet,
  cases: [{ name: "ada", input: ["Ada"], expected: "Hello, Ada" }, { name: "bob", input: ["Bob"], expected: "Hello, Bob" }],
  scorers: [Experimental.Scorer.exact]
})
`
  const { run, exists } = project(t, { "src/greet.eval.vibe": failing })
  const result = run(["--update"])
  assert.equal(result.status, 1, result.text)
  assert.match(result.stdout, /^greet  ada  exact 1\.00/m)
  assert.match(result.stdout, /^greet  bob  failed: Target failed for case 'bob'/m)
  assert.match(result.stdout, /^1 suite, 2 cases, 0 regressed, 1 failed\. 0 model calls\.$/m)
  assert.match(result.stderr, /baseline not updated: a case failed or went undecided/)
  assert.equal(exists("src/greet.eval.baseline.json"), false)
})

test("a suite's gate decides the exit code: a score under min fails with a baseline that matches", { skip }, (t) => {
  const { run } = project(t, {
    "src/greet.eval.vibe": greet.replace("expected: \"Hello, Ada\"", "expected: \"Bonjour, Ada\"").replace("scorers: [Experimental.Scorer.exact]", "scorers: [Experimental.Scorer.exact],\n  gate: { min: 1 }")
  })
  const result = run(["--update"])
  assert.equal(result.status, 1, result.text)
  assert.match(result.stderr, /greet  failed: min_below_threshold/)
})

test("an eval file that does not compile, or exports no suite, cannot be decided (5)", { skip }, (t) => {
  const { run } = project(t, {
    "src/broken.eval.vibe": "export default Experimental.Eval.suite(\"broken\", { target: 1 })\nconst wrong: string = 2\n",
    "src/plain.eval.vibe": "export default { name: \"not a suite\" }\n",
    "src/none.eval.vibe": "export const value = 1\n"
  })
  const result = run()
  assert.equal(result.status, 5, result.text)
  assert.match(result.stderr, /vibelang eval: src\/broken\.eval\.vibe: [^]*did not compile/)
  assert.match(result.stderr, /the default export of .*plain\.eval\.vibe is not a suite; build it with Experimental\.Eval\.suite/)
  assert.match(result.stderr, /none\.eval\.vibe has no default export/)
})

test("importing an eval file runs nothing (rule 2)", { skip }, (t) => {
  const { root, exists } = project(t, { "src/model.ts": model, "src/capital.eval.vibe": capital })
  const register = fileURLToPath(new URL("../register.mjs", import.meta.url))
  const result = spawnSync(process.execPath, ["--import", register, "--input-type=module", "-e",
    'const suite = (await import("./src/capital.eval.vibe")).default; console.log(suite.name, suite.cases.length)'
  ], { cwd: root, encoding: "utf8", env: { ...process.env, VIBELANG_BINARY: native, VIBELANG_PROJECT: "", VIBELANG_CACHE_DIR: join(root, ".cache") } })
  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.stdout, "capital 1\n")
  assert.equal(exists("live-calls.log"), false)
})

test("a decision target replays its fixture and a missing decision is undecided", { skip }, (t) => {
  const { root, run } = project(t, {
    "src/decide.ts": `import { Effect, Schema } from "effect"
import { Decision, DecisionModel } from "effect/ai"
const flag = Decision.make({ input: Schema.String, decisions: { urgent: Decision.probability({ instructions: "Is it urgent?" }) } })
export const classify = (input: string) => Effect.map(DecisionModel.decide(flag, { input }), reply => reply.answers.urgent.probability)
`,
    "src/flag.eval.vibe": `import { classify } from "./decide.ts"
export default Experimental.Eval.suite("flag", { target: classify, cases: [{ name: "one", input: ["x"], expected: 0.75 }], scorers: [Experimental.Scorer.exact] })
`
  })
  const missing = run()
  assert.equal(missing.status, 5, missing.text)
  assert.match(missing.stdout, /undecided: a decision call has no recording/)
  writeFileSync(join(root, "src/flag.eval.decisions.json"), JSON.stringify({
    calls: [{ request: { state: "x" }, response: { answers: { urgent: { _tag: "Probability", probability: 0.75 } } } }]
  }))
  const update = run(["--update"])
  assert.equal(update.status, 0, update.text)
  const replay = run()
  assert.equal(replay.status, 0, replay.text)
  assert.match(replay.stdout, /exact 1.00  \(baseline 1.00\)/)
  assert.match(replay.stdout, /0 model calls/)
})
