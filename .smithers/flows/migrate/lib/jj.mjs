// The target repository's version control, through jj only. A Git checkout
// becomes a colocated jj repository, so its Git history stays as it was.
import { existsSync } from "node:fs"
import { join } from "node:path"
import { must, quote, run } from "./util.mjs"

export async function ensureRepo(root) {
  if (existsSync(join(root, ".jj"))) return { initialized: false }
  await must(existsSync(join(root, ".git")) ? "jj git init --colocate" : "jj git init", { cwd: root })
  return { initialized: true }
}

/** The commit id of a revision, @- by default: the last committed change. */
export async function commitId(root, revision = "@-") {
  const { stdout } = await must(`jj log -r ${quote(revision)} --no-graph -T commit_id`, { cwd: root })
  return stdout.trim()
}

/** The paths the working-copy change touches, with jj's status letter. */
export async function changedPaths(root) {
  const { stdout } = await must("jj diff --summary -r @", { cwd: root })
  return stdout.split("\n").filter(Boolean).map((line) => ({ status: line[0], path: line.slice(2) }))
}

/** The repository-relative paths of the files the working-copy commit tracks. */
export async function trackedFiles(root) {
  const { stdout } = await must("jj file list -r @", { cwd: root })
  return stdout.split("\n").filter(Boolean)
}

/** Commits the working-copy change with message and returns the new commit's id, or null when nothing changed. */
export async function commit(root, message) {
  if (!(await changedPaths(root)).length) return null
  await must(`jj commit -m ${quote(message)}`, { cwd: root })
  return commitId(root, "@-")
}

/** Restores paths in the working copy from a revision; a path absent there is removed. */
export async function restore(root, revision, paths) {
  if (!paths.length) return
  await must(`jj restore --from ${quote(revision)} ${paths.map(quote).join(" ")}`, { cwd: root })
}

/** A file's text at a revision, or null when it does not exist there. */
export async function fileAt(root, revision, path) {
  const result = await run(`jj file show -r ${quote(revision)} ${quote(path)}`, { cwd: root })
  return result.code === 0 ? result.stdout : null
}

/** The commit a bookmark points to, or null when it does not exist. */
export async function bookmarkTarget(root, name) {
  const result = await run(`jj log -r ${quote(`bookmarks(exact:${JSON.stringify(name)})`)} --no-graph -T 'commit_id ++ "\\n"'`, { cwd: root })
  const ids = result.code === 0 ? result.stdout.split("\n").filter(Boolean) : []
  return ids.length === 1 ? ids[0] : null
}

/** Points a bookmark at a revision, creating it or moving it forward; restart also moves it back or sideways. */
export async function setBookmark(root, name, revision, { restart = false } = {}) {
  await must(`jj bookmark set ${quote(name)} -r ${quote(revision)}${restart ? " --allow-backwards" : ""}`, { cwd: root })
}

/**
 * Moves a bookmark to revision, a re-run's commit on parent. When the bookmark
 * is on an earlier commit on parent, revision replaces it, a sideways move jj
 * refuses unless told; anything built on the earlier commit keeps the refusal.
 */
export async function replaceBookmark(root, name, revision, parent) {
  const target = await bookmarkTarget(root, name)
  await setBookmark(root, name, revision, { restart: Boolean(target) && (await commitId(root, `${target}-`)) === parent })
}

/** Starts a new working-copy change on a revision. */
export async function newAt(root, revision) {
  await must(`jj new ${quote(revision)}`, { cwd: root })
}
