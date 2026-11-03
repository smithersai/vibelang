// Write-ahead state for the batch's mechanical edits. Completion remains a
// separate receipt: nextStep must never mistake "compiler started" for "done".
import { closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { pathReadDeferrals, rewriteReferences } from "./references.mjs"
import { splitBatchPlatform } from "./platform.mjs"
import { markPlainFunctions } from "./plain.mjs"
import { rewriteViteScripts } from "./vite-config.mjs"
import { rewriteSourceLiterals } from "./source-paths.mjs"
import { assertModuleBoundary, rewriteExports, rewriteImports, rewriteScripts, vibePath } from "./codemod.mjs"
import { rewriteBuildEntrypoints } from "./build-entrypoints.mjs"

function syncDirectory(path) {
  const fd = openSync(path, "r")
  try { fsyncSync(fd) } finally { closeSync(fd) }
}

/** Replace atomically, and flush both the contents and the directory entry. */
export function durableWrite(path, data, mode = 0o600) {
  mkdirSync(dirname(path), { recursive: true })
  const temp = path + ".migrate-tmp"
  const fd = openSync(temp, "w", mode)
  try {
    writeFileSync(fd, data)
    fsyncSync(fd)
  } finally { closeSync(fd) }
  renameSync(temp, path)
  syncDirectory(dirname(path))
}

export const saveState = (path, state) => durableWrite(path, JSON.stringify(state, null, 2) + "\n")

/** Plan all edits without changing the target; original source bytes live in the journal. */
export function prepareState(target, files, scope, { ts, aliases, referenceFiles = scope, references = [], catalog = scope, bareEntries = false, moduleBodies = false, plainGroups = [], tracked } = {}) {
  for (const from of files) assertModuleBoundary(target, from)
  const deferred = pathReadDeferrals(target, files, referenceFiles)
  if (deferred.length) throw new Error("source text test requires .ts: " + deferred.map(d => d.file).join(", "))
  const renames = files.map(from => ({ from, to: vibePath(from) }))
  const originals = renames.map(({ from, to }) => {
    if (!existsSync(join(target, from))) throw new Error(`${from} does not exist`)
    if (existsSync(join(target, to))) throw new Error(`${to} already exists`)
    return { from, to, bytes: readFileSync(join(target, from)).toString("base64"), mode: statSync(join(target, from)).mode & 0o777 }
  })
  const fromOf = new Map(renames.map(({ from, to }) => [to, from]))
  const toOf = new Map(renames.map(({ from, to }) => [from, to]))
  const writes = []
  const disk = file => existsSync(join(target, fromOf.get(file) ?? file)) ? readFileSync(join(target, fromOf.get(file) ?? file), "utf8") : null
  const read = file => writes.find(w => w.file === (toOf.get(file) ?? file))?.after ?? disk(file)
  const write = (file, after) => {
    file = toOf.get(file) ?? file
    const previous = writes.find(w => w.file === file)
    if (previous) previous.after = after
    else writes.push({ file, before: disk(file), after, mode: existsSync(join(target, fromOf.get(file) ?? file)) ? statSync(join(target, fromOf.get(file) ?? file)).mode & 0o777 : 0o644 })
  }
  const platform = ts ? splitBatchPlatform(target, files, ts, { read, write, moduleBodies }) : { splits: [], refused: [] }
  // Read the TypeScript after platform splitting and before renaming. Detail
  // 269: a post-VIP-1 compiler needs no legacy plain return annotation.
  const plain = {}
  if (ts) for (const group of plainGroups) Object.assign(plain, markPlainFunctions(ts, target, group.files, group.tsconfigs, { read, write, exists: file => writes.some(w => w.file === (toOf.get(file) ?? file) && w.after !== null) || existsSync(join(target, file)), flipped: group.flipped }))
  const exportEdits = rewriteExports(target, renames, { write, bareEntries })
  const scriptEdits = rewriteViteScripts(target, renames, { read, write })
  const packageScriptEdits = rewriteScripts(target, renames, { read, write })
  const refEdits = rewriteReferences(target, renames, referenceFiles.map(file => toOf.get(file) ?? file), { read, write, literals: !ts })
  // Literal Vite build inputs that name a renamed module (tracked: the repository's files).
  const buildEntries = ts && tracked ? rewriteBuildEntrypoints(target, tracked, renames, ts, { read, write }) : { edits: [], warnings: [] }
  const importEdits = rewriteImports(target, [...scope, ...platform.splits.flatMap(s => s.platform ?? [])].map(file => toOf.get(file) ?? file), renames.map(r => r.to), aliases, { read, write })
  const referenceEdits = [], referenceWarnings = [], selectorChecks = [], matcherCache = new Map()
  const started = performance.now()
  if (ts) for (const reference of references) {
    const file = toOf.get(reference) ?? reference
    if (/\.(?:pdf|png|jpe?g|gif|webp|avif|ico|woff2?|ttf|otf|zip|t?gz|br|wasm|node|exe|dll|so|mp[34])$/i.test(file)) continue
    const path = join(target, fromOf.get(file) ?? file)
    if (!lstatSync(path).isFile()) continue
    const original = readFileSync(path)
    if (original.includes(0)) continue
    const text = original.toString("utf8")
    if (!Buffer.from(text).equals(original) || !/\.[cm]?ts/.test(text)) continue
    const changed = rewriteSourceLiterals(ts, read(file), file, renames, { matcherCache, inventory: catalog })
    referenceEdits.push(...changed.edits)
    referenceWarnings.push(...changed.warnings)
    selectorChecks.push(...(changed.selectorChecks ?? []))
    if (changed.edits.length) write(file, changed.text)
  }
  return { version: 1, target, files, phase: "prepared", referenceVersion: 1, referencePending: false, referenceScan: { files: references.length, patterns: matcherCache.size, durationMs: Math.round(performance.now() - started) }, referenceEdits, referenceWarnings, selectorChecks, platform, plain, functionModel: plainGroups.length ? (plainGroups.every(g => g.flipped) ? "plain-by-syntax" : "legacy-inference") : "unprobed", renames, originals, writes, exportEdits, buildEntries, importEdits, refEdits, scriptEdits, packageScriptEdits, attempts: [] }
}

/** Replay a prepared transaction, accepting each operation before or after its atomic write. */
export function applyState(target, state) {
  for (const { from, to } of state.renames) {
    const source = join(target, from), dest = join(target, to)
    if (existsSync(source) && !existsSync(dest)) {
      const original = state.originals.find(o => o.from === from)
      if (!readFileSync(source).equals(Buffer.from(original.bytes, "base64"))) throw new Error(`${from}: changed since codemod preparation`)
      renameSync(source, dest)
      syncDirectory(dirname(source))
      if (dirname(source) !== dirname(dest)) syncDirectory(dirname(dest))
    } else if (existsSync(source) || !existsSync(dest)) {
      throw new Error(`${from}: cannot replay rename to ${to}; expected exactly one source or destination`)
    }
  }
  for (const { file, before, after, mode } of state.writes) {
    const path = join(target, file), text = existsSync(path) ? readFileSync(path, "utf8") : null
    if (text === after) continue
    if (text !== before) throw new Error(`${file}: changed during codemod preparation; preserving it for review`)
    durableWrite(path, after, mode)
  }
}

/** Add literal wiring to an interrupted journal created by an earlier flow.
 * Read current native files, preserving checked compiler/agent edits, while
 * retaining the journal's original sources and declaration/test baselines. */
export function prepareReferences(target, renames, ts, references, catalog = references) {
  const matcherCache = new Map(), started = performance.now()
  const result = { referenceVersion: 1, referencePending: true, referenceWrites: [], referenceEdits: [], referenceWarnings: [], selectorChecks: [] }
  for (const file of references) {
    if (/\.(?:pdf|png|jpe?g|gif|webp|avif|ico|woff2?|ttf|otf|zip|t?gz|br|wasm|node|exe|dll|so|mp[34])$/i.test(file)) continue
    const path = join(target, file)
    if (!lstatSync(path).isFile()) continue
    const original = readFileSync(path)
    if (original.includes(0)) continue
    const text = original.toString("utf8")
    if (!Buffer.from(text).equals(original) || !/\.[cm]?ts/.test(text)) continue
    const changed = rewriteSourceLiterals(ts, text, file, renames, { matcherCache, inventory: catalog })
    result.referenceEdits.push(...changed.edits)
    result.referenceWarnings.push(...changed.warnings)
    result.selectorChecks.push(...(changed.selectorChecks ?? []))
    if (changed.edits.length) result.referenceWrites.push({ file, before: text, after: changed.text, mode: statSync(path).mode & 0o777 })
  }
  result.referenceScan = { files: references.length, patterns: matcherCache.size, durationMs: Math.round(performance.now() - started) }
  return result
}
