// A #vibelang/emitted/ route serves tools that read sources
// (bundled-imports.mjs). Published declarations never name one
// (docs/user/src/setup/developer-tools.md, emitted routes): a consumer cannot
// resolve it, because the route's targets do not ship. The compiler names a
// routed module by its own output; a toolchain that does not, or a route it
// cannot resolve, leaves the route in the declarations, and the record flow
// then restores that package's routes (steps.mjs, emitMigratedJs).
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join, relative, sep } from "node:path"
import { routePrefix } from "./bundled-imports.mjs"

/** The declaration files under directory that name a route: relative, with forward slashes, sorted. */
export function declarationRouteLeaks(directory) {
  const leaks = []
  const visit = dir => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const file = join(dir, entry.name)
      if (entry.isDirectory()) visit(file)
      else if (/\.d\.[cm]?ts$/.test(entry.name) && readFileSync(file, "utf8").includes(routePrefix))
        leaks.push(relative(directory, file).split(sep).join("/"))
    }
  }
  if (existsSync(directory)) visit(directory)
  return leaks.sort()
}
