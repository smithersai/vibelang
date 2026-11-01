// Nothing machine-specific reaches a target's commits. A migration is
// reviewed and merged in the library's own repository, so a path on the
// machine that ran it, such as the toolchain's or the run's directory, would
// leak where it ran and install nowhere else. Every commit the flow makes
// checks the lines it adds first.
import { homedir } from "node:os"
import { posix } from "node:path"
import { must } from "./util.mjs"

/** The machine's absolute paths that a committed line must not contain. */
export const machineRoots = (...roots) => [...new Set([...roots, homedir()].filter((r) => r && r !== "/"))]

// A path after the slashes: file:/home/x and file:///home/x, not a bare file:// in prose.
const absoluteSpecifier = /\b(?:file|link|portal):\/+[^\s"'`,/][^\s"'`,]*/g
const under = (path, root) => path === root || path.startsWith(root.replace(/\/$/, "") + "/")
const mentionsRoot = (text, root) => {
  let at = text.indexOf(root)
  while (at >= 0) {
    const after = text[at + root.length]
    if (!after || /[\s/"'`),;\]}]/.test(after)) return true
    at = text.indexOf(root, at + 1)
  }
  return false
}

/** Machine-root paths in prose and specifiers; virtual editor file: URIs remain portable. */
export function absolutePaths(text, roots) {
  const specifiers = [...text.matchAll(absoluteSpecifier)].map(m => {
    let path
    try { path = posix.normalize(decodeURIComponent(new URL(m[0]).pathname)) }
    catch { path = posix.normalize(m[0].replace(/^[^:]+:\/+/, "/")) }
    return { text: m[0], path }
  })
  // A machine-root-looking substring of a virtual URI is not a host path.
  const prose = text.replace(absoluteSpecifier, "")
  const found = []
  const sorted = [...roots].filter(r => r && r !== "/").sort((a,b) => b.length - a.length)
  for (const root of sorted) {
    if (mentionsRoot(prose, root) || specifiers.some(s => under(s.path, root))) found.push(root)
  }
  for (const s of specifiers) if (sorted.some(root => under(s.path, root))) found.push(s.text)
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
