// Executable evidence for the retirement admission rules in docs/design/vips/README.md.
import assert from "node:assert/strict"
import { test } from "node:test"
import { spawnSync } from "node:child_process"
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createHash } from "node:crypto"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { auditRange } from "./retirement-gate.mjs"

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../..")
const gate = join(repo, "docs/tools/retirement-gate.mjs")
const registryPath = "typescript/tsc/internal/vibelang/diagnostics.go"
const input = "typescript/vibelang/cases/retirement-rule.fail"
const output = "typescript/vibelang/cases/retirement-rule-fixed"
const fixes = JSON.stringify([{ code: "EK7777", cases: [{ input, output }] }])
const approval = reference => JSON.stringify([{ code: "EK7777", case: input, vip: "VIP-41",
  approval: { by: "Will", reference }, reason: "reviewed exception fixture" }])

// A jj repository of fixture commits, a current compiler that rejects "new
// form" with EK7777 and whose --fix writes "fixed form", and previous
// compilers whose behavior each test chooses.
function fixture(body) {
  const root = mkdtempSync(join(tmpdir(), "retirement-rules-"))
  const jj = (...args) => {
    const r = spawnSync("jj", args, { cwd: root, encoding: "utf8" })
    assert.equal(r.status, 0, r.stderr)
    return r.stdout.trim()
  }
  const put = (path, text) => { mkdirSync(join(root, path, ".."), { recursive: true }); writeFileSync(join(root, path), text) }
  const remove = path => rmSync(join(root, path), { recursive: true, force: true })
  const commit = description => { jj("describe", "-m", description); const id = jj("log", "--no-graph", "-r", "@", "-T", "commit_id"); jj("new"); return id }
  const script = (name, text) => { const path = join(root, name); writeFileSync(path, "#!/usr/bin/env node\n" + text); chmodSync(path, 0o755); return path }
  const current = script("current-compiler", 'const fs=require("node:fs");const t=fs.readFileSync("main.vibe","utf8");' +
    'if(process.argv.includes("--fix")){if(t==="new form"){fs.writeFileSync("main.vibe","fixed form");console.log("EK7777 ×1")}process.exit(0)}' +
    'if(t==="new form"){console.log("main.vibe(1,1): error EK7777");process.exit(2)}')
  // previous(behavior, parent) is an earlier toolchain with its receipt for parent.
  const previous = (name, text, parent) => {
    const path = script(name, text)
    writeFileSync(path + ".retirement.json", JSON.stringify({ commit: parent, sha256: createHash("sha256").update(readFileSync(path)).digest("hex") }))
    return path
  }
  const setRegistry = category => put(registryPath, 'var Sentinel = message(9999, warningCategory, "sentinel")' +
    (category ? '\nvar X = message(7777, ' + category + 'Category, "rule")' : ""))
  const addCase = (text = "new form") => {
    put(input + "/tsconfig.json", '{"compilerOptions":{"noEmit":true},"files":["main.vibe"]}')
    put(input + "/main.vibe", text)
    put(input + "/expected/diagnostics.txt", "main.vibe(1,1): error EK7777")
  }
  try {
    jj("git", "init", "--quiet", ".")
    jj("config", "set", "--repo", "user.name", "Retirement fixtures")
    jj("config", "set", "--repo", "user.email", "retirement@example.invalid")
    setRegistry()
    return body({ root, jj, put, remove, commit, current, previous, setRegistry, addCase,
      audit: (base, head, extra = {}) => auditRange({ root, base, head, binary: current, ...extra }) })
  } finally { rmSync(root, { recursive: true, force: true }) }
}

// rule-evidence: docs/design/vips/README.md#e01fc0076c5d39aa
// rule-evidence: docs/design/vips/README.md#vibelang-improvement-proposals | A retirement is any change that makes source accepted by an earlier toolchain fail to compile: a new error, a warning promoted to an error, or an existing error widened to new forms.
test("each change that makes previously accepted source fail is classified as a retirement; previously rejected source is not", () => {
  fixture(({ commit, setRegistry, addCase, previous, audit, jj }) => {
    const none = commit("no rule")
    setRegistry("error")
    const added = commit("a new error")
    assert.deepEqual(audit(none, added).failures.map(f => f.match(/\(([^)]*)\)/)[1]), ["new error severity"])
    jj("new", none); setRegistry("warning")
    const warned = commit("a warning")
    setRegistry("error")
    const promoted = commit("the warning promoted to an error")
    assert.deepEqual(audit(warned, promoted).failures.map(f => f.match(/\(([^)]*)\)/)[1]), ["new error severity"])
    setRegistry("warning")
    assert.deepEqual(audit(promoted, commit("demoted again")).failures, [])
    jj("new", added); addCase()
    const widened = commit("the existing error widened to a new form")
    // The earlier toolchain accepted the new form: this is a retirement.
    const accepting = previous("accepting-compiler", "process.exit(0)", added)
    const result = audit(added, widened, { previousBinary: accepting })
    assert.equal(result.retirements, 1)
    assert.match(result.failures.join("\n"), /EK7777 at commit [a-f0-9]{12} \(new or widened \.fail case: typescript\/vibelang\/cases\/retirement-rule\.fail\)/)
    // The earlier toolchain already rejected it with a source error: no retirement.
    const rejecting = previous("rejecting-compiler", 'console.log("main.vibe(1,1): error EK7777");process.exit(2)', added)
    assert.deepEqual(audit(added, widened, { previousBinary: rejecting }), { ...audit(added, widened, { previousBinary: rejecting }), retirements: 0, failures: [] })
    // A setup failure is not evidence that the earlier toolchain rejected the source.
    const broken = previous("broken-compiler", 'console.log("error TS5058: The specified path does not exist");process.exit(1)', added)
    assert.equal(audit(added, widened, { previousBinary: broken }).retirements, 1)
    // Without an earlier toolchain, the new failing witness conservatively counts.
    assert.equal(audit(added, widened).retirements, 1)
  })
})

