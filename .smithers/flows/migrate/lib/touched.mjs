import { createHash } from "node:crypto"
import { posix } from "node:path"
import { packageScriptProofs } from "./package-script-scope.mjs"
import { isProtectedFile } from "./test-diff.mjs"

// What a batch may change in the repository. A batch renames its modules to
// .vibe, writes their sidecars (beside them or under vibe.sidecarDir), platform siblings, module bodies' declarations and compiler companions, and the codemod points
// package manifests and importers at the renamed modules; the repair agent
// edits the batch's own files. Any other change is foreign: an earlier
// batch's committed module that this batch rewrote (alchemy-5a), a test or config
// the repair edited, a declaration an emit left beside its source. verify
// fails a batch with one, before its record would commit it unseen.
//
// A package's .vibelang/js/ tree is the flow's own output, not a change the
// batch chose: each emit deletes the tree and writes it again from the sources,
// and a loader record there names its dependencies' digests, so a batch in one
// package rewrites another package's record. Every path under it is in scope.
const emitted = /(?:^|\/)\.vibelang\/js\//

/** Every path the batch may touch, repository-relative. */
export function batchScope({ files, codemod, testDiff, manifestSnapshots, sidecar = () => null }) {
  const scope = new Set()
  // A VibeLang module's native declaration, x.d.ts re-exporting its sidecar,
  // sits beside that sidecar, wherever it is written (VIP-27).
  const withSidecars = (path) => {
    if (/\.(?:[cm]?ts|tsx|vibex?)$/.test(path) && !/\.d\.(?:vibex?\.)?[cm]?ts$/.test(path)) scope.add(path.replace(/\.(?:[cm]?ts|tsx|vibex?)$/, extension => /x$/.test(extension) ? ".d.vibex.ts" : ".d.vibe.ts"))
    if (/\.vibex?$/.test(path)) scope.add(path.replace(/\.vibex?$/, ".d.ts"))
    const located = sidecar(path)
    if (located) {
      scope.add(located)
      if (/\.vibex?$/.test(path) && /\.d\.vibex?\.ts$/.test(located)) scope.add(located.replace(/\.d\.vibex?\.ts$/, ".d.ts"))
    }
  }
  for (const f of files) {
    for (const path of [f.planned, f.path]) {
      scope.add(path)
      withSidecars(path)
    }
  }
  for (const file of codemod?.packingFiles ?? []) scope.add(file)
  for (const emit of codemod?.emittedJs ?? []) for(const file of emit.packingFiles ?? []) scope.add(file)
  for (const split of codemod?.platform?.splits ?? []) {
    if (split.platform) scope.add(split.platform)
    // The body the codemod wrote, `module <name> { }`, has its declaration
    // x.vibe.<name>.d.ts beside its migrated source, sidecarDir or not.
    if (split.module) for (const f of files) {
      if (f.planned === split.file && /\.vibex?$/.test(f.path)) scope.add(`${f.path}.${split.module}.d.ts`)
    }
    if (split.privateExports) scope.add(split.privateExports.manifest)
  }
  // A platform companion an earlier toolchain's --fix created for a batch module.
  for (const { companion } of codemod?.platform?.companions ?? []) scope.add(companion)
  for (const edit of codemod?.exportEdits ?? []) scope.add(edit.manifest)
  // A rewritten importer's declaration may name the renamed module, so its sidecar is written again.
  for (const edit of codemod?.importEdits ?? []) {
    scope.add(edit.file)
    if (/\.vibex?$/.test(edit.file)) withSidecars(edit.file)
  }
  for (const edit of codemod?.refEdits ?? []) scope.add(edit.file)
  for (const edit of codemod?.referenceEdits ?? []) scope.add(edit.file)
  for (const edit of codemod?.scriptEdits ?? []) scope.add(edit.manifest)
  for (const proof of packageScriptProofs({ files, codemod, manifestSnapshots })) if (proof.ok) scope.add(proof.manifest)
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
  const rejected = new Set(packageScriptProofs(batch).filter(proof => !proof.ok).map(proof => proof.manifest))
  // A declaration's ownership receipt belongs to that same generated output.
  // Match its directory and full basename digest; unrelated receipts and
  // authored files remain outside scope, including either end of a rename.
  const receiptPrefixes = new Set([...scope].filter(path => /\.d(?:\.vibex?)?\.ts$/.test(path)).map(path =>
    posix.join(posix.dirname(path), ".vibelang-sidecar-" +
      createHash("sha256").update(posix.basename(path)).digest("hex") + "-")))
  const ownReceipt = (path) => {
    const match = /^(.*\.vibelang-sidecar-[a-f0-9]{64}-)[a-f0-9]{64}\.owner$/.exec(path)
    return match !== null && receiptPrefixes.has(match[1])
  }
  const own = (path) => !rejected.has(path) && (scope.has(path) || emitted.test(path) || ownReceipt(path))
  return changed.filter((c) => !own(c.path) || (c.from !== undefined && !own(c.from)))
}
