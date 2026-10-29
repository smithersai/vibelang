// Run with Node 22.22.3 or Bun from a jj checkout. Private patterns are supplied in
// VIBELANG_LEAK_PATTERNS (see leaks.ts), never checked into the repository.
import { execFileSync } from "node:child_process"
import { lstatSync, readFileSync } from "node:fs"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { leaks } from "./leaks.ts"
import { publicHygiene } from "./public-hygiene.mjs"

export function upstreamFixture(path) {
  if (!path.startsWith("typescript/")) return false
  if (/(?:^|\/)(?:testdata|baselines)(?:\/|$)/.test(path)) return true
  if (path.startsWith("typescript/vibelang/") || /(?:^|\/)vibelang[^/]*(?:\/|$)/.test(path)) return false
  return /(?:^|\/)(?:test|tests)(?:\/|$)|_test\.go$|\.test\.[cm]?[jt]s$/.test(path)
}

export function trackedLeaks(root) {
  // jj file list snapshots the working copy too, so a newly added source file
  // cannot evade this gate while it is being reviewed.
  const files = execFileSync("jj", ["file", "list"], { cwd: root, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 })
    .trimEnd().split("\n").filter(Boolean)
  const problems = []
  for (const file of files) {
    if (upstreamFixture(file)) continue
    const path = resolve(root, file)
    if (!lstatSync(path).isFile()) continue // do not follow a tracked symlink outside the tree
    const bytes = readFileSync(path)
    if (bytes.includes(0)) continue // binary assets are not text
    const text = bytes.toString("utf8")
    const found = [...leaks(text, { repository: true }), ...publicHygiene(file, text)]
    for (const problem of found) problems.push(file + ": " + problem)
  }
  return problems
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const problems = trackedLeaks(resolve(fileURLToPath(new URL("../../", import.meta.url))))
    if (problems.length) {
      console.error(problems.join("\n"))
      process.exitCode = 1
    } else console.log("tracked-leaks: tracked text files contain no private paths, configured patterns or credentials")
  } catch (error) {
    console.error("tracked-leaks: " + error.message)
    process.exitCode = 1
  }
}
