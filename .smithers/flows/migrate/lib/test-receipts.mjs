// Fail closed when a test run cannot account for every test and its exit.
import { parseReport, parseVitestJson, tally } from "./tests.mjs"
export function readTestRun({ command, output, code, root, json, report }) {
  const tests = {}, text = output.replace(/\x1b\[[0-9;]*m/g, "").replace(/\r/g, "")
  const add = (name, status) => {
    let key = name, n = 1
    while (key in tests) key = name + " [" + (++n) + "]"
    tests[key] = status
  }
  let summary, unreadable
  if (/\bvitest\b/.test(command)) {
    if (!json) unreadable = "Vitest wrote no fresh JSON report"
    else {
      Object.assign(tests, Object.fromEntries(Object.entries(parseVitestJson(json, root)).map(([k,v])=>[k,["passed","failed"].includes(v)?v:"skipped"])))
      summary = { total: json.numTotalTests, passed: json.numPassedTests, failed: json.numFailedTests,
        skipped: (json.numPendingTests ?? 0) + (json.numTodoTests ?? 0) }
      // File failures are not assertions, but must still fail admission.
      if (json.testResults?.some(f => f.status === "failed" && !f.assertionResults?.some(a => a.status === "failed"))) unreadable = "Vitest file failed outside a test"
    }
  } else if (/\bnode\b[^;&|]*--test\b/.test(command)) {
    const stack = []
    for (const line of text.split("\n")) {
      if (/^✖ failing tests:/.test(line)) break
      const m = /^( *)([▶✔✖﹣])\s(.*?)(?: \([\d.]+m?s\))?( # (?:SKIP|TODO)\b.*)?$/.exec(line)
      if (!m) continue
      const depth = m[1].length / 2, mark = m[2], name = m[3]
      // A closing suite repeats its name at the depth of its opening marker.
      const closing = mark !== "▶" && stack[depth] === name
      stack.length = Math.min(stack.length, depth)
      if (closing) continue
      if (mark === "▶") { stack[depth] = name; continue }
      add([...stack, name].join(" > "), m[4] || mark === "﹣" ? "skipped" : mark === "✔" ? "passed" : "failed")
    }
    const num = key => { const m = [...text.matchAll(new RegExp("^ℹ " + key + " (\\d+)$", "gm"))].at(-1); return m ? Number(m[1]) : undefined }
    summary = { total: num("tests"), passed: num("pass"), failed: (num("fail") ?? 0) + (num("cancelled") ?? 0), skipped: (num("skipped") ?? 0) + (num("todo") ?? 0) }
  } else if (/\bbun\s+test\b/.test(command)) {
    let file = ""
    for (const line of text.split("\n")) {
      if (/^\d+ tests? (?:failed|skipped|todo):$/.test(line)) break
      const f = /^(\S+\.(?:[cm]?[jt]sx?|vibe)):$/.exec(line)
      if (f) file = f[1].replace(/\.(?:ts|tsx|vibe)$/, "")
      const m = /^\((pass|fail|skip|todo)\) (.*?)(?: \[[\d.]+m?s\])?$/.exec(line)
      if (m) add(file + " > " + m[2], m[1] === "pass" ? "passed" : m[1] === "fail" ? "failed" : "skipped")
    }
    const num = key => Number(new RegExp("^ (\\d+) " + key + "$", "m").exec(text)?.[1] ?? 0)
    summary = { total: Number(/^Ran (\d+) tests? across/m.exec(text)?.[1] ?? 0), passed: num("pass"), failed: num("fail"), skipped: num("skip") + num("todo") }
    if (/^ \d+ errors?$/m.test(text)) unreadable = "Bun unhandled errors outside tests"
  } else if (report) {
    Object.assign(tests, parseReport(text, report))
    const m = /^SUMMARY total=(\d+) passed=(\d+) failed=(\d+) skipped=(\d+)$/m.exec(text)
    if (m) summary = Object.fromEntries(["total","passed","failed","skipped"].map((k,i)=>[k,Number(m[i+1])]))
  }
  const counts = tally(tests)
  if (!unreadable && !counts.total) unreadable = "0 tests read"
  if (!unreadable && (!summary || ["total","passed","failed","skipped"].some(k => summary[k] !== (k === "failed" ? counts.failed.length : counts[k])))) unreadable = "runner summary disagrees with per-test lines"
  if (!unreadable && ((code === 0 && counts.failed.length) || (code !== 0 && !counts.failed.length))) unreadable = "exit " + code + " disagrees with failed tests"
  return { code, tests, ...counts, summary, ...(unreadable ? { unreadable } : {}) }
}
export function assertReadableTests(result) {
  if (result.unreadable) throw new Error("tests unreadable: " + result.unreadable)
  if (result.tests && result.summary) {
    const counts = tally(result.tests)
    for (const key of ["total","passed","failed","skipped"]) if (result.summary[key] !== (key === "failed" ? counts.failed.length : counts[key])) throw new Error("tests unreadable: summary disagrees with per-test lines")
    if ((result.code === 0 && counts.failed.length) || (result.code !== 0 && !counts.failed.length)) throw new Error("tests unreadable: unexplained exit " + result.code)
  } else throw new Error("tests unreadable: no runner summary")
  if (!result.tests || !Object.keys(result.tests).length) throw new Error("tests unreadable: 0 tests read")
}
