// Run with Node 22.22.3 or Bun from a jj checkout. macOS and Windows checkouts
// use case-insensitive file systems by default, where two tracked paths that
// differ only by letter case name one file: the checkout keeps one of them and
// reports the other as deleted, so a commit made there deletes it.
import { execFileSync } from "node:child_process"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"

// jj file list snapshots the working copy too, so a newly added file is checked
// while it is being reviewed.
const trackedFiles = (root) =>
  execFileSync("jj", ["file", "list"], { cwd: root, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 }).trimEnd().split("\n").filter(Boolean)

// Groups of distinct tracked paths, files or their parent directories, whose
// lower-cased spellings are equal. Each group is sorted; groups are sorted by
// their first path.
export function caseCollisions(files) {
  const spellings = new Map()
  for (const file of files) {
    const parts = file.split("/")
    for (let end = 1; end <= parts.length; end++) {
      const path = parts.slice(0, end).join("/")
      const key = path.toLowerCase()
      let seen = spellings.get(key)
      if (!seen) spellings.set(key, seen = new Set())
      seen.add(path)
    }
  }
  return [...spellings.values()].filter(seen => seen.size > 1).map(seen => [...seen].sort())
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const groups = caseCollisions(trackedFiles(resolve(fileURLToPath(new URL("../../", import.meta.url)))))
    if (groups.length) {
      console.error(`case-collisions: ${groups.length} tracked path group(s) differ only by letter case; rename each so it differs by more than case:`)
      for (const group of groups) console.error("  " + group.join("  "))
      process.exitCode = 1
    } else console.log("case-collisions: no two tracked paths differ only by letter case")
  } catch (error) {
    console.error("case-collisions: " + error.message)
    process.exitCode = 1
  }
}
