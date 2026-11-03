// Reconstruct only the script rewrites the codemod actually recorded.
import { posix } from "node:path"
import { isDeepStrictEqual } from "node:util"
import { replaceWord } from "./codemod.mjs"

export function packageScriptProofs({ files, codemod, manifestSnapshots = {} }) {
  const moved = new Map(files.filter(f => f.migrated).map(f => [f.path, f.planned]))
  const manifests = [...new Set((codemod?.packageScriptEdits ?? []).map(e => e.manifest))]
  return manifests.map(manifest => {
    try {
      const snapshot = manifestSnapshots[manifest]
      const before = JSON.parse(snapshot.before), after = JSON.parse(snapshot.after)
      if (!before.scripts || typeof before.scripts !== "object" || Array.isArray(before.scripts)) throw new Error("no scripts")
      for (const edit of codemod.scriptEdits ?? []) if (edit.manifest === manifest) {
        if (before.scripts[edit.script] !== edit.before || typeof edit.after !== "string") throw new Error("stale Vite script receipt")
        before.scripts[edit.script] = edit.after
      }
      for (const edit of codemod.packageScriptEdits) if (edit.manifest === manifest) {
        const from = moved.get(edit.module), value = before.scripts[edit.script]
        if (!from) continue // A reverted module authorizes no replacement.
        if (typeof value !== "string" || !edit.module.endsWith(".vibe")) throw new Error("unproven module or script")
        const next = replaceWord(value, posix.relative(posix.dirname(manifest), from), posix.relative(posix.dirname(manifest), edit.module))
        if (next === value) throw new Error("stale script receipt")
        before.scripts[edit.script] = next
      }
      // Other manifest changes need their own existing codemod authority.
      const otherAuthority = [...(codemod.exportEdits ?? []), ...(codemod.scriptEdits ?? [])].some(e => e.manifest === manifest)
      return { manifest, ok: isDeepStrictEqual(otherAuthority ? before.scripts : before, otherAuthority ? after.scripts : after) }
    } catch { return { manifest, ok: false } }
  })
}
