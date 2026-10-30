// The Effect upgrade that comes before VibeLang is set up. Every effect and
// @effect/* version on Effect's major line, wherever the repository declares
// it (dependencies, catalogs, overrides), becomes the exact version the
// VibeLang runtime requires, and overrides keep one copy of each installed:
// one ordinary dependency upgrade, reviewed apart from the migration. These
// are text-in, text-out edits: each changes only the versions it names and
// keeps the file's formatting.
import { posix } from "node:path"
import { applyEdits } from "./imports.mjs"

/** An exact version or a ^ or ~ range of one: the specifiers the upgrade moves. Catalog references, workspace, npm: and file: specifiers stay. */
const bumpable = /^([\^~]?)(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)$/
const majorOf = (spec) => Number(/^[\^~]?(\d+)\./.exec(spec)?.[1])
const isEffect = (name) => name === "effect" || name.startsWith("@effect/")

/** The member directory globs of a root package.json's `workspaces` and a pnpm-workspace.yaml's `packages`. */
export function workspaceGlobs(manifestText, yamlText = "") {
  const { workspaces } = JSON.parse(manifestText)
  const declared = Array.isArray(workspaces) ? workspaces : workspaces?.packages ?? []
  const lines = yamlText.split("\n")
  const start = lines.findIndex((l) => /^packages:\s*$/.test(l))
  const listed = []
  for (let i = start + 1; start >= 0 && i < lines.length && !/^[^\s#-]/.test(lines[i]); i++) {
    const m = /^\s*-\s*(['"]?)([^'"#\s]+)\1/.exec(lines[i])
    if (m) listed.push(m[2])
  }
  return [...declared, ...listed]
}

const stars = { "**/": "(?:.*/)?", "/**": "(?:/.*)?", "**": ".*", "*": "[^/]*" }
const globPattern = (glob) => new RegExp(`^${glob.replace(/^\.\//, "").replace(/\/$/, "").replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*\*\/|\/\*\*$|\*\*|\*/g, (m) => stars[m])}$`)

/**
 * The manifests of paths a package manager installs: the root's, the pnpm
 * workspace file, and each directory the workspace globs match. Anything else
 * a repository tracks, such as a vendored repository or a fixture pinned to an
 * old Effect on purpose, is not its to upgrade.
 */
export function workspaceManifests(paths, globs) {
  const included = globs.filter((g) => !g.startsWith("!")).map(globPattern)
  const excluded = globs.filter((g) => g.startsWith("!")).map((g) => globPattern(g.slice(1)))
  return paths.filter((path) => {
    if (posix.dirname(path) === ".") return true
    const dir = posix.dirname(path)
    return included.some((g) => g.test(dir)) && !excluded.some((g) => g.test(dir))
  })
}

/** The package an overrides key names: `@opencode/schema>effect` and `effect@^4` name effect. */
export function selectorTarget(key) {
  const last = key.split(">").at(-1).replace(/^(?:\*\*\/)+/, "")
  const at = last.indexOf("@", 1)
  return at < 0 ? last : last.slice(0, at)
}

/** Each string value of a JSON text, with its key path and its offsets inside the quotes. */
export function jsonStrings(text) {
  JSON.parse(text)
  const out = []
  let i = 0
  const space = () => { while (/\s/.test(text[i])) i++ }
  const string = () => {
    const start = ++i
    while (text[i] !== '"') i += text[i] === "\\" ? 2 : 1
    const end = i++
    return { value: JSON.parse(text.slice(start - 1, end + 1)), start, end }
  }
  const value = (path) => {
    space()
    if (text[i] === "{" || text[i] === "[") {
      const close = text[i] === "{" ? "}" : "]"
      i++
      space()
      if (text[i] === close) { i++; return }
      for (let n = 0; ; n++) {
        let key = n
        if (close === "}") {
          space()
          key = string().value
          space()
          i++
        }
        value([...path, key])
        space()
        if (text[i++] === close) return
      }
    }
    if (text[i] === '"') out.push({ path, ...string() })
    else while (i < text.length && !/[,}\]\s]/.test(text[i])) i++
  }
  value([])
  return out
}

const dependencyFields = new Set(["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"])

/** The package a package.json string at path declares a version of, or null: dependencies, catalogs, overrides and resolutions. */
function jsonDeclared(path) {
  const [a, b, c, d] = path
  if (path.length === 2 && (dependencyFields.has(a) || a === "catalog")) return b
  if (path.length === 2 && (a === "overrides" || a === "resolutions")) return selectorTarget(b)
  if (path.length === 3 && a === "pnpm" && b === "overrides") return selectorTarget(c)
  if (path.length === 3 && ((a === "workspaces" && b === "catalog") || a === "catalogs")) return c
  if (path.length === 4 && a === "workspaces" && b === "catalogs") return d
  return null
}

/** Each Effect version a package.json declares: { name, spec, start, end, peer }. */
export function jsonDeclarations(text) {
  return jsonStrings(text).flatMap((s) => {
    const name = jsonDeclared(s.path)
    return typeof name === "string" && isEffect(name) && bumpable.test(s.value)
      ? [{ name, spec: s.value, start: s.start, end: s.end, peer: s.path[0] === "peerDependencies" }]
      : []
  })
}

/** Each Effect version a pnpm-workspace.yaml declares in its catalog, catalogs and overrides: { name, spec, start, end, peer }. */
export function yamlDeclarations(text) {
  const out = []
  let section = null
  let offset = 0
  for (const line of text.split("\n")) {
    const top = /^([A-Za-z][\w-]*)\s*:/.exec(line)
    if (top) section = top[1]
    else if (["catalog", "catalogs", "overrides"].includes(section)) {
      const m = /^\s+(['"]?)([^'"\s#][^'"#]*?)\1\s*:\s*(['"]?)([^'"#\s]+)\3/.exec(line)
      const name = m && (section === "overrides" ? selectorTarget(m[2]) : m[2])
      if (m && isEffect(name) && bumpable.test(m[4])) {
        const start = offset + m[0].length - m[3].length - m[4].length
        out.push({ name, spec: m[4], start, end: start + m[4].length, peer: false })
      }
    }
    offset += line.length + 1
  }
  return out
}

const yamlKey = (name) => (/^[A-Za-z0-9_-]+$/.test(name) ? name : `'${name}'`)

/**
 * Adds the pins the top-level `overrides:` map of a pnpm-workspace.yaml lacks,
 * inside the block, adding the block when there is none. An entry already
 * there keeps its value: the upgrade moved its version, and a `catalog:`
 * entry follows the catalog.
 */
export function setYamlOverrides(text, pins) {
  const lines = text.split("\n")
  const start = lines.findIndex((l) => /^overrides:\s*$/.test(l))
  if (start < 0) {
    const body = Object.entries(pins).map(([k, v]) => `  ${yamlKey(k)}: ${v}`)
    return text.replace(/\n*$/, "\n") + `\noverrides:\n${body.join("\n")}\n`
  }
  let end = start + 1
  while (end < lines.length && (/^\s+\S/.test(lines[end]) || lines[end].trim() === "")) end++
  while (end > start + 1 && lines[end - 1].trim() === "") end--
  const seen = new Set()
  for (let i = start + 1; i < end; i++) {
    const m = /^\s+(['"]?)([^'":]+)\1:/.exec(lines[i])
    if (m) seen.add(m[2])
  }
  lines.splice(end, 0, ...Object.entries(pins).filter(([k]) => !seen.has(k)).map(([k, v]) => `  ${yamlKey(k)}: ${v}`))
  return lines.join("\n")
}

/** Adds the pins a package.json's `overrides` (npm, Bun) or `pnpm.overrides` lacks; an entry already there keeps its value. */
export function setJsonOverrides(pkg, pins, manager) {
  const next = structuredClone(pkg)
  const holder = manager === "pnpm" ? (next.pnpm ??= {}) : next
  holder.overrides ??= {}
  for (const [name, version] of Object.entries(pins)) if (!Object.keys(holder.overrides).some((k) => selectorTarget(k) === name && !k.includes(">"))) holder.overrides[name] = version
  return next
}

const indentOf = (text) => /\n([ \t]+)"/.exec(text)?.[1] ?? "  "
const escape = (text) => text.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")

/**
 * Carries forward what names a moved package at its old version, which the
 * package manager would otherwise drop or reject: each `name@old` selector
 * (pnpm's minimumReleaseAgeExclude, allowBuilds and patchedDependencies keys,
 * Bun's patchedDependencies) becomes `name@to`, and a patch file named for
 * the old version (`patches/@effect__vitest@4.0.5.patch`) is renamed for the
 * new one. moved maps each package to its old versions. Returns the text, the
 * selectors changed, and the patch files to move.
 */
export function carrySelectors(text, moved, to) {
  const selectors = []
  const patches = []
  let out = text
  for (const [name, olds] of moved) {
    for (const old of olds) {
      if (old === to) continue
      // A patch named for the old version, as the value of that version's entry.
      const entry = new RegExp(`(${escape(name)}@)${escape(old)}(['"]?\\s*:\\s*['"]?)([^'"\\s,}]*@)${escape(old)}(\\.patch)`, "g")
      out = out.replace(entry, (_, key, between, path, ext) => {
        patches.push({ from: `${path}${old}${ext}`, to: `${path}${to}${ext}`, versions: [old] })
        return `${key}${old}${between}${path}${to}${ext}`
      })
      const selector = new RegExp(`(?<![\\w@/.-])${escape(name)}@${escape(old)}(?![\\w.+-])`, "g")
      out = out.replace(selector, (match) => {
        selectors.push({ from: match, to: `${name}@${to}` })
        return `${name}@${to}`
      })
    }
  }
  return { text: out, selectors, patches }
}

/**
 * A patch carried to a package's new version: in its package.json sections,
 * each old version (the package's own, and Effect's that it depends on)
 * becomes the new one, so the hunks' context matches the new release's
 * manifest. Hunks of other files are kept as they are.
 */
export function carryPatch(text, versions, to) {
  let manifest = false
  return text.split("\n").map((line) => {
    if (line.startsWith("diff --git ")) manifest = / b\/package\.json$/.test(line)
    if (!manifest || /^(?:diff |index |--- |\+\+\+ |@@ )/.test(line)) return line
    return versions.reduce((l, v) => l.replace(new RegExp(`(?<![\\w.])${escape(v)}(?![\\w.-])`, "g"), to), line)
  }).join("\n")
}

/**
 * The Effect upgrade of a repository. files is [{ path, text }]: every
 * package.json, the root one first, and the pnpm-workspace.yaml; to is the
 * version the VibeLang runtime requires; manager is the package manager.
 * Effect's old version is the first effect version declared; each @effect/*
 * package on its major line moves with it, and separately versioned tools
 * (@effect/tsgo 0.x) keep theirs. A peer range keeps its operator, so a
 * library's contract stays a range. Selectors and patches that name an old
 * version move with it. Returns the versions moved, the pins the overrides
 * hold, the selectors carried, the patch files to move (the caller moves
 * them with carryPatch), and the files whose text changed.
 */
export function planUpgrade(files, to, manager) {
  const scanned = files.map((f) => ({ ...f, declarations: (f.path.endsWith(".yaml") ? yamlDeclarations : jsonDeclarations)(f.text) }))
  const effect = scanned.flatMap((f) => f.declarations).find((d) => d.name === "effect")
  if (!effect) throw new Error("the target declares no effect version in a package.json or pnpm-workspace.yaml")
  const from = effect.spec.replace(/^[\^~]/, "")
  const moves = (d) => d.name === "effect" || majorOf(d.spec) === majorOf(from)
  const pins = { effect: to }
  for (const d of scanned.flatMap((f) => f.declarations)) if (moves(d)) pins[d.name] = to
  // VibeLang's runtime installs @effect/platform-node-shared beside @effect/platform-node, so it is held at the same version.
  if (pins["@effect/platform-node"]) pins["@effect/platform-node-shared"] = to
  const bumped = []
  const next = new Map()
  for (const f of scanned) {
    const edits = f.declarations.filter(moves)
      .map((d) => ({ ...d, text: d.peer ? d.spec.replace(bumpable, (_, operator) => operator + to) : to }))
      .filter((e) => e.text !== e.spec)
    bumped.push(...edits.map((e) => ({ file: f.path, name: e.name, from: e.spec, to: e.text })))
    if (edits.length) next.set(f.path, applyEdits(f.text, edits))
  }
  // Selectors and patches that name a moved package's old version move with it.
  const moved = new Map()
  for (const b of bumped) moved.set(b.name, new Set([...(moved.get(b.name) ?? []), b.from.replace(/^[\^~]/, "")]))
  const selectors = []
  const patches = []
  for (const f of files) {
    const carried = carrySelectors(next.get(f.path) ?? f.text, moved, to)
    selectors.push(...carried.selectors.map((c) => ({ file: f.path, ...c })))
    for (const patch of carried.patches) patches.push({ ...patch, versions: [...new Set([...patch.versions, from])] })
    if (carried.text !== f.text) next.set(f.path, carried.text)
  }
  // Overrides keep one copy of each pinned package however a dependency's range reads.
  if (bumped.length) {
    const yaml = files.find((f) => f.path === "pnpm-workspace.yaml")
    const holder = manager === "pnpm" && yaml ? yaml : files.find((f) => f.path === "package.json")
    if (holder) {
      const text = next.get(holder.path) ?? holder.text
      const after = holder === yaml
        ? setYamlOverrides(text, pins)
        : (() => {
          const pkg = JSON.parse(text)
          const withPins = setJsonOverrides(pkg, pins, manager)
          return JSON.stringify(withPins) === JSON.stringify(pkg) ? text : JSON.stringify(withPins, null, indentOf(text)) + (text.endsWith("\n") ? "\n" : "")
        })()
      if (after !== holder.text) next.set(holder.path, after)
    }
  }
  return { from, to, pins, bumped, selectors, patches, files: files.filter((f) => next.has(f.path)).map((f) => ({ path: f.path, text: next.get(f.path) })) }
}
