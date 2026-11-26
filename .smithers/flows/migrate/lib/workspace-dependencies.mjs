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

/**
 * Transitive downstream workspace consumer packages that depend on any package
 * in `touchedDirs` and define a `scripts.test` command, sorted by directory (#396).
 */
export function dependentConsumerPackages(root, manifests, touchedDirs) {
  const byName = new Map(manifests.filter(m => m.manifest?.name).map(m => [m.manifest.name, m]))
  const byDir = new Map(manifests.map(m => [m.dir, m]))
  const depsOf = localPackageDependencies(root, byName)
  const rdeps = new Map()
  for (const pkg of manifests) {
    for (const dep of depsOf(pkg)) {
      if (dep.dir === pkg.dir) continue
      const set = rdeps.get(dep.dir) ?? new Set()
      set.add(pkg.dir)
      rdeps.set(dep.dir, set)
    }
  }
  const touched = new Set(touchedDirs)
  const visited = new Set()
  const queue = [...touched]
  while (queue.length) {
    const dir = queue.shift()
    for (const consumer of rdeps.get(dir) ?? []) {
      if (visited.has(consumer)) continue
      visited.add(consumer)
      queue.push(consumer)
    }
  }
  return [...visited]
    .filter(dir => !touched.has(dir))
    .map(dir => byDir.get(dir))
    .filter(pkg => pkg && typeof pkg.manifest?.scripts?.test === "string" && pkg.manifest.scripts.test.trim() !== "")
    .sort((a, b) => a.dir.localeCompare(b.dir))
}
