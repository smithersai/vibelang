import assert from "node:assert/strict"
import { test } from "node:test"
import { readFileSync, writeFileSync } from "node:fs"
import fc from "fast-check"
import { categories, nativeCategories, requiredRetirements, changedFailCases, approvalFor, witnessFor, verifyWitness } from "./retirement-gate.mjs"

const source = text => [{ path: "typescript/tsc/internal/vibelang/diagnostics.go", text }]
const registry = (code, category) => categories(source("var X = message(" + code + ", " + category + ', "rule")'))
const input = "typescript/vibelang/cases/retirement-test.fail"
const output = "typescript/vibelang/cases/retirement-test-fixed"
const finding = { code: "EK7777", path: input }
const fixes = [{ code: finding.code, cases: [{ input, output }] }]
function snapshot(files) { return { paths: Object.keys(files).sort(), read: p => files[p] ?? "" } }
const witness = snapshot({
  [input + "/tsconfig.json"]: '{"compilerOptions":{"noEmit":true},"files":["main.vibe"]}',
  [input + "/main.vibe"]: "old form",
  [output + "/main.vibe"]: "new form"
})
function compiler(mode = "fix") {
  return (_binary, args, cwd) => {
    const text = readFileSync(cwd + "/main.vibe", "utf8")
    if (args.includes("--fix")) {
      if (mode === "no-op") return { status: 0, stdout: "", stderr: "" }
      writeFileSync(cwd + "/main.vibe", mode === "wrong-output" ? "wrong form" : "new form")
      return { status: mode === "bad-fix" ? 2 : 0, stdout: mode === "bad-fix" ? "error TS1234" : mode === "unregistered" ? "" : "EK7777 ×1", stderr: "" }
    }
    if (text === "old form") return { status: 2, stdout: "main.vibe(1,1): error EK7777", stderr: "" }
    return { status: mode === "standalone-fails" ? 2 : 0, stdout: "", stderr: "" }
  }
}
test("new error without a fix fails; the same error with a compiling --fix witness passes", () => {
  const required = requiredRetirements(new Map(), registry(7777, "errorCategory"), [])
  assert.equal(required.length, 1)
  assert.deepEqual(witnessFor(required[0], []), [])
  assert.equal(witnessFor(required[0], fixes).length, 1)
  verifyWitness("EK7777", fixes[0].cases[0], witness, ".", process.execPath, compiler())
})
test("demotion passes; re-promotion fails without a fix and passes with a fix in the same snapshot", () => {
  const error = registry(7777, "errorCategory"), warning = registry(7777, "warningCategory")
  assert.deepEqual(requiredRetirements(error, warning, []), [])
  const raised = requiredRetirements(warning, error, [])
  assert.equal(raised.length, 1)
  assert.equal(witnessFor(raised[0], []).length, 0)
  verifyWitness("EK7777", witnessFor(raised[0], fixes)[0], witness, ".", process.execPath, compiler())
})
test("quick-fix proof rejects no-op, wrong output, introduced errors and standalone compile failures", () => {
  for (const mode of ["no-op", "wrong-output", "bad-fix", "standalone-fails", "unregistered"])
    assert.throws(() => verifyWitness("EK7777", fixes[0].cases[0], witness, ".", process.execPath, compiler(mode)), undefined, mode)
  assert.throws(() => verifyWitness("EK7777", fixes[0].cases[0], witness, ".", "/missing-compiler"), /missing built compiler/)
})
test("widened errors need their own case, not an unrelated working fix", () => {
  const existing = registry(7777, "errorCategory")
  const required = requiredRetirements(existing, existing, [{ path: input, codes: ["EK7777"] }])
  assert.equal(required.length, 1)
  assert.equal(witnessFor(required[0], [{ code: "EK7777", cases: [{ input: input + "-other", output }] }]).length, 0)
})
test("reviewed exceptions require diagnostic, scope, VIP, Will and an approval reference", () => {
  const approval = { code: "EK7777", case: input, vip: "VIP-41",
    approval: { by: "Will", reference: "effectscript-11 2026-11-03 23:05Z" }, reason: "explicit exception" }
  assert.equal(approvalFor(finding, [approval]), true)
  for (const bad of [{ ...approval, vip: "" }, { ...approval, approval: { by: "Agent", reference: "yes" } },
    { ...approval, case: input + "-other" }, { ...approval, approval: { by: "Will", reference: "" } }])
    assert.equal(approvalFor(finding, [bad]), false)
  assert.equal(approvalFor({ code: "EK7777" }, [approval]), false)
})
test("unchanged fail sources and existing errors are not new retirements; source changes are", () => {
  const diagnostic = input + "/expected/diagnostics.txt"
  const before = snapshot({ [input + "/main.vibe"]: "old form", [diagnostic]: "main.vibe(1,1): error EK7777" })
  const wording = snapshot({ ...Object.fromEntries(before.paths.map(p => [p, before.read(p)])),
    [input + "/expected/messages.txt"]: "new wording" })
  assert.deepEqual(changedFailCases(before, wording, [input + "/expected/messages.txt"])[0].codes, [])
  const after = snapshot({ [input + "/main.vibe"]: "widened form", [diagnostic]: before.read(diagnostic) })
  assert.deepEqual(changedFailCases(before, after, [input + "/main.vibe"])[0].codes, ["EK7777"])
  const demoted = snapshot({ [input + "/main.vibe"]: "widened form", [diagnostic]: "main.vibe(1,1): warning EK7777" })
  assert.deepEqual(changedFailCases(before, demoted, [diagnostic])[0].codes, [])
})
test("parser category aliases override ahead-of-implementation registry categories; comments are inert", () => {
  const sources = [
    { path: "typescript/tsc/internal/parser/throw.go", text: "const Code int32 = 7777\nconst Severity = diagnostics.CategoryWarning" },
    { path: "typescript/tsc/internal/core/registry.go", text: 'var VibeDiagnosticCategories = map[string]string{"EK7777": "error"}' },
    ...source('var EK7777 = message(parser.Code, parser.Severity, "rule")\n// message(8888, errorCategory, "comment")')
  ]
  assert.equal(categories(sources).get("EK7777"), "warning")
  assert.equal(categories(sources).has("EK8888"), false)
  assert.throws(() => categories(source('var X = message(7777, unknownSeverity, "rule")')), /unresolved/)
})
test("generated registry diffs agree with an independent severity transition oracle", () => {
  fc.assert(fc.property(fc.array(fc.record({
    ordinal: fc.integer({ min: 1, max: 9999 }),
    before: fc.constantFrom("absent", "error", "warning", "off"),
    after: fc.constantFrom("absent", "error", "warning", "off"),
    widened: fc.boolean(), hasFix: fc.boolean()
  }), { maxLength: 40 }), rows => {
    const unique = [...new Map(rows.map(r => [r.ordinal, r])).values()]
    const render = side => source(unique.filter(r => r[side] !== "absent").map(r =>
      "var E" + r.ordinal + " = " + (r[side] === "off"
        ? "messageOff(" + r.ordinal + ', "rule")'
        : "message(" + r.ordinal + ", " + r[side] + 'Category, "rule")')).join("\n") ||
        'var Sentinel = messageOff(99999, "sentinel")')
    const before = categories(render("before")), after = categories(render("after"))
    const cases = unique.filter(r => r.widened && r.after === "error").map(r =>
      ({ path: input + r.ordinal, codes: ["EK" + String(r.ordinal).padStart(4, "0")] }))
    const required = requiredRetirements(before, after, cases)
    const expected = unique.flatMap(r => r.after !== "error" ? [] :
      [r.before !== "error" && "new error severity", r.widened && "new or widened .fail case"]
        .filter(Boolean).map(kind => ["EK" + String(r.ordinal).padStart(4, "0"), kind]))
    assert.deepEqual(required.map(r => [r.code, r.kind]).sort(), expected.sort())
    for (const r of unique) {
      const code = "EK" + String(r.ordinal).padStart(4, "0")
      const entries = r.hasFix ? [{ code, cases: [{ input: input + r.ordinal, output }] }] : []
      for (const f of required.filter(f => f.code === code)) assert.equal(witnessFor(f, entries).length > 0, r.hasFix)
    }
  }), { seed: 36151010, numRuns: 500 })
})

