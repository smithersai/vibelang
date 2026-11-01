// Internal scratch root shared by the compile cache and compiler outputs.
// Importing a project must not create an application-owned TMPDIR.
import { statSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, resolve } from "node:path"

export function temporaryRoot() {
  let path = resolve(tmpdir())
  for (;;) {
    try {
      if (statSync(path).isDirectory()) return path
    } catch (error) {
      if (error.code !== "ENOENT" && error.code !== "ENOTDIR") throw error
    }
    const parent = dirname(path)
    if (parent === path) throw new Error("vibelang: no existing temporary directory")
    path = parent
  }
}
