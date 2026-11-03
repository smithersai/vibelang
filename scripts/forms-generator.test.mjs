import assert from "node:assert/strict"
import { spawnSync, spawn } from "node:child_process"
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { stripTypeScriptTypes } from "node:module"
import { runInNewContext } from "node:vm"
import { test } from "node:test"

const read = file => readFileSync(new URL("../" + file, import.meta.url), "utf8")
const goSources = { compilerSources: true }
const formsGenerator = { formsGenerator: true }
function targets(file) {
  const source = stripTypeScriptTypes(read(file)).replace(/^import .*$/gm, "")
    .replace("export const Package", "globalThis.result")
  const context = {
    fuzzTopics: new Map([["prelude", ["FuzzPreludeGlobalMember", "FuzzPreludeShadowed"]]]),
    vibelangTopics: new Map([["fix", ["TestFixReachesFixedPoint", "TestFixArguments"]]]),
    process: { env: {} },
    migrationSources: { migrationSources: true },
    S: { Generate: spec => spec, Shell: { Build: spec => spec, Test: spec => spec, Run: spec => spec }, Host: { bin: bin => bin },
      Filegroup: spec => spec, glob: patterns => patterns, file: file => file, Package: spec => spec },
    Tsc: { srcs: goSources }, Typescript: { "forms-generator": formsGenerator }, Packages: {}, Vibelang: {}
  }
  runInNewContext(source, context)
  return context.result.targets
}

test("the forms executable is cached by compiler build inputs, independently of docs and test sources", () => {
  const target = targets("typescript/PACKAGE.ts")["forms-generator"]
  assert.ok(target, "a docs-only forms check must reuse a source-keyed executable")
  assert.ok(target.data.includes(goSources))
  assert.ok(target.data.includes("go.work"))
  assert.ok(target.data.includes("//scripts/native-output.sh"))
  assert.equal(target.data.length, 3, "generation inputs must not enter the executable key")
  assert.deepEqual(Array.from(target.outFiles), ["built/local/vibelang-forms"])
  assert.ok(target.tools.includes("go"))
  assert.match(target.shell, /GOCACHE=\$HOME\/\.cache\/go-build-smthrs/)
  assert.match(target.shell, /native-output\.sh build .*\.\/cmd\/vibelang-forms/)
  assert.equal(target.sandbox, "none")
})

test("the forms check declares the executable dependency and runs fresh generation with it", () => {
  const target = targets("PACKAGE.ts").forms
  assert.ok(target.data.includes(formsGenerator), "binary freshness belongs to the build graph")
  assert.match(target.shell, /FORMS_BINARY=\$PWD\/typescript\/built\/local\/vibelang-forms/)
  assert.match(target.shell, /bash scripts\/check-forms-table\.sh/)
  assert.ok(!target.tools.includes("go"), "a cache hit must not enter Go build admission")
})

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "forms generator "))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const put = (name, content, mode) => {
    mkdirSync(join(root, name, ".."), { recursive: true })
    writeFileSync(join(root, name), content, mode ? { mode } : undefined)
  }
  put("scripts/check-forms-table.sh", read("scripts/check-forms-table.sh"))
  put("typescript/tsc/internal/vibelang/formsexport.go", "func FormsOfType\n")
  put("typescript/tsc/internal/vibelangmapper/forms_table.jsonl", "table\n")
  put("typescript/tsc/internal/vibelangmapper/forms_decisions.txt", "decisions\n")
  put("typescript/tsc/internal/vibelangmapper/forms_decisions_approved.txt", "approval\n")
  mkdirSync(join(root, "typescript/tsc/cmd/vibelang-data-methods/node_modules"), { recursive: true })
  // These small processes exercise shell transport only. The real generator and graph
  // are checked separately; no classifier or compiler behavior is simulated here.
  const transport = `#!/usr/bin/env node
import { writeFileSync, appendFileSync } from "node:fs"
const args = process.argv.slice(2)
appendFileSync(process.env.FORMS_TEST_TRACE, JSON.stringify([process.argv[1], ...args]) + "\\n")
for (const [flag, text] of [["-o", "table\\n"], ["-decisions", "decisions\\n"]]) {
  const i = args.indexOf(flag)
  if (i >= 0) writeFileSync(args[i+1], text)
}
`
  put("bin/generator.mjs", transport, 0o755)
  put("bin/bun", "#!/bin/sh\nexit 0\n", 0o755)
  put("bin/go", "#!/bin/sh\necho unexpected-go >&2\nexit 93\n", 0o755)
  const env = { ...process.env, PATH: join(root, "bin") + ":" + process.env.PATH,
    FORMS_BINARY: join(root, "bin/generator.mjs"), FORMS_NODE_MODULES: join(root, "modules with spaces"),
    FORMS_TEST_TRACE: join(root, "trace"), VIBELANG_FORMS_EXPORT: "" }
  const run = (args = [], extra = {}) => spawnSync("bash", [join(root, "scripts/check-forms-table.sh"), ...args],
    { cwd: root, encoding: "utf8", env: { ...env, ...extra }, timeout: 10_000 })
  return { root, env, put, run, trace: () => readFileSync(env.FORMS_TEST_TRACE, "utf8").trim().split("\n").map(JSON.parse) }
}

