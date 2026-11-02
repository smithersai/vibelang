import { isProtectedFile } from "./test-diff.mjs"

// What a batch may change in the repository. A batch renames its modules to
// .vibe, writes their sidecars and platform siblings, and the codemod points
// package manifests and importers at the renamed modules; the repair agent
// edits the batch's own files. Any other change is foreign: an earlier
// batch's committed module that --fix rewrote (alchemy-5a), a test or config
// the repair edited, a declaration an emit left beside its source. verify
// fails a batch with one, before its record would commit it unseen.
//
// A package's .vibelang/js/ tree is the flow's own output, not a change the
// batch chose: each emit deletes the tree and writes it again from the sources,
// and a loader record there names its dependencies' digests, so a batch in one
// package rewrites another package's record. Every path under it is in scope.
const emitted = /(?:^|\/)\.vibelang\/js\//

/** Every path the batch may touch, repository-relative. */
export function batchScope({ files, codemod, testDiff }) {
  const scope = new Set()
  for (const f of files) {
    for (const path of [f.planned, f.path]) {
      scope.add(path)
      if (/\.(?:[cm]?ts|vibe)$/.test(path) && !/\.d\.(?:vibe\.)?[cm]?ts$/.test(path)) scope.add(path.replace(/\.(?:[cm]?ts|vibe)$/, ".d.vibe.ts"))
    }
  }
  for (const emit of codemod?.emittedJs ?? []) for(const file of emit.packingFiles ?? []) scope.add(file)
  for (const split of codemod?.platform?.splits ?? []) scope.add(split.platform)
  for (const edit of codemod?.exportEdits ?? []) scope.add(edit.manifest)
  for (const edit of codemod?.importEdits ?? []) scope.add(edit.file)
  for (const edit of codemod?.refEdits ?? []) scope.add(edit.file)
  for (const edit of codemod?.referenceEdits ?? []) scope.add(edit.file)
  for (const edit of codemod?.scriptEdits ?? []) scope.add(edit.manifest)
  if (testDiff?.ok === true) for (const proof of testDiff.files ?? []) {
    if (proof.ok === true && isProtectedFile(proof.file)) scope.add(proof.file)
  }
  return scope
}

/**
 * The working copy's changes (jj.changedPaths) outside the batch's scope, each
 * { status, path } and, for a rename, from. A rename is in scope when both of
 * its ends are.
 */
export function foreignChanges(changed, batch) {
  const scope = batchScope(batch)
  const own = (path) => scope.has(path) || emitted.test(path)
  return changed.filter((c) => !own(c.path) || (c.from !== undefined && !own(c.from)))
}
