// Snapshot the actual jj trees, not the agent's list of files it says it edited.
// Unchanged files need only their names for selector evaluation; changed tests
// and fixtures retain exact contents. Snapshots are pinned to commit ids.
import { existsSync, mkdirSync, readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { join, posix } from "node:path"
import * as Jj from "./jj.mjs"
import { isProtectedFile, loadGlob, verifyTestDiff, testDiffMarkdown } from "./test-diff.mjs"
import { must, quote, writeJson, writeText } from "./util.mjs"

export async function verifyRepositoryTests({ ts, target, base = "@-", bridges = [], generatedFiles = [], renames, directories = [target], scratch, cwd = ".", declarationImportStyle, globRoot, parseVibe }) {
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
  const styles = new Map()
  const configStyle = async (path, seen = new Set()) => {
    if (seen.has(path)) throw new Error("cyclic tsconfig extends")
    const text = path.startsWith("/") ? readFileSync(path, "utf8") : await Jj.fileAt(target, to, path)
    if (text === null) throw new Error("cannot read declarationImportStyle config: " + path)
    const parsed = ts.parseConfigFileTextToJson(path, text)
    if (parsed.error) throw new Error("cannot parse declarationImportStyle config: " + path)
    const raw = parsed.config
    let style
    for (const parent of [raw.extends ?? []].flat()) {
      if (typeof parent !== "string") throw new Error("unsupported tsconfig extends")
      let resolved
      if (parent.startsWith(".")) {
        resolved = posix.normalize(posix.join(posix.dirname(path), parent))
        if (path.startsWith("/") ? !existsSync(resolved) : !Object.hasOwn(after, resolved)) resolved += ".json"
        if (resolved.startsWith("../")) throw new Error("tsconfig extends leaves the repository")
      } else {
        const require = createRequire(path.startsWith("/") ? path : join(target, path))
        try { resolved = require.resolve(parent) }
        catch { resolved = require.resolve(parent + "/tsconfig.json") }
        if (resolved.startsWith(target + "/") && Object.hasOwn(after, resolved.slice(target.length + 1)))
          resolved = resolved.slice(target.length + 1)
      }
      style = await configStyle(resolved, new Set([...seen, path])) ?? style
    }
    style = raw.compilerOptions?.declarationImportStyle ?? style
    if (style !== undefined && !["js", "ts", "vibe"].includes(style)) throw new Error("unknown declarationImportStyle")
    return style
  }
  if (declarationImportStyle === undefined) {
    for (const file of changed) {
      let dir = posix.dirname(file)
      while (true) {
        const config = posix.join(dir, "tsconfig.json")
        if (Object.hasOwn(after, config)) {
          try { styles.set(file, await configStyle(config) ?? "vibe") }
          catch (error) { styles.set(file, error) }
          break
        }
        if (dir === ".") break
        dir = posix.dirname(dir)
      }
    }
    declarationImportStyle = file => {
      const style = styles.get(file) ?? "vibe"
      if (style instanceof Error) throw style
      return style
    }
  }
  // Resolve from the importing test first: monorepos can install different
  // Vite versions in different packages. Resolution is lazy for non-glob edits.
  const glob = file => loadGlob([join(target, posix.dirname(file)), join(target, cwd), ...directories], ts)
  const result = { ...verifyTestDiff({ ts, before, after, renames, bridges, generatedFiles, glob, scratch, cwd, declarationImportStyle, globRoot, parseVibe }), from, to }
  writeJson(join(scratch, "test-diff.json"), result)
  writeText(join(scratch, "test-diff.md"), testDiffMarkdown(result))
  return result
}
