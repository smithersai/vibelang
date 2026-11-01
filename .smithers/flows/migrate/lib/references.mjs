// Non-import paths (scripts, build entrypoints and configuration) that follow a rename.
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { join, posix } from "node:path"
import { packageDirOf } from "./codemod.mjs"
import { commentRanges, parseImports } from "./imports.mjs"
import { isDeclarationFile } from "./util.mjs"

const token = /(?<![\w@/.$-])((?:\.{1,2}\/)*[\w@][\w@.\/-]*?)\.ts(?![\w.\/-])/g
const eligible = /\.(?:ts|tsx|mts|cts|js|mjs|cjs|json|jsonc|ya?ml|toml|sh|nix|vibe)$/
const escape = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

export function rewriteReferences(root, renames, files) {
  const moved = new Set(renames.map(r => r.from))
  const all = new Set(files.map(f => f.endsWith(".vibe") && moved.has(f.replace(/\.vibe$/, ".ts")) ? f.replace(/\.vibe$/, ".ts") : f))
  const edits = []
  for (const file of files) {
    if (!eligible.test(file) || isDeclarationFile(file) || /(^|\/)node_modules\//.test(file)) continue
    const path = join(root, file)
    if (!existsSync(path)) continue
    const source = readFileSync(path, "utf8")
    const imports = parseImports(source)
    const comments = commentRanges(source)
    const next = source.replace(token, (from, stem, offset) => {
      if (comments.some(([start, end]) => start <= offset && offset < end)) return from
      if (imports.some(i => offset >= i.start && offset < i.end)) return from
      const tries = [posix.join(posix.dirname(file), stem), posix.join(packageDirOf(root, file), stem), posix.normalize(stem)].map(x => posix.normalize(x) + ".ts")
      let module = tries.find(x => all.has(x))
      if (!module && stem.includes("/") && !stem.startsWith(".")) {
        const matches = [...all].filter(f => f.endsWith("/" + stem + ".ts"))
        if (matches.length === 1) module = matches[0]
      }
      if (!moved.has(module)) return from
      const to = stem + ".vibe"
      edits.push({ file, from, to, module })
      return to
    })
    if (next !== source) writeFileSync(path, next)
  }
  return edits
}

export function restoreReferences(root, edits, module) {
  const restored = []
  for (const edit of edits.filter(e => e.module === module)) {
    // An importer in the same bulk revert may already be back to .ts.
    const file = existsSync(join(root, edit.file)) ? edit.file : edit.file.replace(/\.vibe$/, ".ts")
    if (!existsSync(join(root, file))) throw new Error(`path-reference importer missing: ${edit.file}`)
    const source = readFileSync(join(root, file), "utf8")
    const comments = commentRanges(source)
    const next = source.replace(new RegExp("(?<![\\w@/.$-])" + escape(edit.to) + "(?![\\w.\\/-])", "g"), (match, offset) => comments.some(([start, end]) => start <= offset && offset < end) ? match : edit.from)
    if (next !== source) { writeFileSync(join(root, file), next); restored.push({ ...edit, file }) }
  }
  return restored
}