test("jj commit-range fixtures reject a late fix and exercise the full admission path", async () => {
  const { spawnSync } = await import("node:child_process")
  const { mkdtempSync, mkdirSync, rmSync, chmodSync } = await import("node:fs")
  const { tmpdir } = await import("node:os")
  const { join } = await import("node:path")
  const { auditRange } = await import("./retirement-gate.mjs")
  const root = mkdtempSync(join(tmpdir(), "retirement-jj-"))
  const binary = join(root, "fixture-compiler")
  const command = (...args) => {
    const result = spawnSync("jj", args, { cwd: root, encoding: "utf8" })
    assert.equal(result.status, 0, result.stderr)
    return result.stdout.trim()
  }
  const put = (path, text) => {
    mkdirSync(join(root, path, ".."), { recursive: true })
    writeFileSync(join(root, path), text)
  }
  const revision = () => command("log", "--no-graph", "-r", "@", "-T", "commit_id")
  const commit = description => { command("describe", "-m", description); return revision() }
  const setRegistry = severity => put("typescript/tsc/internal/vibelang/diagnostics.go",
    'var Sentinel = message(9999, warningCategory, "sentinel")\nvar X = message(7777, ' + severity + 'Category, "rule")')
  try {
    command("git", "init", "--quiet", ".")
    command("config", "set", "--repo", "user.name", "Retirement fixtures")
    command("config", "set", "--repo", "user.email", "retirement@example.invalid")
    put("typescript/tsc/internal/vibelang/diagnostics.go", 'var Sentinel = message(9999, warningCategory, "sentinel")')
    put("fixture-compiler", '#!/usr/bin/env node\n' +
      'const fs=require("node:fs");const p="main.vibe";const text=fs.readFileSync(p,"utf8");' +
      'if(process.argv.includes("--fix")){fs.writeFileSync(p,"new form");console.log("EK7777 ×1");process.exit(0)}' +
      'if(text==="old form"){console.log("main.vibe(1,1): error EK7777");process.exit(2)}\n')
    chmodSync(binary, 0o755)
    const base = commit("baseline")
    command("new")
    setRegistry("error")
    for (const path of witness.paths) put(path, witness.read(path))
    put(input + "/expected/diagnostics.txt", "main.vibe(1,1): error EK7777")
    const missing = commit("error without fix")
    const check = head => auditRange({ root, base, head, binary })
    assert.ok(check(missing).failures.some(f => f.includes("EK7777") && f.includes(missing.slice(0, 12))))
    command("new")
    put("docs/design/retirement-fixes.json", JSON.stringify(fixes))
    const late = commit("fix too late")
    assert.ok(check(late).failures.some(f => f.includes(missing.slice(0, 12))))
    command("new", base)
    setRegistry("error")
    for (const path of witness.paths) put(path, witness.read(path))
    put(input + "/expected/diagnostics.txt", "main.vibe(1,1): error EK7777")
    put("docs/design/retirement-fixes.json", JSON.stringify(fixes))
    const together = commit("error and tested fix together")
    assert.deepEqual(check(together).failures, [])
    command("new")
    setRegistry("warning")
    put("docs/design/retirement-fixes.json", "[]")
    put(input + "/expected/diagnostics.txt", "main.vibe(1,1): warning EK7777")
    const demoted = commit("warning needs no fix")
    assert.deepEqual(auditRange({ root, base: together, head: demoted, binary }).failures, [])
    command("new")
    setRegistry("error")
    put(input + "/expected/diagnostics.txt", "main.vibe(1,1): error EK7777")
    const raised = commit("re-promotion missing fix")
    assert.ok(auditRange({ root, base: demoted, head: raised, binary }).failures.length)
    put("docs/design/retirement-fixes.json", JSON.stringify(fixes))
    const restored = commit("re-promotion with tested fix in same commit")
    assert.deepEqual(auditRange({ root, base: demoted, head: restored, binary }).failures, [])
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test("a per-form error cannot hide behind a warning default or native diagnostic identity", () => {
  assert.equal(requiredRetirements(registry(7777, "warningCategory"), registry(7777, "warningCategory"),
    [{ path: input, codes: ["EK7777"] }]).length, 1)
  const warning = nativeCategories('{"rule":{"code":7777,"category":"Warning"}}')
  const error = nativeCategories('{"rule":{"code":7777,"category":"Error"}}')
  assert.equal(requiredRetirements(warning, error, [])[0].code, "TS7777")
  assert.equal(requiredRetirements(error, warning, []).length, 0)
  assert.throws(() => nativeCategories('{"rule":{"code":7777,"category":"unknown"}}'), /unresolved/)
})

{
  const dir = "typescript/vibelang/cases/retirement-header.fail"
  const main = dir + "/main.vibe"
  const diagnostics = dir + "/expected/diagnostics.txt"
  const snapshot = files => ({ paths: Object.keys(files).sort(), read: path => files[path] ?? "" })
  const golden = codes => codes.map(code => "main.vibe(4,13): error " + code).join("\n")
  const program = header => header + '\nexport effect function main() { const f = fork sleep("1 minute"); return f }\n'
  const before = snapshot({
    [main]: program("// expect: EK1703 EK4838 TS2345"),
    [diagnostics]: golden(["EK1703", "EK4838", "TS2345"])
  })
  const after = snapshot({
    [main]: program("// expect: EK1703 EK4838"),
    [diagnostics]: golden(["EK1703", "EK4838"])
  })
  const codes = (a, b, changed = [main, diagnostics]) => changedFailCases(a, b, changed)[0].codes

  test("removing a helper diagnostic from an expectation header does not widen rejection", () => {
    assert.deepEqual(codes(before, after), [])
  })

  test("new diagnostics remain retirements when only expectation headers change", () => {
    const added = snapshot({ [main]: after.read(main), [diagnostics]: golden(["EK1703", "EK4838", "EK7777"]) })
    assert.deepEqual(codes(before, added), ["EK7777"])
  })

  test("written program and configuration changes still require retirement authority", () => {
    const changedProgram = snapshot({ [main]: after.read(main).replace('sleep("1 minute")', "42"), [diagnostics]: after.read(diagnostics) })
    assert.deepEqual(codes(before, changedProgram), ["EK1703", "EK4838"])
    const changedConfig = snapshot({ [main]: after.read(main), [diagnostics]: after.read(diagnostics), [dir + "/tsconfig.json"]: "{}" })
    assert.deepEqual(codes(before, changedConfig), ["EK1703", "EK4838"])
  })

  test("compiler directives and later comments are not harness headers", () => {
    for (const [oldText, newText] of [
      ["// @ts-ignore\nconst x = 1", "// @ts-expect-error\nconst x = 1"],
      ['const x = "// expect: EK1703"', 'const x = "// expect: EK4838"'],
      ["const x = 1\n// expect: EK1703", "const x = 1\n// expect: EK4838"],
      ["// expect: EK1703\u2028const x = 1", "// expect: EK1703\u2028const x = 2"],
      ["// expect: EK1703\u2029const x = 1", "// expect: EK1703\u2029const x = 2"]
    ]) {
      const a = snapshot({ [main]: oldText, [diagnostics]: golden(["EK1703"]) })
      const b = snapshot({ [main]: newText, [diagnostics]: golden(["EK1703"]) })
      assert.deepEqual(codes(a, b), ["EK1703"])
    }
  })

  test("all harness source extensions support metadata changes; data and declarations retain bytes", () => {
    for (const extension of [".vibe", ".vibex", ".ts", ".mts", ".cts", ".json", ".d.ts"]) {
      const path = dir + "/main" + extension
      const a = snapshot({ [path]: before.read(main), [diagnostics]: before.read(diagnostics) })
      const b = snapshot({ [path]: after.read(main), [diagnostics]: after.read(diagnostics) })
      assert.deepEqual(codes(a, b, [path, diagnostics]), [".json", ".d.ts"].includes(extension) ? ["EK1703", "EK4838"] : [], extension)
    }
  })

  test("new fail cases and newly added source files are still checked", () => {
    assert.deepEqual(codes(snapshot({}), after), ["EK1703", "EK4838"])
    const newSource = snapshot({ [main]: after.read(main), [diagnostics]: after.read(diagnostics), [dir + "/helper.ts"]: "export const helper = 1" })
    assert.deepEqual(codes(before, newSource), ["EK1703", "EK4838"])
  })

  test("generated diagnostic subsets agree with an independent set-difference oracle", () => {
    const pool = ["EK1703", "EK4838", "TS2345", "TS2353", "TS2322", "EK7777"]
    fc.assert(fc.property(fc.subarray(pool), fc.subarray(pool), (oldCodes, newCodes) => {
      const oldHeader = "// expect: " + oldCodes.join(" ")
      const newHeader = "// expect: " + newCodes.join(" ")
      const a = snapshot({ [main]: program(oldHeader), [diagnostics]: golden(oldCodes) })
      const b = snapshot({ [main]: program(newHeader), [diagnostics]: golden(newCodes) })
      const expected = newCodes.filter(code => !oldCodes.includes(code))
      assert.deepEqual(codes(a, b), expected, "metadata preserves existing diagnostics")
      const changed = snapshot({ [main]: program(newHeader).replace("return f", "return 42"), [diagnostics]: golden(newCodes) })
      assert.deepEqual(codes(a, changed), newCodes, "written source changes retain every diagnostic")
    }), { seed: 48381703, numRuns: 512 })
  })
}
