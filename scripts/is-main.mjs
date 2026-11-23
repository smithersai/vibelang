import { realpathSync } from "node:fs"
import { fileURLToPath } from "node:url"

/** Reports whether the module at metaUrl is the main script invoked by Node, resolving symlinks. */
export function isMain(metaUrl) {
  if (!process.argv[1]) return false
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(metaUrl))
  } catch {
    return false
  }
}
