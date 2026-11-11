#!/usr/bin/env node
// The source revision a release is built from, and the files that revision tracks.
// build-binaries.sh records the revision beside the binaries, make-packages.mjs
// records it in manifest.json, and publish.sh refuses tarballs from another one.
//
//   node scripts/release/revision.mjs [root]                    # prints "<revision> <true|false>"; true is a clean tree
//   node scripts/release/revision.mjs --manifest <file> [root]  # exits 1 unless this checkout may publish that manifest
import { execFileSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const run = (root, command, args) => execFileSync(command, args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 256 * 1024 * 1024 })
const kind = (root) => existsSync(join(root, ".jj")) ? "jj" : existsSync(join(root, ".git")) ? "git" : undefined

// sourceRevision names the commit whose tree this checkout holds. clean is
// false when the checkout has changes that commit lacks.
export function sourceRevision(root) {
  let revision, clean
  switch (kind(root)) {
    case "jj": {
      // jj snapshots every edit into the working-copy commit. An empty one
      // leaves the tree equal to its parent, which is the released commit.
      const template = 'if(empty && !conflict && parents.len() == 1, parents.map(|parent| parent.commit_id()).join("") ++ " true", commit_id ++ " false")'
      const printed = run(root, "jj", ["log", "--no-graph", "-r", "@", "-T", template]).trim().split(" ")
      revision = printed[0]
      clean = printed[1] === "true"
      break
    }
    case "git":
      revision = run(root, "git", ["rev-parse", "HEAD"]).trim()
      clean = run(root, "git", ["status", "--porcelain"]).trim() === ""
      break
    default:
      throw new Error("not a jj or git checkout, so no source revision identifies this tree")
  }
  if (!/^[0-9a-f]{40,64}$/.test(revision)) throw new Error(`unexpected source revision ${JSON.stringify(revision)}`)
  return { revision, clean }
}

// trackedFiles lists every file of the checkout's commit, relative to root.
// Ignored and untracked files are absent, so a release staged from this list
// cannot carry them.
export function trackedFiles(root) {
  switch (kind(root)) {
    case "jj": return run(root, "jj", ["file", "list"]).split("\n").filter(Boolean)
    case "git": return run(root, "git", ["ls-files", "-z"]).split("\0").filter(Boolean)
    default: throw new Error("not a jj or git checkout, so no file list identifies this tree")
  }
}

// readRecord reads a key=value file such as dist-npm/bin/revision or a
// per-target receipt. A missing file is undefined.
export function readRecord(path) {
  if (!existsSync(path)) return undefined
  return Object.fromEntries(readFileSync(path, "utf8").split("\n").filter(Boolean).map((line) => {
    const at = line.indexOf("=")
    return [line.slice(0, at), line.slice(at + 1)]
  }))
}

// publishProblems says why a manifest must not be published from this checkout.
export function publishProblems(root, manifest) {
  const problems = []
  if (manifest.rehearsalOnly?.length) problems.push(`the tarballs were assembled with ${manifest.rehearsalOnly.join(" and ")}, for rehearsal only; run make-packages.mjs without ${manifest.rehearsalOnly.length > 1 ? "them" : "it"}`)
  if (!manifest.revision) return [...problems, "manifest.json records no source revision; run build-binaries.sh and make-packages.mjs again"]
  let source
  try {
    source = sourceRevision(root)
  } catch (error) {
    return [...problems, error.message]
  }
  if (source.revision !== manifest.revision) problems.push(`the tarballs were assembled from revision ${manifest.revision}, but this checkout is ${source.revision}; build and assemble again`)
  if (!source.clean) problems.push("this checkout has changes that are not in a commit; commit them, then build and assemble again")
  return problems
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2)
  const manifest = args[0] === "--manifest" ? args.splice(0, 2)[1] : undefined
  const root = resolve(args[0] ?? fileURLToPath(new URL("../../", import.meta.url)))
  try {
    if (manifest) {
      const problems = publishProblems(root, JSON.parse(readFileSync(manifest, "utf8")))
      if (problems.length) {
        console.error(`release revision: refusing to publish:\n${problems.map((problem) => `  - ${problem}`).join("\n")}`)
        process.exit(1)
      }
    } else {
      const { revision, clean } = sourceRevision(root)
      console.log(`${revision} ${clean}`)
    }
  } catch (error) {
    console.error(`release revision: ${error.message}`)
    process.exit(1)
  }
}
