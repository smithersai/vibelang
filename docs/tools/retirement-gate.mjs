// Offline retirement admission over immutable jj snapshots.
import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, realpathSync, symlinkSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve, relative } from "node:path"
import { fileURLToPath } from "node:url"
import { compilerCodes, goTokens } from "./diagnostic-identity.mjs"

function run(command, args, cwd) {
  const p = spawnSync(command, args, { cwd, encoding: "utf8", maxBuffer: 128 * 1024 * 1024, timeout: 120000 })
  if (p.error) throw p.error
  return p
}
function jj(root, args) {
  const p = run("jj", ["--ignore-working-copy", ...args], root)
  if (p.status !== 0) throw new Error("jj " + args[0] + ": " + p.stderr.trim())
  return p.stdout
}
export function tree(root, revision) {
  const id = jj(root, ["log", "--no-graph", "-r", revision, "-T", "commit_id"]).trim()
  if (!/^[a-f0-9]{40}$/.test(id)) throw new Error("expected one immutable commit: " + revision)
  const paths = jj(root, ["file", "list", "-r", id]).trim().split("\n").filter(Boolean)
  const names = new Set(paths)
  return { id, paths, read(path) {
    return names.has(path) ? jj(root, ["file", "show", "-r", id, path]) : ""
  }, sources() {
    return ["core", "parser", "vibelang", "vibelangmapper"].map(pkg => {
      const selected = paths.filter(p => p.startsWith("typescript/tsc/internal/" + pkg + "/") &&
        p.endsWith(".go") && !p.endsWith("_test.go"))
      return { path: "typescript/tsc/internal/" + pkg + "/snapshot.go",
        text: selected.length ? jj(root, ["file", "show", "-r", id, ...selected]) : "" }
    })
  } }
}
export function categories(sources) {
  const registered = compilerCodes(sources)
  const defaults = new Map(), aliases = new Map([
    ["errorCategory", "error"], ["warningCategory", "warning"],
    ["CategoryError", "error"], ["CategoryWarning", "warning"],
    ["CategorySuggestion", "suggestion"], ["CategoryMessage", "suggestion"]
  ])
  const tokenized = sources.map(s => ({ ...s, tokens: goTokens(s.text) }))
  const assignments = []
  for (const { tokens: ts } of tokenized) for (let i = 0; i < ts.length; i++) {
    if (ts[i + 1]?.value !== "=") continue
    let arg = ts[i + 2]?.value
    if (ts[i + 3]?.value === ".") arg = ts[i + 4]?.value
    assignments.push([ts[i].value, arg])
  }
  for (let pass = 0; pass < assignments.length; pass++) {
    let changed = false
    for (const [name, arg] of assignments) if (!aliases.has(name) && aliases.has(arg)) {
      aliases.set(name, aliases.get(arg)); changed = true
    }
    if (!changed) break
  }
  for (const { tokens: ts } of tokenized) for (let i = 0; i < ts.length; i++) {
    if (/^"EK\d{4,}"$/.test(ts[i].value) && ts[i + 1]?.value === ":" &&
      /^"(error|warning|lint warning|suggestion)"$/.test(ts[i + 2]?.value ?? ""))
      defaults.set(JSON.parse(ts[i].value), JSON.parse(ts[i + 2].value).replace("lint ", ""))
  }
  const result = new Map()
  for (const [code, sites] of registered) {
    const severities = []
    for (const site of sites.filter(s => s.kind === "message")) {
      const ts = tokenized.find(s => s.path === site.path).tokens
      let i = ts.findIndex(t => t.offset === site.offset) + 2
      while (i < ts.length && ts[i].value !== ",") i++
      let arg = ts[i + 1]?.value
      if (ts[i + 2]?.value === ".") arg = ts[i + 3]?.value
      const constructor = ts.find(t => t.offset === site.offset)?.value
      const severity = constructor === "messageOff" ? "off" :
        constructor.startsWith("registry") ? defaults.get(code) : aliases.get(arg)
      if (!severity) throw new Error(code + ": unresolved default severity in " + site.path)
      severities.push(severity)
    }
    result.set(code, severities.length ? (severities.includes("error") ? "error" : severities[0]) :
      defaults.get(code) ?? "error")
  }
  return result
}
export function nativeCategories(text) {
  const result = new Map()
  for (const entry of Object.values(JSON.parse(text || "{}"))) {
    if (!Number.isInteger(entry.code) || !["Error", "Warning", "Suggestion", "Message"].includes(entry.category))
      throw new Error("unresolved native diagnostic registration")
    const code = "TS" + entry.code, category = entry.category.toLowerCase()
    if (result.get(code) !== "error") result.set(code, category)
  }
  return result
}
function snapshotCategories(snapshot) {
  return new Map([...categories(snapshot.sources()),
    ...nativeCategories(snapshot.read("typescript/tsc/internal/diagnostics/diagnosticMessages.json"))])
}
export function requiredRetirements(before, after, cases) {
  const out = []
  for (const [code, severity] of after) if (severity === "error" && before.get(code) !== "error")
    out.push({ code, kind: "new error severity" })
  for (const { path, codes } of cases) for (const code of codes) {
    if (!after.has(code)) throw new Error(path + ": unregistered diagnostic " + code)
    out.push({ code, kind: "new or widened .fail case", path })
  }
  return out
}
// Only the harness's first-line code list is metadata. Preserve every other
// source byte, including compiler directives, configuration and line separators.
function failSourceForComparison(path, text) {
  if (!/\.(vibex?|ts|mts|cts)$/.test(path) || path.endsWith(".d.ts")) return text
  return text.replace(/^\/\/ expect:[ \t]*(?:(?:EK|TS)\d+(?:[ \t]+(?:EK|TS)\d+)*)?[ \t]*(?=\r?\n|$)/, "// expect:")
}
export function changedFailCases(before, after, changed) {
  const dirs = new Set(changed.map(p => /^(typescript\/vibelang\/cases\/[^/]+\.fail)\//.exec(p)?.[1]).filter(Boolean))
  return [...dirs].filter(dir => after.paths.some(p => p.startsWith(dir + "/"))).map(dir => {
    const expectations = after.paths.filter(p => p.startsWith(dir + "/expected/"))
    const oldSources = before.paths.filter(p => p.startsWith(dir + "/") && !p.startsWith(dir + "/expected/"))
    const newSources = after.paths.filter(p => p.startsWith(dir + "/") && !p.startsWith(dir + "/expected/"))
    const sameSources = JSON.stringify(oldSources) === JSON.stringify(newSources) &&
      newSources.every(p => failSourceForComparison(p, before.read(p)) === failSourceForComparison(p, after.read(p)))
    const oldErrors = new Set(before.paths.filter(p => p.startsWith(dir + "/expected/"))
      .flatMap(p => [...before.read(p).matchAll(/\berror ((?:EK|TS)\d{4,})\b/g)].map(m => m[1])))
    const codes = new Set(expectations.flatMap(p => [...after.read(p).matchAll(/\berror ((?:EK|TS)\d{4,})\b/g)].map(m => m[1]))
      .filter(code => !(sameSources && oldErrors.has(code))))
    return { path: dir, codes: [...codes] }
  })
}
function manifest(snapshot, path) {
  const text = snapshot.read(path), value = text ? JSON.parse(text) : []
  if (!Array.isArray(value)) throw new Error(path + ": expected an array")
  return value
}
export function approvalFor(finding, approvals) {
  return approvals.some(a => a.code === finding.code && /^VIP-[1-9]\d*$/.test(a.vip ?? "") &&
    a.approval?.by === "Will" && typeof a.approval?.reference === "string" &&
    a.approval.reference.trim().length > 0 && typeof a.reason === "string" && a.reason.trim().length > 0 &&
    (finding.path ? a.case === finding.path : a.severity === "error"))
}
export function witnessFor(finding, fixes) {
  return fixes.filter(f => f.code === finding.code && Array.isArray(f.cases)).flatMap(f => f.cases)
    .filter(c => typeof c.input === "string" && typeof c.output === "string" &&
      (!finding.path || c.input === finding.path))
}
function safeCase(path) {
  if (!/^typescript\/vibelang\/cases\/[A-Za-z0-9_.-]+$/.test(path)) throw new Error("invalid witness directory: " + path)
}
function materialize(snapshot, input, temp, root) {
  safeCase(input)
  const inputPaths = snapshot.paths.filter(p => p.startsWith(input + "/") && !p.startsWith(input + "/expected/"))
  if (!inputPaths.some(p => p.endsWith("/tsconfig.json"))) throw new Error(input + ": missing tsconfig.json")
  for (const path of inputPaths) {
    const dest = join(temp, relative(input, path))
    mkdirSync(dirname(dest), { recursive: true }); writeFileSync(dest, snapshot.read(path))
  }
  mkdirSync(join(temp, "node_modules"), { recursive: true })
  for (const [name, target] of [["effect", join(root, "docs/tools/node_modules/effect")],
    ["@effect", join(root, "docs/tools/node_modules/@effect")], ["vibelang-runtime", join(root, "packages/runtime")]]) {
    if (existsSync(target)) symlinkSync(realpathSync(target), join(temp, "node_modules", name))
  }
  return inputPaths
}
export function previouslyRejected(snapshot, path, root, binary, previousCommit) {
  if (!binary) return false // absent oracle never excuses a retirement
  if (!existsSync(binary)) throw new Error("missing previous compiler")
  const receipt = JSON.parse(readFileSync(binary + ".retirement.json", "utf8"))
  const digest = createHash("sha256").update(readFileSync(binary)).digest("hex")
  if (receipt.commit !== previousCommit || receipt.sha256 !== digest)
    throw new Error("previous compiler receipt does not match the parent commit and binary")
  const temp = mkdtempSync(join(tmpdir(), "retirement-before-"))
  try {
    materialize(snapshot, path, temp, root)
    const p = run(binary, ["--pretty", "false", "--noEmit"], temp)
    if (p.signal || p.status === null) throw new Error("previous compiler did not complete")
    // Setup/configuration failures aren't evidence of a rejected language form.
    // Only an EK source error counts; missing modules or bad options cannot exempt a case.
    return p.status !== 0 && /\bmain\.(?:vibe|vibex)\(\d+,\d+\): error EK\d+\b/.test(p.stdout + p.stderr)
  } finally { rmSync(temp, { recursive: true, force: true }) }
}
export function verifyWitness(code, witness, snapshot, root, binary, invoke = run) {
  safeCase(witness.input); safeCase(witness.output)
  if (!binary || !existsSync(binary)) throw new Error(code + ": missing built compiler for --fix witness")
  const temp = mkdtempSync(join(tmpdir(), "retirement-fix-"))
  try {
    const inputPaths = materialize(snapshot, witness.input, temp, root)
    const outputs = snapshot.paths.filter(p => p.startsWith(witness.output + "/") &&
      !p.startsWith(witness.output + "/expected/") && /\.(vibe|vibex|ts|tsx)$/.test(p))
    if (!outputs.length) throw new Error(code + ": missing fixed source output")
    const compile = args => {
      const p = invoke(binary, ["--pretty", "false", "--noEmit", ...args], temp)
      if (p.error || p.signal || p.status === null) throw new Error(code + ": compiler did not complete")
      return { status: p.status, text: p.stdout + p.stderr }
    }
    const original = compile([])
    if (original.status === 0 || !new RegExp("\\berror " + code + "\\b").test(original.text))
      throw new Error(code + ": witness does not reproduce the retirement error")
    const fixed = compile(["--fix"])
    if (fixed.status !== 0 || /\berror (?:EK|TS)\d+\b/.test(fixed.text))
      throw new Error(code + ": --fix output does not compile cleanly: " + fixed.text.slice(-1200))
    if (!new RegExp("\\b" + code + " ×[1-9][0-9]*\\b").test(fixed.text))
      throw new Error(code + ": --fix did not report applying a registered quick fix for this diagnostic")
    for (const path of inputPaths.filter(p => !/\.(vibe|vibex|ts|tsx)$/.test(p))) {
      if (readFileSync(join(temp, relative(witness.input, path)), "utf8") !== snapshot.read(path))
        throw new Error(code + ": --fix changed a configuration or non-source witness file")
    }
    let changed = false
    const expectedNames = new Set(outputs.map(p => relative(witness.output, p)))
    for (const input of inputPaths.filter(p => /\.(vibe|vibex|ts|tsx)$/.test(p))) {
      const name = relative(witness.input, input)
      if (!expectedNames.delete(name)) throw new Error(code + ": missing fixed output for " + name)
      const actual = readFileSync(join(temp, name), "utf8")
      if (actual !== snapshot.read(witness.output + "/" + name)) throw new Error(code + ": unexpected fixed output for " + name)
      changed ||= actual !== snapshot.read(input)
    }
    if (!changed || expectedNames.size) throw new Error(code + ": --fix must change exactly the witnessed sources" +
      (expectedNames.size ? ": unmatched output sources: " + [...expectedNames].sort().join(", ") : ": no source changed"))
    const clean = compile([])
    if (clean.status !== 0 || /\berror (?:EK|TS)\d+\b/.test(clean.text))
      throw new Error(code + ": fixed output fails standalone compilation: " + clean.text.slice(-1200))
  } finally { rmSync(temp, { recursive: true, force: true }) }
}
function auditCommit({ root, base, head, binary, previousBinary, precheck = false }) {
  const before = tree(root, base), after = tree(root, head)
  const changed = jj(root, ["diff", "--from", before.id, "--to", after.id, "--name-only"]).trim().split("\n").filter(Boolean)
  const candidates = requiredRetirements(snapshotCategories(before), snapshotCategories(after),
    changedFailCases(before, after, changed))
  const findings = candidates.filter(f => !f.path || !previouslyRejected(after, f.path, root, previousBinary, before.id))
  const fixes = manifest(after, "docs/design/retirement-fixes.json")
  const approvals = manifest(after, "docs/design/retirement-allowlist.json")
  const failures = [], verified = new Set()
  for (const finding of findings) {
    const label = finding.code + " at commit " + after.id.slice(0, 12) + " (" + finding.kind + (finding.path ? ": " + finding.path : "") + ")"
    if (approvalFor(finding, approvals)) continue
    const witnesses = witnessFor(finding, fixes)
    if (!witnesses.length) { failures.push(label + ": missing registered --fix and compiling fixed-output case (or reviewed VIP/Will approval)"); continue }
    for (const witness of witnesses) {
      const key = JSON.stringify([finding.code, witness])
      if (verified.has(key)) continue
      try {
        if (!precheck) verifyWitness(finding.code, witness, after, root, binary)
        verified.add(key)
      } catch (e) { failures.push(label + ": " + e.message) }
    }
  }
  return { base: before.id, head: after.id, retirements: findings.length, precheck, failures }
}
// Check every commit independently: a fix in a later commit cannot license an earlier error.
export function auditRange(options) {
  const { root, base, head } = options
  const before = tree(root, base), after = tree(root, head)
  if (!jj(root, ["log", "--no-graph", "-r", before.id + " & ::" + after.id, "-T", "commit_id"]).trim())
    throw new Error("base must be an ancestor of head")
  const commits = jj(root, ["log", "--no-graph", "--reversed", "-r", before.id + ".." + after.id,
    "-T", 'commit_id ++ "\\n"']).trim().split("\n").filter(Boolean)
  const checks = []
  for (const commit of commits) {
    const parents = jj(root, ["log", "--no-graph", "-r", "parents(" + commit + ")", "-T", 'commit_id ++ "\\n"'])
      .trim().split("\n").filter(Boolean)
    if (!parents.length) throw new Error("retirement range includes a root commit")
    for (const parent of parents) checks.push(auditCommit({ ...options, base: parent, head: commit }))
  }
  return { base: before.id, head: after.id, commits: commits.length,
    retirements: checks.reduce((n, c) => n + c.retirements, 0), precheck: options.precheck ?? false,
    failures: checks.flatMap(c => c.failures) }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2)
    const option = name => args.includes(name) ? args[args.indexOf(name) + 1] : undefined
    const root = resolve(option("--root") ?? fileURLToPath(new URL("../..", import.meta.url)))
    if (!option("--base") || !option("--head")) throw new Error("usage: retirement-gate.mjs --base REV --head REV [--root DIR] [--compiler PATH] [--precheck]")
    if (args.includes("--immutable") && ![option("--base"), option("--head")].every(v => /^[a-f0-9]{40}$/.test(v)))
      throw new Error("--immutable requires full commit IDs")
    const result = auditRange({ root, base: option("--base"), head: option("--head"),
      binary: option("--compiler") ?? process.env.VIBELANG_BINARY ?? join(root, "typescript/built/local/tsc"),
      previousBinary: option("--previous-compiler") ?? process.env.RETIREMENT_PREVIOUS_BINARY, precheck: args.includes("--precheck") })
    for (const failure of result.failures) console.error("retirement-needs-fix: " + failure)
    console.log(JSON.stringify(result))
    process.exitCode = result.failures.length ? 1 : 0
  } catch (e) { console.error("retirement-needs-fix: cannot establish safety: " + e.message); process.exitCode = 2 }
}
