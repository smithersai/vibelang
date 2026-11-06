import { existsSync, statSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, isAbsolute, join, relative, resolve } from "node:path"

// Only written .ts names participate. In particular, this hook never matches
// dependency .js imports, which must keep Bun's native CommonJS handling.
export function migratedImports(build, options = {}) {
  const cwd = process.cwd()
  const root = resolve(options.root || cwd)
  const virtual = new Set(Object.keys(build.config.files || {}).map(file => resolve(cwd, file)))
  const present = file => virtual.has(file) || existsSync(file)
  const fileExists = file => {
    if (virtual.has(file)) return true
    try { return statSync(file, { throwIfNoEntry: false })?.isFile() === true }
    catch (error) { if (error.code === "ENOTDIR") return false; throw error }
  }
  const escape = value => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  // External wildcards span path separators, unlike filesystem globs.
  const wildcard = pattern => new RegExp("^" + pattern.split("*").map(escape).join(".*") + "$")
  const external = (build.config.external || []).map(pattern => ({
    pattern, glob: wildcard(pattern),
    absolute: pattern.startsWith(".") ? wildcard(resolve(cwd, pattern)) : undefined
  }))
  let aliases
  function paths() {
    if (aliases) return aliases
    let backendPath
    for (const from of [join(root, "package.json"), import.meta.url]) {
      try { backendPath = createRequire(from).resolve("vibelang/project"); break } catch {}
    }
    if (!backendPath) throw new Error("vibelang-unplugin: cannot find vibelang/project for Bun paths aliases")
    const require = createRequire(import.meta.url)
    const { nearestProject, workspaceProject } = require(backendPath)
    const { aliasImport, forgetPaths } = require(join(dirname(backendPath), "paths-imports.mjs"))
    // Each build reads current configuration, including inherited paths.
    forgetPaths()
    return aliases = { nearestProject, workspaceProject, aliasImport }
  }

  // Bun loses an in-memory entry when an onResolve filter matches its name,
  // even if the callback returns nothing. Keep those requests out of the hook.
  const virtualNames = new Set()
  for (const file of Object.keys(build.config.files || {})) {
    virtualNames.add(file)
    virtualNames.add(resolve(cwd, file))
    virtualNames.add(relative(cwd, resolve(cwd, file)))
    virtualNames.add("./" + relative(cwd, resolve(cwd, file)))
  }
  const exclusions = [...virtualNames].map(escape).join("|")
  const filter = new RegExp("^(?!.*\\.d\\.ts$)" + (exclusions ? "^(?!(?:" + exclusions + ")$)" : "") + ".*\\.ts$")
  build.onResolve({ filter, namespace: "file" }, ({ path, importer }) => {
    if (!importer || path.endsWith(".d.ts")) return
    const filePath = path.startsWith("./") || path.startsWith("../") || isAbsolute(path)
    if (!filePath && build.config.packages === "external") return { path, external: true }
    if (external.some(({ pattern, glob, absolute }) =>
      glob.test(path) || (!filePath && path.startsWith(pattern + "/")) ||
      (filePath && absolute?.test(resolve(dirname(importer), path))))) return { path, external: true }
    let source
    if (filePath) {
      const target = resolve(dirname(importer), path)
      if (present(target) || present(target.slice(0, -3) + ".tsx")) return
      source = target.slice(0, -3) + ".vibe"
      if (!existsSync(source)) return
    } else {
      const { nearestProject, workspaceProject, aliasImport } = paths()
      const config = options.project
        ? workspaceProject(importer, root, resolve(root, options.project))
        : nearestProject(importer)
      source = aliasImport(config, path, { migratedTypeScript: true, fileExists })
      if (!source?.endsWith(".vibe")) return
    }
    if (process.env.VIBELANG_UNPLUGIN_DEBUG) console.error("vibelang-unplugin: Bun migrated import " + path + " from " + importer + " -> " + source)
    return { path: source }
  })
}
