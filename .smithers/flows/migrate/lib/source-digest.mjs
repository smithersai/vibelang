// A stale conversion is a .vibe converted from a .ts older than the commit it
// lands on: the commit deletes that newer .ts, so every later change to it is
// reverted with no conflict and no failing test. The gate compares the bytes a
// conversion read with the .ts in the parent of the commit that removes it.
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { vibePath } from "./codemod.mjs"
import * as Jj from "./jj.mjs"
import { readToolchain } from "./toolchain.mjs"
import { isDeclarationFile } from "./util.mjs"

export const sha256 = bytes => createHash("sha256").update(bytes).digest("hex")

const relativeExtension = /(["'`])(\.{1,2}\/[^"'`\s]*?)\.(?:[cm]?[jt]sx?|vibex?)\1/g

/**
 * A source's digest with relative specifier extensions erased. Converting a module
 * rewrites its importers' specifiers, so one pass split across commits lands a
 * later module on a .ts that an earlier commit changed by that edit and no other.
 * Any other change still differs, and a whole-file formatter's rewrap counts as a change.
 */
export const shapeOf = bytes => sha256(Buffer.from(Buffer.from(bytes).toString("latin1").replace(relativeExtension, "$1$2$1"), "latin1"))

/**
 * The producer of a run's conversions: the VibeLang commit its staged toolchain was built from
 * (step.mjs toolchain stages compiler and flow from one checkout), or a published version.
 * A conversion is also stale by converter: an older writer's output can mean something else
 * to a newer compiler (EK4832 left readonly keys bare before b7be67a09d50), so each module
 * names what wrote it. With no producer there is nothing to record.
 */
export function producerOf(toolchain) {
  if (toolchain?.kind === "staged") {
    let commit
    try { commit = readToolchain(toolchain.dir).commit } catch {}
    if (isProducer(commit)) return commit
  } else if (typeof toolchain?.version === "string" && toolchain.version) return "vibelang@" + toolchain.version
  throw new Error("record refused: no producing toolchain: a staged toolchain.json needs the VibeLang commit it was built from")
}

const isProducer = value => typeof value === "string" && (/^[0-9a-f]{12,40}$/.test(value) || /^vibelang@\S+$/.test(value))

const moduleOf = (from, to, bytes, toolchain) => ({ from, to, sha256: sha256(bytes), shape: shapeOf(bytes), toolchain })

/** The manifest of a codemod journal, whose originals are the exact bytes the conversion read. */
export function manifestOf(originals, toolchain) {
  if (!isProducer(toolchain)) throw new Error("a source digest manifest needs its producing toolchain")
  return { version: 1, modules: originals.map(({ from, to, bytes }) => moduleOf(from, to, Buffer.from(bytes, "base64"), toolchain)) }
}

/** The manifest of a pass outside the flow: run it on the tree the pass converts, before converting, naming the toolchain that will. */
export function manifestOfTree(tree, files, toolchain) {
  if (!isProducer(toolchain)) throw new Error("--toolchain must name the VibeLang commit (12 to 40 hex digits) or vibelang@<version> that converts these modules")
  return { version: 1, modules: files.map(from => moduleOf(from, vibePath(from), readFileSync(join(tree, from)), toolchain)) }
}

/** The modules of a manifest file: { version: 1, modules: [{ from, to, sha256, shape, toolchain }] }. An entry with no toolchain reads, and the push gate refuses it. */
export function readManifest(file) {
  const manifest = JSON.parse(readFileSync(file, "utf8"))
  if (manifest.version !== 1 || !Array.isArray(manifest.modules)) throw new Error(`${file}: not a version 1 source digest manifest`)
  for (const m of manifest.modules) {
    if (typeof m.from !== "string" || !/^[0-9a-f]{64}$/.test(m.sha256) || (m.toolchain !== undefined && !isProducer(m.toolchain))) throw new Error(`${file}: bad entry ${JSON.stringify(m)}`)
  }
  return manifest.modules
}

/** Whether a recorded producer is one of the allowed ones; a short commit matches a longer spelling of the same commit. */
const allowed = (toolchain, producers) => producers.some(p => p === toolchain || (/^[0-9a-f]+$/.test(p) && /^[0-9a-f]+$/.test(toolchain) && (p.startsWith(toolchain) || toolchain.startsWith(p))))

/** Each module whose recorded digest differs from its .ts at revisionOf(module), or that has no .ts there. */
export async function staleSources(root, modules, revisionOf, { jobs = 8 } = {}) {
  const queue = [...modules], stale = []
  await Promise.all(Array.from({ length: Math.min(jobs, queue.length) }, async () => {
    for (let m = queue.shift(); m; m = queue.shift()) {
      const revision = revisionOf(m), bytes = await Jj.bytesAt(root, revision, m.from)
      const base = bytes === null ? null : sha256(bytes)
      if (base !== m.sha256 && (bytes === null || shapeOf(bytes) !== m.shape)) stale.push({ from: m.from, to: m.to, revision, recorded: m.sha256, base })
    }
  }))
  return stale.sort((a, b) => a.from.localeCompare(b.from))
}

export function staleMessage(stale, total) {
  const lines = stale.slice(0, 20).map(s => `  ${s.from}: converted from ${s.recorded.slice(0, 12)}, ${s.base ? `${s.base.slice(0, 12)} at` : "missing from"} ${s.revision.slice(0, 12)}`)
  if (stale.length > lines.length) lines.push(`  ... ${stale.length - lines.length} more`)
  return `stale conversion: ${stale.length} of ${total} modules differ from the .ts they land on; re-convert them from that base\n${lines.join("\n")}`
}

/** record's gate. --force does not reach it: recording a stale module deletes the base's newer source. */
export async function assertSourcesCurrent(root, modules, revision) {
  const stale = await staleSources(root, modules, () => revision)
  if (stale.length) throw new Error("record refused: " + staleMessage(stale, modules.length))
}

/** The modules a commit converts: a removed TypeScript source whose native twin the commit adds. A jj rename may pair it with the sidecar instead. */
export function convertedIn(entries) {
  const removed = entries.flatMap(e => e.status === "D" ? [e.path] : e.status === "R" ? [e.from] : [])
  const added = new Set(entries.filter(e => e.status === "A" || e.status === "R" || e.status === "C").map(e => e.path))
  return removed.filter(f => /\.(?:ts|tsx|mts)$/.test(f) && !isDeclarationFile(f) && added.has(vibePath(f)))
}

/**
 * The push gate: every conversion in base..head against the parent it lands on.
 * A module with no digest is refused too, so a missing record never passes, and so is
 * one with no producing toolchain. Given producers, a conversion any other toolchain
 * wrote is refused as stale by converter.
 * A module converted twice answers for its last conversion.
 */
export async function checkStack(root, manifests, base, head, { producers = [] } = {}) {
  const recorded = new Map(manifests.flat().map(m => [m.from, m]))
  const landing = new Map()
  const commits = await Jj.stack(root, base, head)
  for (const { commit, parent } of commits) for (const from of convertedIn(await Jj.changedPathsAt(root, commit))) landing.set(from, { commit, parent })
  const unrecorded = [...landing.keys()].filter(f => !recorded.has(f)).sort()
  const known = [...landing.keys()].filter(f => recorded.has(f)).map(f => recorded.get(f))
  const stale = await staleSources(root, known, m => landing.get(m.from).parent)
  const unproduced = known.filter(m => !isProducer(m.toolchain)).map(m => m.from).sort()
  const converter = producers.length ? known.filter(m => isProducer(m.toolchain) && !allowed(m.toolchain, producers)).map(m => ({ from: m.from, toolchain: m.toolchain })).sort((a, b) => a.from.localeCompare(b.from)) : []
  return { ok: !stale.length && !unrecorded.length && !unproduced.length && !converter.length, base, head, commits: commits.length, converted: landing.size, producers, stale, unrecorded, unproduced, converter }
}
