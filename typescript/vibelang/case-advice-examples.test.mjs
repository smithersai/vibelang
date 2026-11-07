import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"

const here = path.dirname(fileURLToPath(import.meta.url))

// EK4402 names the service that replaces a platform API in two columns:
// "Use <service>:   <example>". The compiler takes both columns verbatim from
// the replacement tables in internal/vibelang, so a case that expects one of
// these lines pins a table entry. When an accepted rule changes an entry, such
// as VIP-5 running a returned Effect with an outer try, every case that quotes
// the old entry goes stale. The case suite needs a built compiler and is too
// slow for the merge gate, so this reads files only and runs first.
const ADVICE = /^\s*Use (.+?):   (\S.*)$/

// Every string literal in the Go files of dir, test files excluded: the
// interpreted ones decoded, the raw ones as written.
export function goStrings(dir) {
  const found = new Set()
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith(".go") || name.endsWith("_test.go")) continue
    const text = fs.readFileSync(path.join(dir, name), "utf8")
    for (let i = 0; i < text.length; i++) {
      const c = text[i]
      if (c === "/" && text[i + 1] === "/") i = text.indexOf("\n", i) === -1 ? text.length : text.indexOf("\n", i)
      else if (c === "/" && text[i + 1] === "*") i = text.indexOf("*/", i + 2) + 1
      else if (c === "`") {
        const end = text.indexOf("`", i + 1)
        found.add(text.slice(i + 1, end))
        i = end
      } else if (c === "\x27" || c === "\"") {
        let j = i + 1
        while (j < text.length && text[j] !== c && text[j] !== "\n") j += text[j] === "\\" ? 2 : 1
        if (c === "\"") {
          const body = text.slice(i, j + 1)
          try { found.add(JSON.parse(body)) } catch { found.add(body.slice(1, -1)) }
        }
        i = j
      }
    }
  }
  return found
}

// One line per expected advice line whose service or example no table holds.
export function staleAdvice(casesDir, strings) {
  const stale = []
  for (const name of fs.readdirSync(casesDir).sort()) {
    const file = path.join(casesDir, name, "expected", "messages.txt")
    if (!fs.existsSync(file)) continue
    fs.readFileSync(file, "utf8").split("\n").forEach((line, index) => {
      const m = ADVICE.exec(line)
      if (!m) return
      for (const part of [m[1], m[2]]) {
        if (!strings.has(part)) stale.push(`${name}/expected/messages.txt:${index + 1}: no compiler string ${JSON.stringify(part)}`)
      }
    })
  }
  return stale
}

test("every case quotes the replacement advice the compiler holds", () => {
  const strings = goStrings(path.join(here, "../tsc/internal/vibelang"))
  assert.ok(strings.has("the FileSystem service"), "the replacement tables were not read")
  assert.deepEqual(staleAdvice(path.join(here, "cases"), strings), [])
})

test("a case that quotes a replaced example is reported", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "case-advice-"))
  try {
    const go = path.join(root, "vibelang")
    fs.mkdirSync(go)
    fs.writeFileSync(path.join(go, "platform.go"), [
      "package vibelang",
      "// \"Use the FileSystem service\" in a comment is not a string",
      "var a = map[string]string{\"mkdtemp\": \"try (try FileSystem.FileSystem).makeTempDirectory()\"}",
      "var b = []string{\"the FileSystem service\", `try (try FileSystem.FileSystem).open(path, { flag: \"wx\" })`}",
      "var r = \x27\"\x27",
    ].join("\n"))
    fs.writeFileSync(path.join(go, "platform_test.go"), "package vibelang\nvar t = \"(try FileSystem.FileSystem).makeTempDirectory()\"\n")
    const cases = path.join(root, "cases")
    for (const [name, lines] of [
      ["current.fail", ["Use the FileSystem service:   try (try FileSystem.FileSystem).makeTempDirectory()", "Use the FileSystem service:   try (try FileSystem.FileSystem).open(path, { flag: \"wx\" })"]],
      ["stale.fail", ["readFileSync from fs is platform code.", "Use the FileSystem service:   (try FileSystem.FileSystem).makeTempDirectory()"]],
      ["unnamed.fail", ["  Use the File service:   try (try FileSystem.FileSystem).makeTempDirectory()"]],
    ]) {
      fs.mkdirSync(path.join(cases, name, "expected"), { recursive: true })
      fs.writeFileSync(path.join(cases, name, "expected", "messages.txt"), lines.join("\n") + "\n")
    }
    assert.deepEqual(staleAdvice(cases, goStrings(go)), [
      "stale.fail/expected/messages.txt:2: no compiler string \"(try FileSystem.FileSystem).makeTempDirectory()\"",
      "unnamed.fail/expected/messages.txt:1: no compiler string \"the File service\"",
    ])
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})
