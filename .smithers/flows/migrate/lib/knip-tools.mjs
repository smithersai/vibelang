// Knip's compiler registry also supplies the source extensions used when a
// package import resolves to built JavaScript. Older Knip releases consult
// only their built-in extensions there, even after a native compiler is wired.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"
import { unifiedDiff } from "./react-tools.mjs"
import { patchedDependencies, setYamlMap } from "./upgrade.mjs"

const mapperPath = "dist/util/to-source-path.js"
const marker = "configuredSourceExtensions"

function patchMapper(text) {
  if (text.includes(marker) && /findFileWithExtensions\(basePath, configuredSourceExtensions\)/.test(text)) return text
  const start = "export const getModuleSourcePathHandler = (chief) => {"
  const lookup = "findFileWithExtensions(basePath, sourceExtensions)"
  if (text.split(start).length !== 2 || text.split(lookup).length !== 2) {
    throw new Error("unsupported compiled-output mapper layout")
  }
  return text.replace(start, start + "\n    const configuredSourceExtensions = [...new Set([...sourceExtensions, ...chief.config.compilers.keys()])];")
    .replace(lookup, "findFileWithExtensions(basePath, configuredSourceExtensions)")
}

function installedKnip(root, manifest) {
  const require = createRequire(join(root, manifest))
  for (const modules of require.resolve.paths("knip") ?? []) {
    const dir = join(modules, "knip")
    const file = join(dir, "package.json")
    if (!existsSync(file)) continue
    const pkg = JSON.parse(readFileSync(file, "utf8"))
    return pkg.name === "knip" ? { dir, version: pkg.version } : undefined
  }
}

/** Persist Knip's native compiled-output mapping with the package manager. */
export function wireKnipCompiledOutputs({ root, manifests, manager }) {
  const changed = [], warnings = []
  const write = (file, before, after) => {
    if (before === after) return
    mkdirSync(dirname(join(root, file)), { recursive: true })
    writeFileSync(join(root, file), after)
    if (!changed.includes(file)) changed.push(file)
  }
  const installs = new Map()
  for (const file of manifests) {
    const pkg = JSON.parse(readFileSync(join(root, file), "utf8"))
    if (!pkg.dependencies?.knip && !pkg.devDependencies?.knip) continue
    const installed = installedKnip(root, file)
    if (!installed) {
      warnings.push(file + ": install Knip before setup can check its native compiled-output mapping")
      continue
    }
    installs.set("knip@" + installed.version, installed)
  }
  for (const [key, installed] of installs) {
    try {
      const entry = readFileSync(join(installed.dir, mapperPath), "utf8")
      const after = patchMapper(entry)
      const manifestText = readFileSync(join(root, "package.json"), "utf8")
      const workspace = "pnpm-workspace.yaml"
      const workspaceText = existsSync(join(root, workspace)) ? readFileSync(join(root, workspace), "utf8") : undefined
      const configured = [...patchedDependencies("package.json", manifestText),
        ...(workspaceText === undefined ? [] : patchedDependencies(workspace, workspaceText))].find(patch => patch.key === key)
      if (configured) {
        const patch = readFileSync(join(root, configured.patch), "utf8")
        if (!patch.includes(marker)) throw new Error("the repository already patches this release in " + configured.patch + "; preserve that patch and add configured compiler extensions to its source mapper")
        continue
      }
      if (after === entry) continue // This installed release already supports it.
      if (manager !== "pnpm" && manager !== "bun") throw new Error("native compiled-output mapping needs a package-manager patch; setup persists patches for pnpm and Bun")
      const path = "patches/" + key + ".patch"
      const existing = existsSync(join(root, path)) ? readFileSync(join(root, path), "utf8") : ""
      if (existing && !existing.includes(marker)) throw new Error("preserve the existing " + path + " and add configured compiler extensions to its source mapper")
      if (!existing) write(path, "", unifiedDiff(mapperPath, entry, after))
      const pkg = JSON.parse(manifestText)
      if (manager === "pnpm" && workspaceText !== undefined && !pkg.pnpm?.patchedDependencies) {
        write(workspace, workspaceText, setYamlMap(workspaceText, "patchedDependencies", { [key]: path }))
      } else {
        const holder = manager === "pnpm" ? (pkg.pnpm ??= {}) : pkg
        holder.patchedDependencies = { ...holder.patchedDependencies, [key]: path }
        write("package.json", manifestText, JSON.stringify(pkg, null, 2) + "\n")
      }
    } catch (error) {
      warnings.push(key + ": " + error.message)
    }
  }
  return { changed, warnings }
}