for (const write of [false, true]) test("prepared generator preserves arguments and fresh output in " + (write ? "write" : "check") + " mode", t => {
  const f = fixture(t)
  const run = f.run(write ? ["--write"] : [])
  assert.equal(run.status, 0, run.stdout + run.stderr)
  const [args] = f.trace()
  assert.equal(args[args.indexOf("-repo") + 1], f.root)
  assert.equal(args[args.indexOf("-node-modules") + 1], f.env.FORMS_NODE_MODULES)
  assert.equal(args.includes("-previous"), write)
  assert.equal(args.includes("-approved"), write)
  assert.match(run.stdout, write ? /check-forms-table: wrote/ : /check-forms-table: ok/)
})

test("a prepared executable still detects a changed committed table and decisions", t => {
  const f = fixture(t)
  for (const name of ["forms_table.jsonl", "forms_decisions.txt"]) f.put("typescript/tsc/internal/vibelangmapper/" + name, "stale\n")
  const run = f.run()
  assert.equal(run.status, 1, run.stdout + run.stderr)
  assert.match(run.stderr, /forms_table.jsonl differs from a fresh generation/)
  assert.match(run.stderr, /decisions differ from forms_decisions.txt/)
})

test("an explicitly missing executable fails without silently rebuilding", t => {
  const f = fixture(t)
  const run = f.run([], { FORMS_BINARY: join(f.root, "missing") })
  assert.equal(run.status, 2, run.stdout + run.stderr)
  assert.match(run.stderr, /FORMS_BINARY.*executable/)
  assert.doesNotMatch(run.stderr, /unexpected-go/)
})

for (const kind of ["relative", "directory", "not executable"]) test("reject an invalid prepared path: " + kind, t => {
  const f = fixture(t)
  const path = kind === "relative" ? "bin/generator.mjs" : kind === "directory" ? f.root : join(f.root, "plain")
  if (kind === "not executable") f.put("plain", "not executable\n")
  const run = f.run([], { FORMS_BINARY: path })
  assert.equal(run.status, 2, run.stdout + run.stderr)
  assert.match(run.stderr, /FORMS_BINARY.*absolute executable file/)
  assert.doesNotMatch(run.stderr, /unexpected-go/)
})

test("generator failures propagate and leave committed snapshots intact", t => {
  const f = fixture(t)
  f.put("bin/generator.mjs", "#!/bin/sh\necho generator-failed >&2\nexit 71\n", 0o755)
  const run = f.run(["--write"])
  assert.equal(run.status, 71, run.stdout + run.stderr)
  assert.match(run.stderr, /generator-failed/)
  assert.equal(readFileSync(join(f.root, "typescript/tsc/internal/vibelangmapper/forms_table.jsonl"), "utf8"), "table\n")
  assert.equal(readFileSync(join(f.root, "typescript/tsc/internal/vibelangmapper/forms_decisions.txt"), "utf8"), "decisions\n")
})

