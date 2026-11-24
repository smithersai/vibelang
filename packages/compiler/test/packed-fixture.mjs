import { spawnSync } from "node:child_process"
import { mkdirSync, symlinkSync } from "node:fs"
import { join } from "node:path"

// Preserve the packlist and export map. The test environment provides the
// dependencies, so npm's resolver and registry are outside this fixture.
export function unpackPackage(archive, destination) {
  mkdirSync(destination, { recursive: true })
  const result = spawnSync("tar", ["-xf", archive, "-C", destination, "--strip-components=1"], { encoding: "utf8" })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(result.stderr)
}

export function linkDependency(modules, name, installedModules) {
  symlinkSync(join(installedModules, name), join(modules, name), "junction")
}
