import { closeSync, openSync, readFileSync, readSync, statSync } from "node:fs"

// The rule of the compiler's ast.HasVibeLangDirective (VIP-42): the first line
// of a TypeScript source, after a byte order mark and a #! line.
const directive = /^\uFEFF?(?:#![^\n]*\n)?\/\/ @vibe[ \t]*(?:[\r\n]|$)/
const typeScriptSource = /\.(?:tsx?|[cm]ts)$/
const typeScriptDeclaration = /\.d\.(?:[cm]ts|(?:[^./\\]+\.)?ts)$/

/** Whether `text`, the content of `file`, is a TypeScript source with the `// @vibe` directive. */
export function hasVibeDirective(file, text) {
  return typeScriptSource.test(file) && !typeScriptDeclaration.test(file) && directive.test(text)
}

// A directive sits on the first line or the one after a #! line.
function head(file) {
  const buffer = Buffer.alloc(4096)
  const descriptor = openSync(file, "r")
  try {
    const bytes = readSync(descriptor, buffer, 0, buffer.length, 0)
    const text = buffer.toString("utf8", 0, bytes)
    // A full buffer is not EOF. Finish a long first line before accepting it.
    const incomplete = bytes === buffer.length && !/[\r\n]/.test(text)
    return incomplete || text.replace(/^\uFEFF/, "").startsWith("#!") ? readFileSync(file, "utf8") : text
  } finally {
    closeSync(descriptor)
  }
}

/** Whether the file on disk at `file` is a TypeScript source with the `// @vibe` directive. */
export function fileHasVibeDirective(file) {
  if (file.includes("\0") || !typeScriptSource.test(file) || typeScriptDeclaration.test(file) || !statSync(file, { throwIfNoEntry: false })?.isFile()) return false
  return directive.test(head(file))
}

/** Whether `file` is VibeLang source: a .vibe or .vibex file, or a TypeScript source with the directive. */
export const isVibeLangFile = (file) => !file.includes("\0") && (/\.vibex?$/.test(file) || fileHasVibeDirective(file))
