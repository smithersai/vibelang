// Shared runner template: one build, including every scoped .vibe owner.
import { createHash } from "node:crypto"
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path"
import { fileURLToPath } from "node:url"

// JSONC is data: preserve strings while removing comments and trailing commas.
export function jsonc(text) {
  let out = "", string = false, escaped = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i], next = text[i + 1]
    if (string) {
      out += c
      if (escaped) escaped = false
      else if (c === "\\") escaped = true
      else if (c === '"') string = false
    } else if (c === '"') { string = true; out += c }
    else if (c === "/" && next === "/") { while (i < text.length && text[i] !== "\n") i++; out += "\n" }
    else if (c === "/" && next === "*") {
      i += 2
      while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) i++
      if (i === text.length) throw new Error("Unterminated JSONC comment")
      i++; out += " "
    } else out += c
  }
  let clean = ""; string = false; escaped = false
  for (let i = 0; i < out.length; i++) {
    const c = out[i]
    if (string) {
      clean += c
      if (escaped) escaped = false
      else if (c === "\\") escaped = true
      else if (c === '"') string = false
    } else if (c === '"') { string = true; clean += c }
    else if (c !== "," || !/^[\s]*[}\]]/.test(out.slice(i + 1))) clean += c
  }
  return JSON.parse(clean.replace(/^\uFEFF/, ""))
}

const slash = path => path.split(sep).join("/")
const within = (root, path) => { const r = relative(root, path); return r !== ".." && !r.startsWith(".." + sep) && !isAbsolute(r) }
const configPath = path => existsSync(path) && statSync(path).isDirectory() ? join(path, "tsconfig.json") : path
const ignored = new Set(["node_modules", ".git", ".jj", ".cache", ".vibelang", ".vibelang-toolchain", ".turbo", ".next", ".output", ".repos", ".alchemy", "coverage"])

export function vibeFiles(root, { sourceRoots = ["."], ignoredPaths = [] } = {}) {
  root = resolve(root)
  const excluded = ignoredPaths.map(p => resolve(root, p))
  const files = new Set()
  const walk = directory => {
    if (!within(root, directory) || excluded.some(p => directory === p || within(p, directory))) return
    for (const e of readdirSync(directory, { withFileTypes: true })) {
      if (ignored.has(e.name)) continue
      const path = join(directory, e.name)
      if (e.isDirectory()) {
        const parts = relative(root, path).split(sep)
        if (["dist", "lib", "build"].includes(e.name) && !parts.includes("src")) continue
        walk(path)
      } else if (e.isFile() && e.name.endsWith(".vibe")) files.add(path)
    }
  }
  for (const part of sourceRoots) {
    const dir = resolve(root, part)
    if (!within(root, dir)) throw new Error("Source root is outside the repository: " + part)
    if (existsSync(dir)) walk(dir)
  }
  return [...files].sort()
}

export function compilerCommand(root, binary = process.env.VIBELANG_BINARY) {
  if (binary) return { command: binary, prefix: [] }
  const require = createRequire(join(root, "package.json"))
  const path = require.resolve("vibelang/package.json")
  const manifest = JSON.parse(readFileSync(path, "utf8"))
  const entry = typeof manifest.bin === "string" ? manifest.bin : manifest.bin.vibelang
  return { command: process.execPath, prefix: [resolve(dirname(path), entry)] }
}

