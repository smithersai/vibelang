import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

// The mirrors used by CI and cfbox do not necessarily carry VCS metadata.
const skippedDirectories = new Set(["node_modules", "dist", "built", "out", "fixtures", "testdata"])
const exemptions = new Map([
  ["docs/tools/diagnostic-archive-examples.mjs", "Reads Go fuzz corpus headers as data"],
  ["docs/tools/diagnostic-archive-examples.test.mjs", "Contains Go fuzz corpus fixture text"],
  ["docs/tools/go-check-selectors.test.mjs", "Contains synthetic selector examples"],
  ["scripts/go-build-flags.test.mjs", "Deliberately unflagged audit fixtures"],
  ["typescript/Herebyfile.mjs", "Upstream TypeScript build rules"],
  ["scripts/native-output.sh", "Forwards compile flags from its caller"],
  ["scripts/go-test-cache.test.mjs", "Compares cache entries for different compile flags"],
])

export function goBuildSources(root = fileURLToPath(new URL("../../", import.meta.url)), directory = "") {
  return readdirSync(join(root, directory), { withFileTypes: true }).flatMap(entry => {
    const file = directory + entry.name
    if (entry.isDirectory()) {
      if (file === "typescript/tsc" || skippedDirectories.has(entry.name) ||
          (entry.name.startsWith(".") && entry.name !== ".smithers")) return []
      return goBuildSources(root, file + "/")
    }
    return entry.isFile() && /\.(?:sh|ts|mjs)$/.test(file) && !exemptions.has(file) &&
      /\bgo\s+(?:build|test|run)\b|["']go["']|native-output\.sh/.test(readFileSync(join(root, file), "utf8")) ? [file] : []
  }).sort()
}
