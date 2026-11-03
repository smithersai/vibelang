import { appendFileSync, existsSync, realpathSync } from "node:fs"
import { isAbsolute, resolve } from "node:path"
import { assertFinished, parseDiagnostics } from "./diagnostics.mjs"
import { quote, run } from "./util.mjs"

export async function fixProgramFiles({ compiler, tsconfig, cwd, log, timeoutMs }) {
  const scopeLog = log && `${log}.scope.log`
  const result = await run(`${quote(compiler)} -p ${quote(tsconfig)} --listFilesOnly --pretty false --singleThreaded`, { cwd, log: scopeLog, timeoutMs })
  const output = [result.stdout, result.stderr].join("\n")
  assertFinished({ ...result, stdout: output, stderr: "" }, scopeLog)
  const files = [...new Set(result.stdout.split(/\r?\n/).map(line => line.trim()).filter(line => /\.vibex?$/.test(line)).map(line => resolve(cwd ?? ".", line)).filter(path => existsSync(path)))]
  const diagnostics = parseDiagnostics(output)
  const errors = diagnostics.filter(d => d.category === "error")
  // --listFilesOnly still lists the complete program when EK0301 reports a
  // repairable type spelling. Scope discovery must let --fix reach that file;
  // this receipt is not a successful semantic check.
  let inDiagnostic = false
  const unexpected = output.split(/\r?\n/).filter(line => {
    if (!line.trim()) return false
    if (parseDiagnostics(line).length) { inDiagnostic = true; return false }
    if (inDiagnostic && /^\s/.test(line)) return false
    inDiagnostic = false
    const path = line.trim()
    return !(/\.(?:[cm]?[jt]sx?|vibex?|json)$/.test(path) && (/^bundled:\/\/\/libs\//.test(path) || isAbsolute(path) || existsSync(resolve(cwd ?? ".", path))))
  })
  const recoverable = result.code === 1 && files.length > 0 && errors.length > 0 &&
    errors.every(d => d.code === "EK0301") && unexpected.length === 0
  if (result.code !== 0 && !recoverable) {
    const detail = [...diagnostics.map(d => `${d.code}: ${d.message}`), ...unexpected.slice(-12)].join("\n")
    throw new Error(`cannot determine the compiler's fix scope (exit ${result.code})${scopeLog ? `; see ${scopeLog}` : ""}${detail ? `\n${detail}` : ""}`)
  }
  if (scopeLog) appendFileSync(scopeLog, `# fix scope ${JSON.stringify({ stage: "discovered", files: files.length, exit: result.code, recoverableDiagnostics: recoverable ? ["EK0301"] : [], semanticChecksDeferred: recoverable })}\n`)
  return files
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
