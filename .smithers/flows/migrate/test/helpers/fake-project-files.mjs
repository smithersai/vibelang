import { quote } from "../../lib/util.mjs"

// Existing fake compilers model a project that can rewrite Vibe files anywhere
// in root. Answer the real compiler's read-only scope query before those writes.
export function fakeProjectFiles(root, { shell = false } = {}) {
  const body = String.raw`const scopeFs = process.getBuiltinModule("node:fs"), scopePath = process.getBuiltinModule("node:path")
function scopeWalk(dir) {
 for (const entry of scopeFs.readdirSync(dir, { withFileTypes: true })) {
  if (entry.name === "node_modules" || entry.name.startsWith(".")) continue
  const file = scopePath.join(dir, entry.name)
  if (entry.isDirectory()) scopeWalk(file)
  else if (/\.vibex?$/.test(entry.name)) console.log(file)
 }
}
function scopeRoot() {
 const start = process.cwd()
 for (let dir = start;; dir = scopePath.dirname(dir)) {
  if (scopeFs.existsSync(scopePath.join(dir, ".jj"))) return dir
  if (scopePath.dirname(dir) === dir) return start
 }
}
scopeWalk(${root === undefined ? "scopeRoot()" : JSON.stringify(root)})`
  if (shell) return `for scope_arg in "$@"; do
 case "$scope_arg" in --listFilesOnly) ${quote(process.execPath)} -e ${quote(body)}; exit $?;; esac
done\n`
  return `if (process.argv.includes("--listFilesOnly")) {\n${body}\nprocess.exit(0)\n}\n`
}
