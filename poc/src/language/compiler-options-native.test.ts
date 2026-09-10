import { expect, test } from "bun:test"
import { MANDATORY_CHECKER_OPTIONS, validateVibeLangTsconfig } from "./compiler-options.ts"

test("native option diagnostics retain every TypeScript newline and Unicode offset", () => {
  const options = JSON.stringify({...MANDATORY_CHECKER_OPTIONS, strict:false})
  for (const newline of ["\n", "\r", "\r\n", "\u2028", "\u2029"]) {
    const prefix = "// 😀" + newline + '{"compilerOptions":' + newline
    const text = prefix + options + "}"
    const [issue] = validateVibeLangTsconfig("virtual/../config.json", text)
    expect(issue).toMatchObject({code:"VIBE6001",fileName:"virtual/../config.json",line:3,column:2,start:prefix.length+1})
    expect(text.slice(issue!.start, issue!.start+issue!.length)).toBe('"strict":false')
  }
})

test("native option diagnostics handle empty input and parser recovery without a host crash", () => {
  const empty = validateVibeLangTsconfig("config.json", "")
  expect(empty).toHaveLength(6)
  expect(empty.every(issue => issue.code === "VIBE6001" && issue.start === 0 && issue.length === 0 && issue.line === 1 && issue.column === 1)).toBe(true)
  const text = JSON.stringify({compilerOptions:MANDATORY_CHECKER_OPTIONS})
  const malformed = validateVibeLangTsconfig("config.json", text.slice(0,-1))
  expect(malformed.some(issue => issue.code.startsWith("TS"))).toBe(true)
  expect(validateVibeLangTsconfig("config.json", '{"extends":"/do-not-read/base.json"}')).toHaveLength(6)
})

test("native unknown option diagnostics display an authored unpaired escape without repairing its identity", () => {
  const options = JSON.stringify(MANDATORY_CHECKER_OPTIONS).slice(1,-1)
  const text = '{"compilerOptions":{"bad\\ud800":true,' + options + '}}'
  const [issue] = validateVibeLangTsconfig("config.json", text)
  expect(issue?.code).toBe("VIBE6003")
  expect(issue?.message).toContain('"bad\\ud800"')
  expect(issue?.message).not.toContain("�")
  expect(text.slice(issue!.start, issue!.start+issue!.length)).toBe('"bad\\ud800"')
})

test("many native configuration diagnostics retain positions after a large source prefix", () => {
  const prefix = "/* " + "😀".repeat(100_000) + " */\r\n"
  const text = prefix + JSON.stringify({compilerOptions:{...MANDATORY_CHECKER_OPTIONS,...Object.fromEntries(Array.from({length:1000}, (_, i) => [`unclassified${i}`,true]))}})
  const issues = validateVibeLangTsconfig("config.json", text)
  expect(issues).toHaveLength(1000)
  for (const [index, issue] of issues.entries()) {
    const name = `"unclassified${index}"`
    expect(text.slice(issue.start, issue.start+issue.length)).toBe(name)
    expect(issue.line).toBe(2)
    expect(issue.column).toBe(issue.start-prefix.length+1)
  }
})