test("an overlay cannot be silently ignored by a prepared executable", t => {
  const f = fixture(t)
  const run = f.run([], { VIBELANG_FORMS_EXPORT: join(f.root, "overlay.go") })
  assert.equal(run.status, 2, run.stdout + run.stderr)
  assert.match(run.stderr, /FORMS_BINARY.*VIBELANG_FORMS_EXPORT/)
  assert.doesNotMatch(run.stderr, /unexpected-go/)
})

test("standalone checks retain their Go fallback and overlay", t => {
  const f = fixture(t)
  f.put("bin/go", readFileSync(join(f.root, "bin/generator.mjs"), "utf8"), 0o755)
  const run = f.run(["--write"], { FORMS_BINARY: "", VIBELANG_FORMS_EXPORT: join(f.root, "overlay.go") })
  assert.equal(run.status, 0, run.stdout + run.stderr)
  const [args] = f.trace()
  assert.deepEqual(args.slice(1, 3), ["run", "-trimpath"])
  assert.ok(args.includes("-overlay"))
  assert.ok(args.includes("./cmd/vibelang-forms"))
})


const missingCache = root => "main.go:3:8: could not import fixture/dep (open " + root + "/cache space/ab/" + "f".repeat(64) + "-d: no such file or directory)\n"

function fallbackFailures(f, { failures = 1, diagnostic = missingCache(f.root), code = 1, secondDiagnostic = "", secondCode = 0, noSecondOutput = false } = {}) {
  const original = readFileSync(join(f.root, "bin/generator.mjs"), "utf8")
    .replace('import { writeFileSync, appendFileSync }', 'import { writeFileSync, appendFileSync, readFileSync }')
  const probe = String.raw`
const attempt = readFileSync(process.env.FORMS_TEST_TRACE, "utf8").trim().split("\n").length
if (attempt <= ${failures}) {
  for (const flag of ["-o", "-decisions"]) {
    const index = args.indexOf(flag)
    if (index >= 0) writeFileSync(args[index + 1], "partial stale output\n")
  }
  process.stderr.write(${JSON.stringify(diagnostic)})
  process.exit(${code})
}
if (${secondCode} !== 0) {
  process.stderr.write(${JSON.stringify(secondDiagnostic)})
  process.exit(${secondCode})
}
if (${noSecondOutput}) process.exit(0)
`
  f.put("bin/go", original.replace('for (const [flag, text]', probe + '\nfor (const [flag, text]'), 0o755)
}

for (const write of [false, true]) test("a missing compiler cache archive retries standalone generation once in " + (write ? "write" : "check") + " mode", t => {
  const f = fixture(t)
  fallbackFailures(f)
  const run = f.run(write ? ["--write"] : [], { FORMS_BINARY: "" })
  assert.equal(run.status, 0, run.stdout + run.stderr)
  assert.match(run.stderr, /could not import fixture\/dep/)
  assert.match(run.stderr, /retrying.*once/)
  assert.equal(f.trace().length, 2)
  assert.deepEqual(f.trace()[0].slice(1), f.trace()[1].slice(1), "Go and generator arguments remain identical")
  assert.equal(readFileSync(join(f.root, "typescript/tsc/internal/vibelangmapper/forms_table.jsonl"), "utf8"), "table\n")
  assert.equal(readFileSync(join(f.root, "typescript/tsc/internal/vibelangmapper/forms_decisions.txt"), "utf8"), "decisions\n")
})

test("a persistent missing cache archive stops after two attempts and leaves snapshots intact", t => {
  const f = fixture(t)
  fallbackFailures(f, { failures: 99 })
  const run = f.run(["--write"], { FORMS_BINARY: "" })
  assert.equal(run.status, 1, run.stdout + run.stderr)
  assert.equal(f.trace().length, 2)
  assert.equal((run.stderr.match(/could not import fixture\/dep/g) || []).length, 2)
  assert.equal(readFileSync(join(f.root, "typescript/tsc/internal/vibelangmapper/forms_table.jsonl"), "utf8"), "table\n")
  assert.equal(readFileSync(join(f.root, "typescript/tsc/internal/vibelangmapper/forms_decisions.txt"), "utf8"), "decisions\n")
})

