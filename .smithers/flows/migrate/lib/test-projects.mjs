// Give typed lint's nearest-tsconfig discovery the repository's existing test project.
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join, posix, resolve } from "node:path"
import { listSources, isTestFile } from "./inventory.mjs"
import { inSubmodule, submodulePaths } from "./wire.mjs"

const canonical = value => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === "object" ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value
const optionsOf = project => Object.fromEntries(Object.entries(project.parsed.options).filter(([key]) => key !== "configFilePath"))
const identityOf = project => JSON.stringify(canonical({ options: optionsOf(project), files: [...project.files].sort() }))
const hash = text => createHash("sha256").update(text).digest("hex")

export function wireTestProjects({ root, packages, ts }) {
  root = resolve(root)
  const changed = [], projects = [], warnings = []
  const submodules = submodulePaths(root), selected = new Set(packages.map(pkg => posix.normalize(pkg.dir)))
  const ownerOf = file => {
    let dir = posix.dirname(file)
    while (true) {
      if (existsSync(join(root, dir, "package.json"))) return selected.has(dir) ? dir : null
      if (dir === ".") return selected.has(".") ? "." : null
      dir = posix.dirname(dir)
    }
  }
  const projectCache = new Map()
  const readProject = file => {
    file = posix.normalize(file)
    if (projectCache.has(file)) return projectCache.get(file)
    const read = ts.readConfigFile(join(root, file), ts.sys.readFile)
    if (read.error) { projectCache.set(file, null); return null }
    const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, dirname(join(root, file)), {}, join(root, file))
    if (parsed.errors.some(error => error.category === ts.DiagnosticCategory.Error && error.code !== 18003)) { projectCache.set(file, null); return null }
    const project = { parsed, files: new Set(parsed.fileNames.map(file => resolve(file))) }
    projectCache.set(file, project)
    return project
  }
  const nearest = file => ts.findConfigFile(dirname(join(root, file)), ts.sys.fileExists)
  const covers = (project, file) => project?.files.has(resolve(root, file))
  const groups = new Map()
  for (const pkg of packages) for (const file of listSources(root, pkg.dir)) {
    if (!isTestFile(file) || inSubmodule(submodules, file)) continue
    const owner = ownerOf(file)
    if (owner === null) continue
    const parts = posix.relative(owner, file).split("/")
    const index = parts.findIndex(part => ["test", "tests", "__tests__"].includes(part))
    if (index < 0) continue // A config beside a co-located test would also change product files' project.
    const dir = posix.join(owner, ...parts.slice(0, index + 1))
    if (!groups.has(dir)) groups.set(dir, { owner, files: new Set() })
    groups.get(dir).files.add(file)
  }
  for (const [dir, group] of groups) {
    const files = [...group.files].sort()
    const uncovered = files.filter(file => {
      const config = nearest(file)
      return !config || !covers(readProject(posix.relative(root, config)), file)
    })
    if (!uncovered.length) continue
    const config = posix.join(dir, "tsconfig.json")
    if (existsSync(join(root, config))) {
      warnings.push(config + ": existing nearest test config excludes " + uncovered.join(", ") + "; preserved it unchanged")
      continue
    }
    const candidates = readdirSync(join(root, group.owner)).filter(name => /^tsconfig(?:\..+)?\.json$/.test(name))
      .map(name => posix.join(group.owner, name)).filter(file => file !== config)
      .map(file => ({ file, project: readProject(file) }))
      .filter(candidate => candidate.project && files.every(file => covers(candidate.project, file)))
      .sort((a, b) => a.project.files.size - b.project.files.size || a.file.localeCompare(b.file))
    if (!candidates.length) {
      warnings.push(dir + ": no existing package TypeScript project contains every test; no nearest-config bridge was written (" + uncovered.join(", ") + ")")
      continue
    }
    // Preserve existing nested configs; a bridge cannot repair their separate program.
    const shadowed = uncovered.filter(file => {
      const current = nearest(file)
      return current && posix.relative(root, current).startsWith(dir + "/")
    })
    if (shadowed.length) {
      warnings.push(dir + ": nested existing test configs exclude " + shadowed.join(", ") + "; preserved them unchanged")
      continue
    }
    const namedTests = candidates.filter(candidate => /(?:^|\.)test[s]?(?:\.|$)|(?:^|\.)spec(?:\.|$)/.test(posix.basename(candidate.file)))
    const pool = namedTests.length ? namedTests : candidates
    if (new Set(pool.map(candidate => identityOf(candidate.project))).size > 1) {
      warnings.push(dir + ": several existing projects include the tests with different options or membership; no nearest-config bridge was guessed")
      continue
    }
    const chosen = pool[0]
    const previous = uncovered.map(file => {
      const before = nearest(file)
      return { file, config: before ? posix.relative(root, before) : null }
    })
    let parent = posix.relative(dir, chosen.file)
    if (!parent.startsWith(".")) parent = "./" + parent
    const text = JSON.stringify({ extends: parent }, null, 2) + "\n"
    mkdirSync(join(root, dir), { recursive: true })
    try { writeFileSync(join(root, config), text, { flag: "wx" }) }
    catch (error) {
      if (error.code !== "EEXIST") throw error
      warnings.push(config + ": a configuration appeared while setup was running; preserved it unchanged")
      continue
    }
    const bridge = readProject(config)
    // A bridge is only useful when it reproduces the original project's exact membership.
    const sameFiles = bridge && identityOf(bridge) === identityOf(chosen.project)
    if (!sameFiles || files.some(file => !covers(bridge, file))) {
      if (readFileSync(join(root, config), "utf8") === text) rmSync(join(root, config))
      // Keep this failure visible; never silently accept a partial program as repaired.
      throw new Error(config + ": generated test project did not preserve " + chosen.file + "'s options and complete file membership")
    }
    changed.push(config)
    projects.push({ config, extends: chosen.file, text, files, previous,
      optionsHash: hash(JSON.stringify(canonical(optionsOf(bridge)))), programHash: hash(identityOf(bridge)),
      programFiles: [...bridge.files].map(file => posix.relative(root, file)).sort() })
  }
  return { changed, projects, warnings }
}
