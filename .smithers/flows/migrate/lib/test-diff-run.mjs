// Snapshot the actual jj trees, not the agent's list of files it says it edited.
// Unchanged files need only their names for selector evaluation; changed tests
// and fixtures retain exact contents. Snapshots are pinned to commit ids.
import { mkdirSync } from "node:fs"
import { join, posix } from "node:path"
import * as Jj from "./jj.mjs"
import { isProtectedFile, loadGlob, verifyTestDiff, testDiffMarkdown } from "./test-diff.mjs"
import { must, quote, writeJson, writeText } from "./util.mjs"

export async function verifyRepositoryTests({ ts, target, base = "@-", bridges = [], generatedFiles = [], renames, directories = [target], scratch, cwd = ".", globRoot, parseVibe }) {
  mkdirSync(scratch, { recursive: true })
  const from = await Jj.commitId(target, base)
  const to = await Jj.commitId(target, "@")
  const before = Object.fromEntries((await Jj.trackedFiles(target, from)).map(p => [p, null]))
  const after = Object.fromEntries((await Jj.trackedFiles(target, to)).map(p => [p, null]))
  const summary = await must(`jj diff --from ${quote(from)} --to ${quote(to)} --summary --color never`, { cwd: target })
  const changed = new Set(Jj.parseChangedPaths(summary.stdout).flatMap(c => [c.path, c.from].filter(Boolean)).filter(isProtectedFile))
  // Dependency assertions need the owning manifest from both pinned trees,
  // including an unchanged pre-existing runtime dependency. Never use live files.
  const snapshots = new Set(changed)
  for (const file of changed) {
    let dir = posix.dirname(file)
    while (true) {
      const manifest = posix.join(dir, "package.json")
      if (Object.hasOwn(before, manifest) || Object.hasOwn(after, manifest)) { snapshots.add(manifest); break }
      if (dir === ".") break
      dir = posix.dirname(dir)
    }
  }
  for (const file of snapshots) for (const [tree, revision] of [[before, from], [after, to]]) {
    if (!Object.hasOwn(tree, file)) continue
    const bytes = await must(`set -o pipefail; jj file show -r ${quote(revision)} ${quote(file)} | base64`, { cwd: target })
    // Preserve binary fixtures as bytes; decode source without discarding its
    // BOM or replacing invalid UTF-8 sequences.
    const buffer = Buffer.from(bytes.stdout, "base64")
    try { tree[file] = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(buffer) }
    catch { tree[file] = buffer }
  }
  // Resolve from the importing test first: monorepos can install different
  // Vite versions in different packages. Resolution is lazy for non-glob edits.
  const glob = file => loadGlob([join(target, posix.dirname(file)), join(target, cwd), ...directories], ts)
  const result = { ...verifyTestDiff({ ts, before, after, renames, bridges, generatedFiles, glob, scratch, cwd, globRoot, parseVibe }), from, to }
  writeJson(join(scratch, "test-diff.json"), result)
  writeText(join(scratch, "test-diff.md"), testDiffMarkdown(result))
  return result
}