for (const [why, diagnostic, code] of [
  ["ordinary compile error", "main.go:3:8: undefined: missing\n", 1],
  ["ordinary missing source", "open /project/main.go: no such file or directory\n", 1],
  ["short hash", "could not import fixture/dep (open /cache/ab/" + "f".repeat(63) + "-d: no such file or directory)\n", 1],
  ["wrong archive suffix", "could not import fixture/dep (open /cache/ab/" + "f".repeat(64) + ".a: no such file or directory)\n", 1],
  ["argument failure", null, 2],
  ["other exit status", null, 7],
  ["terminated process status", null, 137],
]) test("standalone generation does not retry " + why, t => {
  const f = fixture(t)
  fallbackFailures(f, { diagnostic: diagnostic ?? missingCache(f.root), code })
  const run = f.run(["--write"], { FORMS_BINARY: "" })
  assert.equal(run.status, code, run.stdout + run.stderr)
  assert.equal(f.trace().length, 1)
  assert.doesNotMatch(run.stderr, /retrying/)
})

test("prepared generator errors are never retried even if they look like compiler cache loss", t => {
  const f = fixture(t)
  fallbackFailures(f)
  f.put("bin/generator.mjs", readFileSync(join(f.root, "bin/go"), "utf8"), 0o755)
  const run = f.run(["--write"])
  assert.equal(run.status, 1, run.stdout + run.stderr)
  assert.equal(f.trace().length, 1)
  assert.doesNotMatch(run.stderr, /retrying/)
})

for (const code of [1, 7]) test("a failed retry preserves its actual status " + code + " and both errors", t => {
  const f = fixture(t)
  fallbackFailures(f, { secondCode: code, secondDiagnostic: "unapproved decision move\n" })
  const run = f.run(["--write"], { FORMS_BINARY: "" })
  assert.equal(run.status, code, run.stdout + run.stderr)
  assert.equal(f.trace().length, 2)
  assert.match(run.stderr, /could not import fixture\/dep/)
  assert.match(run.stderr, /unapproved decision move/)
  assert.equal(readFileSync(join(f.root, "typescript/tsc/internal/vibelangmapper/forms_decisions.txt"), "utf8"), "decisions\n")
})

test("retry cannot bless a first attempt's partial output when the next attempt writes nothing", t => {
  const f = fixture(t)
  fallbackFailures(f, { noSecondOutput: true })
  const run = f.run(["--write"], { FORMS_BINARY: "" })
  assert.notEqual(run.status, 0, run.stdout + run.stderr)
  assert.equal(f.trace().length, 2)
  assert.equal(readFileSync(join(f.root, "typescript/tsc/internal/vibelangmapper/forms_table.jsonl"), "utf8"), "table\n")
  assert.equal(readFileSync(join(f.root, "typescript/tsc/internal/vibelangmapper/forms_decisions.txt"), "utf8"), "decisions\n")
})


test("a cache-like stdout message cannot cause retry of a different failure", t => {
  const f = fixture(t)
  fallbackFailures(f)
  f.put("bin/go", readFileSync(join(f.root, "bin/go"), "utf8").replaceAll("process.stderr.write", "process.stdout.write"), 0o755)
  const run = f.run(["--write"], { FORMS_BINARY: "" })
  assert.equal(run.status, 1, run.stdout + run.stderr)
  assert.match(run.stdout, /could not import fixture\/dep/)
  assert.equal(f.trace().length, 1)
  assert.doesNotMatch(run.stderr, /retrying/)
})

