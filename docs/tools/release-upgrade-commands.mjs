#!/usr/bin/env node
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"

const tick = String.fromCharCode(96)
const codeSpans = new RegExp(tick + "([^" + tick + "]+)" + tick, "g")

// Only the latest release's upgrade advice describes the current compiler.
// Older release history and the table's "Before" examples retain old commands.
export function releaseUpgradeProblems(text) {
  const lines = text.split(/\r?\n/)
  const problems = []
  let release = false, upgrade = false
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]
    if (/^## \d/.test(line)) {
      if (release) break
      release = true
      continue
    }
    if (!release) continue
    if (/^### /.test(line)) upgrade = /^### Upgrade from\b/.test(line)
    if (!upgrade || !/^\s*\|/.test(line)) continue
    const cells = line.split(/(?<!\\)\|/)
    if (cells.length < 4) continue
    const advice = cells.slice(2, -1).join("|")
    for (const span of advice.matchAll(codeSpans)) {
      const words = span[1].trim().split(/\s+/)
      const executable = words.findIndex(word => /^(?:[./][^\s]*\/)?vibelang(?:@[^\s]+)?$/.test(word))
      if (executable < 0) continue
      const launcher = words.slice(0, executable).join(" ")
      if (launcher && !/^(?:npx|bunx|pnpm exec|pnpm dlx|bun x|npm exec(?: --)?)$/.test(launcher)) continue
      const args = words.slice(executable + 1)
      const option = args.find(arg => /^--fix(?:$|[-=])/i.test(arg) && !(args[0] === "lint" && arg === "--fix"))
      if (!option) continue
      // A removal notice may show the rejected command rather than advise it.
      const before = advice.slice(0, span.index)
      const after = advice.slice(span.index + span[0].length)
      if (/\b(?:(?:do not|don't|never|no longer)\s+(?:run|use|invoke)|unsupported|removed|retired|unavailable)\s*$/i.test(before) ||
          /^\s+(?:is|was)\s+(?:unsupported|removed|retired|unavailable|not supported|no longer supported)\b/i.test(after)) continue
      problems.push({ line: index + 1, command: span[1], option })
    }
  }
  return problems
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const file = new URL("../user/src/setup/release-notes.md", import.meta.url)
  const problems = releaseUpgradeProblems(readFileSync(file, "utf8"))
  for (const problem of problems) {
    console.error("docs/user/src/setup/release-notes.md:" + problem.line +
      ": current upgrade advice uses the retired compiler option " + problem.option +
      "; describe the source edit or an editor action")
  }
  if (problems.length) process.exitCode = 1
  else console.log("release-upgrade-commands: current repair instructions use supported commands")
}
