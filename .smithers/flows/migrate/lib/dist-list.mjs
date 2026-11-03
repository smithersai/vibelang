// The dist-list diff: build the tree before and after a batch from clean
// outputs, and refuse the batch when its build no longer ships a file it
// shipped before. A build that selects sources by `.ts` (a `**/*.ts` entry
// glob, an endsWith(".ts") walk) drops a renamed module and still exits 0, so
// neither the build's exit code nor the text check proves the package whole.
import { cpSync, existsSync, lstatSync, mkdirSync, readdirSync, renameSync, rmSync } from "node:fs"
import { join, posix } from "node:path"

const strings = (value, out = []) => {
  if (typeof value === "string") out.push(value)
  else if (Array.isArray(value)) for (const v of value) strings(v, out)
  else if (value && typeof value === "object") for (const v of Object.values(value)) strings(v, out)
  return out
}

/**
 * The output directories a package's manifest names: the first segment of each
 * entry, export, bin or `files` target, kept only when no tracked file lives in
 * it. Source directories (`src`) are tracked and never cleaned.
 */
export function outputDirs(manifest, pkgDir, tracked) {
  const segments = new Set()
  const add = (target, { bare }) => {
    const path = posix.normalize(target.replace(/^\.\//, ""))
    if (!path || path === "." || path.startsWith("../") || path.startsWith("/")) return
    const [segment, ...rest] = path.split("/")
    if (!segment || /[*?{}[\]!]/.test(segment) || segment === "node_modules") return
    if (!rest.length && !bare) return // a file at the package root
    segments.add(segment)
  }
  const entries = [manifest.main, manifest.module, manifest.types, manifest.typings, manifest.browser, manifest.bin, manifest.exports,
    manifest.publishConfig?.main, manifest.publishConfig?.module, manifest.publishConfig?.types, manifest.publishConfig?.bin, manifest.publishConfig?.exports]
  for (const target of strings(entries)) add(target, { bare: false })
  for (const target of strings(manifest.files ?? [])) add(target, { bare: true })
  if (!segments.size) segments.add("dist")
  const prefix = pkgDir === "." ? "" : pkgDir + "/"
  const trackedDirs = new Set(tracked.flatMap(file => file.startsWith(prefix) ? [file.slice(prefix.length).split("/")[0]] : []))
  return [...segments].filter(segment => !trackedDirs.has(segment)).sort().map(segment => prefix + segment)
}

function listFiles(root, dir, out) {
  for (const entry of readdirSync(join(root, dir), { withFileTypes: true })) {
    const path = dir + "/" + entry.name
    if (entry.name === "node_modules") continue
    if (entry.isDirectory()) listFiles(root, path, out)
    else out.push(path)
  }
  return out
}

/**
 * Runs `build` with every output directory moved aside, then lists what it
 * wrote. A directory the build did not recreate is moved back and named in
 * `notBuilt`: it came from something other than this build and is not compared.
 */
export async function cleanBuildList({ t, dirs, scratch, build }) {
  const aside = join(scratch, "dist-aside")
  rmSync(aside, { recursive: true, force: true })
  const moved = []
  for (const [i, dir] of dirs.entries()) {
    const path = join(t, dir)
    if (!existsSync(path) || !lstatSync(path).isDirectory()) continue
    mkdirSync(aside, { recursive: true })
    move(path, join(aside, String(i)))
    moved.push({ dir, from: join(aside, String(i)) })
  }
  const restore = () => {
    const notBuilt = []
    for (const { dir, from } of moved) {
      if (existsSync(join(t, dir))) rmSync(from, { recursive: true, force: true })
      else { move(from, join(t, dir)); notBuilt.push(dir) }
    }
    rmSync(aside, { recursive: true, force: true })
    return notBuilt
  }
  try { await build() } catch (error) { restore(); throw error }
  const notBuilt = restore()
  const built = dirs.filter(dir => !notBuilt.includes(dir) && existsSync(join(t, dir)) && lstatSync(join(t, dir)).isDirectory())
  const files = built.flatMap(dir => listFiles(t, dir, [])).sort()
  return { dirs, notBuilt, built, files }
}

// The run directory can be on another file system than the target.
function move(from, to) {
  try { renameSync(from, to) } catch (error) {
    if (error.code !== "EXDEV") throw error
    cpSync(from, to, { recursive: true, verbatimSymlinks: true }); rmSync(from, { recursive: true, force: true })
  }
}

const HASH = /-[A-Za-z0-9_-]{8}(?=\.(?:[cm]?js|d\.[cm]?ts)(?:\.map)?$)/

const stem = path => posix.basename(path).replace(/(?:\.d)?\.(?:[cm]?[jt]sx?|vibe|map)(?:\.map)?$/, "")

/**
 * Compares two clean dist lists. Each file the baseline shipped and the
 * candidate does not is a refusal, attributed to the renamed modules whose
 * name it carries. A shipped source copy that moved with its rename (dist/X.ts
 * to dist/X.vibe) is reported, not refused. Extra files are reported.
 */
export function compareDistLists(baseline, candidate, renames = []) {
  if (!baseline) return { state: "not-run", ok: true, reason: "the baseline has no dist list: its setup ran before this check; rerun setup to compare builds" }
  if (baseline.state === "not-run") return { state: "not-run", ok: true, reason: baseline.reason }
  if (!candidate || candidate.state === "not-run") return { state: "not-run", ok: true, reason: candidate?.reason ?? "the candidate was not built" }
  const before = new Set(baseline.files), after = new Set(candidate.files)
  const lost = baseline.files.filter(file => !after.has(file))
  const renamedSources = [], refusals = [], rehashed = []
  // A bundler's hashed chunk (tsdown's name-AbCd1234.js) changes its hash with its input: pair it by name.
  const unhashed = new Map()
  for (const file of candidate.files) if (!before.has(file)) { const key = file.replace(HASH, ""); if (key !== file) unhashed.set(key, [...(unhashed.get(key) ?? []), file]) }
  for (const file of lost) {
    const key = file.replace(HASH, "")
    if (key !== file && unhashed.get(key)?.length) { rehashed.push({ from: file, to: unhashed.get(key).shift() }); continue }
    // A chunk the bundler renamed (rolldown names a chunk by a module it holds): another new chunk in its directory.
    const sibling = key !== file && [...unhashed].find(([k, files]) => files.length && posix.dirname(k) === posix.dirname(key) && /\.[cm]?js$/.test(k) === /\.[cm]?js$/.test(key))
    if (sibling) { rehashed.push({ from: file, to: sibling[1].shift(), renamed: true }); continue }
    const vibe = file.replace(/\.[cm]?ts$/, ".vibe")
    if (vibe !== file && after.has(vibe) && renames.some(r => stem(r.from) === stem(file))) { renamedSources.push({ from: file, to: vibe }); continue }
    const modules = renames.filter(r => stem(r.from) === stem(file)).map(r => r.from)
    refusals.push({ kind: "dist-missing", file, modules,
      message: "the build no longer writes " + file + (modules.length ? "; it is the output of renamed " + modules.join(", ") : "") +
        ". A build that selects sources by .ts drops a .vibe module and still exits 0: make the build take .vibe, or return the module to TypeScript" })
  }
  const pairedTo = new Set([...renamedSources, ...rehashed].map(r => r.to))
  const extras = candidate.files.filter(file => !before.has(file) && !pairedTo.has(file))
  return {
    state: "complete", ok: refusals.length === 0,
    baseline: { sourceCommit: baseline.sourceCommit ?? null, files: baseline.files.length, notBuilt: baseline.notBuilt ?? [] },
    candidate: { sourceCommit: candidate.sourceCommit ?? null, files: candidate.files.length, notBuilt: candidate.notBuilt ?? [] },
    refusals, renamedSources, rehashed, extras: extras.slice(0, 500), extraCount: extras.length
  }
}