test("retry retains a standalone overlay and its approval arguments", t => {
  const f = fixture(t)
  fallbackFailures(f)
  const run = f.run(["--write"], { FORMS_BINARY: "", VIBELANG_FORMS_EXPORT: join(f.root, "overlay.go") })
  assert.equal(run.status, 0, run.stdout + run.stderr)
  const calls = f.trace()
  assert.equal(calls.length, 2)
  assert.deepEqual(calls[0].slice(1), calls[1].slice(1))
  assert.ok(calls[1].includes("-overlay"))
  assert.ok(calls[1].includes("-previous"))
  assert.ok(calls[1].includes("-approved"))
})


test("standalone diagnostics arrive while the generator is still waiting", { timeout: 35_000 }, async t => {
  const f = fixture(t)
  const release = join(f.root, "release")
  const original = readFileSync(join(f.root, "bin/generator.mjs"), "utf8")
  const hold = String.raw`
const { existsSync } = await import("node:fs")
process.stderr.write("forms-test: waiting for own release\n")
setTimeout(() => process.exit(9), 25_000).unref()
while (!existsSync(process.env.FORMS_TEST_RELEASE)) await new Promise(resolve => setTimeout(resolve, 20))
`
  f.put("bin/go", original.replace('for (const [flag, text]', hold + '\nfor (const [flag, text]'), 0o755)
  let mark, rejectMarker
  const marker = new Promise((resolve, reject) => { mark = resolve; rejectMarker = reject })
  const child = spawn("bash", [join(f.root, "scripts/check-forms-table.sh")], {
    cwd: f.root, env: { ...f.env, FORMS_BINARY: "", FORMS_TEST_RELEASE: release },
  })
  let stderr = "", stdout = ""
  child.stdout.on("data", data => { stdout += data })
  child.stderr.on("data", data => {
    stderr += data
    if (stderr.includes("forms-test: waiting for own release")) mark()
  })
  child.on("error", rejectMarker)
  const closed = new Promise(resolve => child.on("close", code => resolve(code)))
  let deadline
  try {
    await Promise.race([
      marker,
      closed.then(code => { throw new Error("generator exited before its live diagnostic: " + code + "\n" + stderr) }),
      new Promise((_, reject) => { deadline = setTimeout(() => reject(new Error("waiting diagnostic was buffered")), 20_000) }),
    ])
    clearTimeout(deadline)
    assert.equal(child.exitCode, null, "the diagnostic must precede generator completion")
    writeFileSync(release, "")
    const code = await closed
    assert.equal(code, 0, stdout + stderr)
    assert.equal(f.trace().length, 1)
  } finally {
    clearTimeout(deadline)
    writeFileSync(release, "")
    let cleanup
    await Promise.race([closed, new Promise(resolve => {
      cleanup = setTimeout(() => { child.kill("SIGTERM"); resolve() }, 5_000)
    })])
    clearTimeout(cleanup)
  }
})


test("a failed diagnostic recorder cannot approve freshly generated snapshots", t => {
  const f = fixture(t)
  const marker = join(f.root, "recorder-called")
  const table = "typescript/tsc/internal/vibelangmapper/forms_table.jsonl"
  f.put(table, "old table\n")
  f.put("bin/go", readFileSync(join(f.root, "bin/generator.mjs"), "utf8"), 0o755)
  f.put("bin/tee", '#!/bin/sh\nprintf called > "$FORMS_RECORDER_MARKER"\necho recorder-failed >&2\nexit 7\n', 0o755)
  const run = f.run(["--write"], { FORMS_BINARY: "", FORMS_RECORDER_MARKER: marker })
  if (existsSync(marker)) {
    assert.equal(run.status, 7, run.stdout + run.stderr)
    assert.match(run.stderr, /diagnostic recorder failed/)
    assert.equal(readFileSync(join(f.root, table), "utf8"), "old table\n")
  } else {
    // The original check does not use a recorder; its successful generation
    // remains a control rather than inventing an error in an unused tool.
    assert.equal(run.status, 0, run.stdout + run.stderr)
    assert.equal(readFileSync(join(f.root, table), "utf8"), "table\n")
  }
})
