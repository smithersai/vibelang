import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

// A versioned reference environment keeps framework-only dependencies out of
// the docs toolchain. Publish a complete install atomically for parallel runs.
const here = path.dirname(fileURLToPath(import.meta.url))
export const sources = ["package.json", "bun.lock", "modules.mjs.txt"].map(name => readFileSync(path.join(here, name)))
export const key = createHash("sha256").update(Buffer.concat(sources)).digest("hex")
export const base = path.join(here, ".cache")
export const cache = path.join(base, key)
const pins = JSON.parse(sources[0]).devDependencies
export const ready = directory => {
  try {
    return readFileSync(path.join(directory, "ready"), "utf8") === key &&
      Object.entries(pins).every(([name, version]) =>
        JSON.parse(readFileSync(path.join(directory, "node_modules", name, "package.json"), "utf8")).version === version)
  } catch { return false }
}
