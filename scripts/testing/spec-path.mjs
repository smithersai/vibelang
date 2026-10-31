import { existsSync } from "node:fs"
import { fileURLToPath } from "node:url"

// Node property tests use the same chapter lookup order as Go's SpecPath.
// A missing specification remains an error when the caller reads it.
export function SpecPath(chapter) {
  for (const dir of ["src", "history/src"]) {
    const path = fileURLToPath(new URL("../../docs/design/" + dir + "/" + chapter, import.meta.url))
    if (existsSync(path)) return path
  }
  throw new Error("missing specification chapter: " + chapter)
}
