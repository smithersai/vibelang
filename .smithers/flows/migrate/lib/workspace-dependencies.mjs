import { realpathSync } from "node:fs"
import { dirname, join, resolve } from "node:path"

// Before installation, explicit local protocols retain their source intent.
// Once a package is installed, its nearest resolved identity is authoritative:
// a semver peer can be a workspace link, and a registry copy can shadow one.
const localSpec = /^(?:workspace:|file:|link:|\*$)/
const physical = path => { try { return realpathSync(path) } catch { return undefined } }

export function localPackageDependencies(root, byName) {
  const base = resolve(root)
  const byPath = new Map()
  for (const pkg of byName.values()) {
    const path = physical(resolve(base, pkg.dir))
    if (path) byPath.set(path, pkg)
  }
  const installed = new Map()
  const lookup = (dir, name) => {
    const key = dir + "\0" + name
    if (installed.has(key)) return installed.get(key)
    for (let at = resolve(base, dir); ; at = dirname(at)) {
      const path = physical(join(at, "node_modules", name))
      if (path) {
        const result = { found: true, pkg: byPath.get(path) }
        installed.set(key, result)
        return result
      }
      if (at === base || dirname(at) === at) break
    }
    const result = { found: false }
    installed.set(key, result)
    return result
  }
  return pkg => [...new Set(Object.entries({
    ...pkg.manifest.dependencies, ...pkg.manifest.devDependencies,
    ...pkg.manifest.peerDependencies, ...pkg.manifest.optionalDependencies
  }).flatMap(([name, spec]) => {
    if (typeof spec !== "string") return []
    const resolved = lookup(pkg.dir, name)
    const dependency = resolved.found ? resolved.pkg : localSpec.test(spec) ? byName.get(name) : undefined
    return dependency ? [dependency] : []
  }))]
}
