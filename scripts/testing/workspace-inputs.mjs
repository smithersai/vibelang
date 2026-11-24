import { globSync } from "node:fs"
import { relative, join } from "node:path"
import { fileURLToPath } from "node:url"

const cwd = fileURLToPath(new URL("../../", import.meta.url))

export function workspaceInputPaths(pattern) {
  return globSync(pattern, {
    cwd,
    withFileTypes: true,
    exclude: entry => ["out", "node_modules"].includes(entry.name),
  }).filter(entry => entry.isFile()).map(entry =>
    relative(cwd, join(entry.parentPath, entry.name))
  ).sort()
}
