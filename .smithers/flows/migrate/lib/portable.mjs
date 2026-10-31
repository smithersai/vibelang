// Nothing machine-specific reaches a target's commits. A migration is
// reviewed and merged in the library's own repository, so a path on the
// machine that ran it, such as the toolchain's or the run's directory, would
// leak where it ran and install nowhere else. Every commit the flow makes
// checks the lines it adds first.
import { homedir } from "node:os"
import { must } from "./util.mjs"

/** The machine's absolute paths that a committed line must not contain. */
export const machineRoots = (...roots) => [...new Set([...roots, homedir()].filter((r) => r && r !== "/"))]

// A path after the slashes: file:/home/x and file:///home/x, not a bare file:// in prose.
const absoluteSpecifier = /\b(?:file|link|portal):\/+[^\s"',/][^\s"',]*/g

/** The absolute paths in text: any of the roots, and a file:, link: or portal: specifier with an absolute path. */
export function absolutePaths(text, roots) {
  const found = []
  for (const root of [...roots].sort((a, b) => b.length - a.length)) {
    if (text.includes(root)) found.push(root)
  }
  for (const m of text.matchAll(absoluteSpecifier)) found.push(m[0])
  return [...new Set(found)]
}

/** The lines the working-copy change adds, by file, from jj's Git-format diff. */
export function addedLines(diff) {
  const out = []
  let file = null
  let line = 0
  for (const text of diff.split("\n")) {
    const header = /^\+\+\+ (?:b\/)?(.*)$/.exec(text)
    if (header) { file = header[1] === "/dev/null" ? null : header[1]; continue }
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)/.exec(text)
    if (hunk) { line = Number(hunk[1]); continue }
    if (!file || text.startsWith("---")) continue
    if (text.startsWith("+")) out.push({ file, line: line++, text: text.slice(1) })
    else if (!text.startsWith("-")) line++
  }
  return out
}

/** Refuses a working-copy change that adds a line with an absolute path of this machine. */
export async function assertPortable(root, roots) {
  const { stdout } = await must("jj diff --git -r @", { cwd: root })
  const problems = []
  for (const added of addedLines(stdout)) {
    for (const path of absolutePaths(added.text, roots)) problems.push(`${added.file}:${added.line}: ${path}`)
  }
  if (problems.length) {
    throw new Error(`the change would commit absolute paths of this machine:\n${problems.slice(0, 20).map((p) => `- ${p}`).join("\n")}`)
  }
}