export function planBuild(root, config, invoke, onProject = () => {}) {
  root = resolve(root)
  const entries = config.projects.map(p => typeof p === "string" ? { path: p } : p)
  if (!entries.length) throw new Error("The original typecheck has no project root")
  const cache = new Map()
  const project = path => {
    path = configPath(resolve(root, path))
    if (cache.has(path)) return cache.get(path)
    if (!within(root, path)) throw new Error("Project is outside the repository: " + path)
    const started = Date.now()
    const result = invoke(["--showConfig", "-p", path, "--pretty", "false"], { capture: true })
    if (result.error || result.status !== 0) throw new Error("Cannot read project " + slash(relative(root, path)) + ": " + (result.error?.message || [result.stdout, result.stderr].filter(Boolean).join("\n") || "exit " + result.status + (result.signal ? " signal " + result.signal : "")))
    let parsed
    try { parsed = JSON.parse(result.stdout) } catch { throw new Error("Invalid --showConfig response for " + slash(relative(root, path))) }
    const item = { path, files: new Set((parsed.files ?? []).map(f => resolve(dirname(path), f))), references: (parsed.references ?? []).map(r => configPath(resolve(dirname(path), r.path))) }
    cache.set(path, item)
    onProject({ path: slash(relative(root, path)), ms: Date.now() - started, queries: cache.size })
    return item
  }
  const graph = (path, seen = new Set()) => {
    const p = project(path)
    if (seen.has(p.path)) return seen
    seen.add(p.path)
    for (const ref of p.references) graph(ref, seen)
    return seen
  }
  const original = new Set()
  // Ordinary build projects take precedence over a redundant --noEmit check.
  for (const entry of entries.filter(p => !p.noEmit)) for (const p of graph(entry.path)) original.add(p)
  const roots = new Set(original)
  for (const entry of entries) for (const p of graph(entry.path)) roots.add(p)
  const initial = new Set(roots)
  const files = vibeFiles(root, config)
  const uncovered = []
  for (const file of files) {
    if ([...roots].some(p => cache.get(p).files.has(file))) continue
    let dir = dirname(file), owners = []
    while (within(root, dir)) {
      for (const name of readdirSync(dir).sort()) {
        if (name !== "vibe.config.json" && name !== "jsconfig.json" && !/^tsconfig(?:\..+)?\.json$/.test(name)) continue
        const path = join(dir, name)
        if (config.excludedProjects?.some(p => configPath(resolve(root, p)) === path)) continue
        const raw = jsonc(readFileSync(path, "utf8"))
        // An unreferenced options overlay is not an authored source project.
        if (!["tsconfig.json", "vibe.config.json", "jsconfig.json"].includes(name) && !("files" in raw) && !("include" in raw) && !raw.references?.length) continue
        for (const p of graph(path)) if (cache.get(p).files.has(file)) owners.push(p)
      }
      if (owners.length || dir === root) break
      dir = dirname(dir)
    }
    if (!owners.length) { uncovered.push(slash(relative(root, file))); continue }
    for (const p of owners) for (const child of graph(p)) roots.add(child)
  }
  if (uncovered.length) throw new Error("No prepared source project owns these .vibe modules: " + uncovered.join(", "))
  const mapped = new Map()
  const artifacts = new Map()
  const noEmit = path => {
    if (mapped.has(path)) return mapped.get(path)
    const slug = createHash("sha256").update(slash(relative(root, path))).digest("hex").slice(0, 12)
    // Type libraries, implicit composite rootDir and other defaults use the config directory.
    const overlay = join(dirname(path), ".vibelang-typecheck-" + slug + ".json")
    const relativeTo = p => { const r = slash(relative(dirname(overlay), p)); return r.startsWith(".") ? r : "./" + r }
    mapped.set(path, overlay)
    const text = JSON.stringify({ extends: relativeTo(path), compilerOptions: { noEmit: true },
      references: project(path).references.map(p => ({ path: relativeTo(p) })) }, null, 2) + "\n"
    artifacts.set(overlay, text)
    return overlay
  }
  const targets = entries.map(entry => {
    const path = project(entry.path).path
    return entry.noEmit && !original.has(path) ? noEmit(path) : path
  })
  const extra = [...roots].filter(p => !initial.has(p))
  // Build traverses references once, regardless of how many roots reach them.
  // Include only maximal extra roots; their transitive references stay in the graph.
  const extraRoots = extra.filter(p => !extra.some(q => q !== p && graph(q).has(p) && (!graph(p).has(q) || q < p)))
  const projects = [...new Set([...targets, ...extraRoots.map(noEmit)])]
  return { files: files.map(f => slash(relative(root, f))), projects, graph: [...roots].map(p => slash(relative(root, p))).sort(), metadataQueries: cache.size, artifacts: [...artifacts].map(([path, text]) => ({ path, text })) }
}

export function runBuild(root, config, { invoke, prepare, log = console.log } = {}) {
  root = resolve(root)
  if (!invoke) {
    const compiler = compilerCommand(root)
    invoke = (args, { capture = false } = {}) => spawnSync(compiler.command, [...compiler.prefix, ...args], {
      cwd: root, ...(capture ? { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: 60_000 } : { stdio: "inherit" })
    })
  }
  prepare ??= command => spawnSync(command, { cwd: root, shell: true, stdio: "inherit" })
  const started = Date.now()
  const receipt = { at: new Date(started).toISOString(), pid: process.pid, phase: "prepare", prepareMs: null, metadataMs: null, buildMs: null, projects: [], status: null, signal: null, error: null }
  const save = () => {
    mkdirSync(join(root, ".cache"), { recursive: true })
    writeFileSync(join(root, ".cache", "vibelang-typecheck.json"), JSON.stringify(receipt, null, 2) + "\n")
  }
  save()
  try {
    for (const [index, command] of (config.prepare ?? []).entries()) {
      log("[vibe:typecheck] preparing step " + (index + 1) + "/" + config.prepare.length)
      const result = prepare(command)
      if (result.error || result.status !== 0) throw new Error("Typecheck preparation failed at step " + (index + 1) + ": " + (result.error?.code ?? result.signal ?? "exit " + result.status))
    }
    receipt.prepareMs = Date.now() - started
    const metadataStarted = Date.now()
    receipt.phase = "metadata"; save()
    log("[vibe:typecheck] reading project references and .vibe ownership")
    const plan = planBuild(root, config, invoke, project => {
      receipt.projects.push(project)
      if (project.queries % 25 === 0 || project.ms >= 1000) {
        log("[vibe:typecheck] " + project.queries + " project configuration(s), " + project.path + " " + project.ms + "ms")
        save()
      }
    })
    for (const { path, text } of plan.artifacts) {
      mkdirSync(dirname(path), { recursive: true })
      if (!existsSync(path) || readFileSync(path, "utf8") !== text) writeFileSync(path, text)
    }
    receipt.metadataMs = Date.now() - metadataStarted
    receipt.files = plan.files.length
    receipt.graph = plan.graph
    receipt.roots = plan.projects.map(p => slash(relative(root, p)))
    receipt.phase = "build"; save()
    log("[vibe:typecheck] " + plan.files.length + " .vibe source(s), " + plan.graph.length + " unique project(s), " + plan.metadataQueries + " metadata queries; one compiler build")
    const building = Date.now()
    const result = invoke(["--build", ...plan.projects, "--pretty", "false"])
    receipt.buildMs = Date.now() - building
    receipt.status = result.status
    receipt.signal = result.signal ?? null
    if (result.error || result.signal || result.status === null) throw new Error("Compiler build did not finish: " + (result.error?.message ?? result.signal))
    receipt.phase = "complete"
    return result.status
  } catch (error) {
    receipt.error = error.message
    throw error
  } finally { save() }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const here = dirname(fileURLToPath(import.meta.url))
    process.exitCode = runBuild(resolve(here, ".."), JSON.parse(readFileSync(join(here, "typecheck.json"), "utf8")))
  } catch (error) {
    console.error("[vibe:typecheck] " + error.message)
    process.exitCode = 1
  }
}
