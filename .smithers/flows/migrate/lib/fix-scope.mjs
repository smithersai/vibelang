import { appendFileSync, existsSync, realpathSync } from "node:fs"
import { resolve } from "node:path"
import { assertFinished, parseDiagnostics } from "./diagnostics.mjs"
import { quote, run } from "./util.mjs"

export async function fixProgramFiles({ compiler, tsconfig, cwd, log, timeoutMs }) {
  const scopeLog = log && `${log}.scope.log`
  const result = await run(`${quote(compiler)} -p ${quote(tsconfig)} --listFilesOnly --pretty false --singleThreaded`, { cwd, log: scopeLog, timeoutMs })
  assertFinished(result, scopeLog)
  if (result.code !== 0) {
    const diagnostics = parseDiagnostics(result.stdout + result.stderr).map(d => `${d.code}: ${d.message}`).join("\n")
    const detail = diagnostics || result.stderr.trim().split(/\r?\n/).slice(-12).join("\n")
    throw new Error(`cannot determine the compiler's fix scope (exit ${result.code})${scopeLog ? `; see ${scopeLog}` : ""}${detail ? `\n${detail}` : ""}`)
  }
  return [...new Set(result.stdout.split(/\r?\n/).map(line => line.trim()).filter(line => /\.vibex?$/.test(line)).map(line => resolve(cwd ?? ".", line)).filter(path => existsSync(path)))]
}

const active = new Set()
const waiting = []
const overlaps = (a, b) => { for (const file of a) if (b.has(file)) return true; return false }
function drain() {
  for (let i = 0; i < waiting.length;) {
    const item = waiting[i]
    if ([...active].some(files => overlaps(files, item.files)) || waiting.slice(0, i).some(earlier => overlaps(earlier.files, item.files))) { i++; continue }
    waiting.splice(i, 1)
    active.add(item.files)
    item.ready(() => { active.delete(item.files); drain() })
  }
}

// A whole-program fix may rewrite imported Vibe modules too. Calls whose
// programs share any source take turns; disjoint programs still run together.
export async function withFixFiles(files, action, log) {
  const started = Date.now()
  const trace = (stage, details = {}) => {
    if (log) appendFileSync(`${log}.scope.log`, `# fix scope ${JSON.stringify({ stage, files: files.length, ...details })}\n`)
  }
  trace("waiting")
  const owned = new Set(files.map(file => realpathSync(file)))
  const release = await new Promise(ready => { waiting.push({ files: owned, ready }); drain() })
  try {
    trace("acquired", { waitMs: Date.now() - started })
    return await action()
  } finally {
    release()
    trace("released", { elapsedMs: Date.now() - started })
  }
}
