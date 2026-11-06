// Reconstruct only the script rewrites the codemod actually recorded.
import { posix } from "node:path"
import { isDeepStrictEqual } from "node:util"
import { replaceWord } from "./codemod.mjs"
import { routePrefix } from "./bundled-imports.mjs"

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
        if (typeof value !== "string" || !/\.vibex?$/.test(edit.module)) throw new Error("unproven module or script")
        const next = replaceWord(value, posix.relative(posix.dirname(manifest), from), posix.relative(posix.dirname(manifest), edit.module))
        if (next === value) throw new Error("stale script receipt")
        before.scripts[edit.script] = next
      }
      // Other manifest changes need their own existing codemod authority.
      const otherAuthority = [...(codemod.exportEdits ?? []), ...(codemod.scriptEdits ?? [])].some(e => e.manifest === manifest)
      return { manifest, ok: isDeepStrictEqual(otherAuthority ? before.scripts : withoutEmittedRoutes(before), otherAuthority ? after.scripts : withoutEmittedRoutes(after)) }
    } catch { return { manifest, ok: false } }
  })
}

// Emission (bundled-imports.mjs) adds and drops `#vibelang/emitted/<path>`
// routes in a manifest it also edits for scripts. Its key fixes the whole
// value: the source ./<path>.vibe or .vibex, its sidecar beside it or under
// .vibe/declarations, and JavaScript under the package's own .vibelang/js.
// Only such a route is the flow's output; any other change still fails.
const sidecarRoute = /^\.\/(?:\.vibe\/declarations\/)?[^?#*]+\.d\.vibex?\.ts$/
function isEmittedRoute(key, value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false
  const keys = Object.keys(value).sort().join()
  if (key === routePrefix + "*") {
    return keys === "default,types,vibelang-source" && value.default === "./.vibelang/js/*.js" && value["vibelang-source"] === "./*.vibe" &&
      (value.types === "./*.d.vibe.ts" || value.types === "./.vibe/declarations/*.d.vibe.ts")
  }
  const path = key.startsWith(routePrefix) ? key.slice(routePrefix.length) : ""
  if (!path || /[*?#\\]|(?:^|\/)\.\.(?:\/|$)/.test(path) || keys !== "default,types,vibelang-source") return false
  const source = /^\.\/(.+)(\.vibex?)$/.exec(value["vibelang-source"])
  if (!source || source[1] !== path) return false
  const types = sidecarRoute.test(value.types) && value.types.endsWith("/" + posix.basename(path) + ".d" + source[2] + ".ts")
  const output = typeof value.default === "string" && value.default.startsWith("./.vibelang/js/") && /\.jsx?$/.test(value.default) && !/(?:^|\/)\.\.(?:\/|$)/.test(value.default)
  return types && output
}

function withoutEmittedRoutes(json) {
  if (json?.imports === null || typeof json?.imports !== "object" || Array.isArray(json.imports)) return json
  // Emission deletes an imports object it empties, so an empty one is absent.
  const imports = Object.fromEntries(Object.entries(json.imports).filter(([key, value]) => !isEmittedRoute(key, value)))
  const { imports: _, ...rest } = json
  return Object.keys(imports).length ? { ...rest, imports } : rest
}