// rule-evidence: docs/design/vips/README.md#77e97fc0346e78ea
test("a retirement is admitted only with a registered compiling --fix case or a reviewed VIP and approval entry", () => {
  fixture(({ commit, setRegistry, addCase, put, audit, jj }) => {
    setRegistry("error")
    const base = commit("existing error")
    addCase()
    const bare = commit("widened without a fix")
    assert.match(audit(base, bare).failures.join("\n"), /missing registered --fix and compiling fixed-output case \(or reviewed VIP\/Will approval\)/)
    // A fix in a later commit cannot license the earlier one.
    put(output + "/main.vibe", "fixed form")
    put("docs/design/retirement-fixes.json", fixes)
    assert.equal(audit(base, commit("late fix")).failures.length, 1)
    jj("new", base); addCase()
    put(output + "/main.vibe", "fixed form")
    put("docs/design/retirement-fixes.json", fixes)
    const fixed = commit("with a registered quick fix and its fixed output")
    assert.deepEqual(audit(base, fixed).failures, [])
    jj("new", base); addCase()
    put(output + "/main.vibe", "different form")
    put("docs/design/retirement-fixes.json", fixes)
    assert.match(audit(base, commit("fixed output that the quick fix does not produce")).failures.join("\n"), /unexpected fixed output/)
    jj("new", base); addCase()
    put("docs/design/retirement-allowlist.json", approval("reviewed approval fixture"))
    assert.deepEqual(audit(base, commit("reviewed exception")).failures, [])
    jj("new", base); addCase()
    put("docs/design/retirement-allowlist.json", approval(""))
    assert.equal(audit(base, commit("exception without an approval reference")).failures.length, 1)
  })
})

// rule-evidence: docs/design/vips/README.md#4bead872840b5e23
// rule-evidence: docs/design/vips/README.md#vibelang-improvement-proposals | The merge queue checks before admission and after building, and the specification exposes `//:spec-retirement-gate` with immutable `RETIREMENT_BASE` and `RETIREMENT_HEAD` commit IDs; neither gate uses network access or live migration trees.
test("the queue checks before admission and after building; the spec gate takes immutable ids offline", () => {
  const patch = readFileSync(join(repo, "scripts/mq-retirement-integration.patch"), "utf8")
  const enqueue = patch.indexOf("retirement_check(own_base(HEAD_REF, c), c, os.getcwd(), precheck=True)")
  const before = patch.indexOf("retirement_check(base, tip, ws, precheck=True)")
  const validate = patch.indexOf("bash {VALIDATE}")
  const after = patch.indexOf("retirement_check(base, tip, ws)\n")
  assert.ok(enqueue > 0 && before > enqueue && validate > before && after > validate, "precheck at admission and before the build, final check after it")
  const adapter = spawnSync("python3", ["-B", join(repo, "scripts/mq-retirement-precheck.test.py")], { encoding: "utf8" })
  assert.equal(adapter.status, 0, adapter.stdout + adapter.stderr)
  const target = readFileSync(join(repo, "PACKAGE.ts"), "utf8").match(/const retirementGate = S\.Shell\.Test\(\{[\s\S]*?\n\}\)/)[0]
  assert.match(target, /node docs\/tools\/retirement-gate\.mjs --immutable --base "\$RETIREMENT_BASE" --head "\$RETIREMENT_HEAD"/)
  assert.match(readFileSync(join(repo, "PACKAGE.ts"), "utf8"), /"spec-retirement-gate": retirementGate/)
  const source = readFileSync(gate, "utf8")
  for (const forbidden of [/node:(?:https?|net|dgram|tls|dns)\b/, /\bfetch\(/, /\bhomedir\b|process\.env\.HOME|~\//, /migrat/i])
    assert.doesNotMatch(source, forbidden)
  fixture(({ root, commit, setRegistry, current }) => {
    const base = commit("baseline")
    setRegistry("warning")
    const head = commit("a warning")
    const cli = (...args) => spawnSync(process.execPath, ["--permission", "--allow-fs-read=*", "--allow-fs-write=" + tmpdir(), "--allow-child-process", gate,
      "--root", root, "--compiler", current, ...args], { encoding: "utf8" })
    const mutable = cli("--immutable", "--base", "@--", "--head", "@-")
    assert.equal(mutable.status, 2, mutable.stderr)
    assert.match(mutable.stderr, /--immutable requires full commit IDs/)
    const pinned = cli("--immutable", "--base", base, "--head", head)
    assert.equal(pinned.status, 0, pinned.stderr)
    assert.equal(JSON.parse(pinned.stdout).head, head)
  })
})
