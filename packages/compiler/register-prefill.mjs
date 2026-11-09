// A cold start of a workspace program compiles one project per package it
// reaches, one at a time, because Node's module hooks are synchronous. Once a
// process has seen two compiles, vibelang/register runs this file to compile
// the rest at once. It only fills the compile cache; every result the program
// runs still comes from compileProjectSync, which also reports any error.
import { existsSync, readFileSync, readdirSync, realpathSync } from "node:fs"
import { availableParallelism } from "node:os"
import { dirname, join, sep } from "node:path"
import { fileURLToPath } from "node:url"
import { loaderScope } from "./loader-scope.mjs"
import { findCompiler, packageRoot, projectBackend } from "./project.mjs"

const runtimeFields = ["dependencies", "peerDependencies", "optionalDependencies"]

// The installed link for a dependency, in this package or a workspace root above it.
function linkOf(directory, name) {
  for (let current = directory; ; current = dirname(current)) {
    const link = join(current, "node_modules", name)
    if (existsSync(link)) return link
    if (dirname(current) === current) return undefined
  }
}

function dependencyNames(directory) {
  try {
    const manifest = JSON.parse(readFileSync(join(directory, "package.json"), "utf8"))
    return runtimeFields.flatMap((field) => Object.keys(manifest[field] ?? {}))
  } catch {
    return []
  }
}

// Whether a package holds a .vibe file, stopping at the first one.
function holdsVibe(directory) {
  let entries
  try {
    entries = readdirSync(directory, { withFileTypes: true })
  } catch {
    return false
  }
  if (entries.some((entry) => entry.isFile() && entry.name.endsWith(".vibe"))) return true
  return entries.some((entry) => entry.isDirectory() && entry.name !== "node_modules" && !entry.name.startsWith(".") &&
    holdsVibe(join(directory, entry.name)))
}

/**
 * The tsconfig of every workspace package the given packages reach through
 * their runtime dependencies, themselves included, when it holds .vibe source.
 * An installed dependency is published JavaScript, so a walk stops there.
 */
export function coldProjects(directories) {
  const packages = new Set()
  const visit = (directory) => {
    if (packages.has(directory)) return
    packages.add(directory)
    for (const name of dependencyNames(directory)) {
      const link = linkOf(directory, name)
      if (link === undefined) continue
      const target = realpathSync(link)
      if (!target.split(sep).includes("node_modules")) visit(target)
    }
  }
  directories.forEach((directory) => visit(realpathSync(directory)))
  return [...packages]
    .filter((directory) => existsSync(join(directory, "tsconfig.json")) && holdsVibe(directory))
    .map((directory) => join(directory, "tsconfig.json"))
}

async function compileAll(projects, limit, debug) {
  const queue = [...projects]
  const worker = async () => {
    for (let project = queue.shift(); project !== undefined; project = queue.shift()) {
      const root = packageRoot(project)
      const backend = projectBackend({ root, compiler: findCompiler(root), debug, [loaderScope]: true })
      // The program's own compile of this project reports what is wrong with it.
      await backend.compile(project).catch(() => undefined)
      await backend.close()
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, projects.length) }, worker))
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const debug = process.env.VIBELANG_REGISTER_DEBUG
    ? (text) => process.stderr.write(`vibelang/register: prefill: ${text}\n`)
    : () => {}
  await compileAll(coldProjects(process.argv.slice(2)), Math.max(2, Math.min(8, availableParallelism() >> 1)), debug)
}
