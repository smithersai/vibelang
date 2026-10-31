// Write-ahead state for the batch's mechanical edits. Completion remains a
// separate receipt: nextStep must never mistake "compiler started" for "done".
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { rewriteReferences } from "./references.mjs"
import { splitBatchPlatform } from "./platform.mjs"
import { rewriteExports, rewriteImports, vibePath } from "./codemod.mjs"

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
export function prepareState(target, files, scope, { ts, aliases, referenceFiles = scope } = {}) {
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
  const platform = ts ? splitBatchPlatform(target, files, ts, { read, write }) : { splits: [], refused: [] }
  const exportEdits = rewriteExports(target, renames, { write })
  const refEdits = rewriteReferences(target, renames, referenceFiles.map(file => toOf.get(file) ?? file), { read, write })
  const importEdits = rewriteImports(target, [...scope, ...platform.splits.map(s => s.platform)].map(file => toOf.get(file) ?? file), renames.map(r => r.to), aliases, { read, write })
  return { version: 1, target, files, phase: "prepared", platform, renames, originals, writes, exportEdits, importEdits, refEdits, attempts: [] }
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
