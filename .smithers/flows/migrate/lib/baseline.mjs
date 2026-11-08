// Keep upgrade failures outside the migration baseline, including old run receipts.
import { createHash } from "node:crypto"
import { join } from "node:path"
import { newErrors } from "./diagnostics.mjs"
import { compareTests } from "./tests.mjs"
import { readJsonIf, slug, writeJson } from "./util.mjs"

export function testAdmission(before, after) {
  const compared = compareTests(before, after)
  const exitRegression = before.code === 0 && after.code !== 0
  return { ...compared, exitRegression, ok: compared.ok && !exitRegression,
    exit: { before: before.code, after: after.code } }
}

export function compilerAdmission(before, after) {
  const added = newErrors(before.diagnostics, after.diagnostics)
  const exitRegression = before.code === 0 && after.code !== 0
  return { ok: !added.length && !exitRegression, newErrors: added, exitRegression,
    exit: { before: before.code, after: after.code }, beforeCompiler: before.compiler, afterCompiler: after.compiler }
}

// Versioned names keep package paths separate from both each other and legacy slugs.
export function setupCompileKey(pkg) {
  const path = pkg || ".", encoded = encodeURIComponent(path)
  // Keep a valid package segment from exceeding the receipt filename limit.
  return "compile-v2/" + (encoded.length <= 180 ? "package-" + encoded
    : "digest-" + createHash("sha256").update(path).digest("hex"))
}

export function recordSetupCompile(p, pkg, checked) {
  const key = setupCompileKey(pkg)
  writeJson(join(p.baseline, key + ".json"), checked.diagnostics)
  writeJson(join(p.baseline, key + ".exit.json"), { code: checked.code })
}

/** A legacy receipt is evidence only when its package identity is unambiguous. */
export function readSetupCompile(p, pkg, packages) {
  const read = name => readJsonIf(join(p.baseline, name))
  let key = setupCompileKey(pkg)
  let diagnostics = read(key + ".json"), outcome = read(key + ".exit.json")
  if (diagnostics === undefined && outcome === undefined) {
    key = "compile-" + slug(pkg)
    diagnostics = read(key + ".json")
    outcome = read(key + ".exit.json")
    if (diagnostics === undefined && outcome === undefined) return
    const aliases = packages.filter(dir => slug(dir) === slug(pkg))
    if (aliases.length > 1) return { receipt: key + ".json",
      reason: "legacy setup compile receipt aliases packages: " + aliases.join(", "), packages: aliases }
  }
  const receipt = key + ".exit.json"
  if (!Array.isArray(diagnostics)) return { receipt: key + ".json", reason: "setup compiler diagnostics are missing or invalid" }
  return { diagnostics, code: outcome?.code, receipt }
}

/** Recompute from raw reports so a legacy green verify cannot absorb a failed switch. */
export function assertBaselineSafe(p, { includeSetup = true } = {}) {
  const read = name => readJsonIf(join(p.baseline, name))
  const tests = [], compile = []
  const upstream = read("upstream-tests.json"), upgraded = read("upgraded-tests.json"), baseline = includeSetup && read("tests.json")
  for (const [stage, before, after] of [["upgrade", upstream, upgraded], ["setup", upgraded ?? upstream, baseline]]) {
    if (before && after) tests.push({ stage, ...testAdmission(before, after) })
  }
  // Older receipts retain a regression even if their detailed reports are absent.
  for (const [stage, receipt, key] of [["upgrade", readJsonIf(p.upgrade), "regressions"],
    ["setup", includeSetup && readJsonIf(p.setup), "wiringRegressions"]]) {
    const r = receipt?.[key]
    if (r && (r.newFailures?.length || r.missing?.length || (r.exit?.before === 0 && r.exit.after !== 0))) {
      tests.push({ stage, ...r, ok: false })
    }
  }
  // A partial VIP repair can leave normal builds green despite refusing
  // another site. Its failure (or interrupted phase) remains authoritative.
  const finishLog = read("logs/vip-finish.json")
  const finishes = [finishLog, readJsonIf(p.upgrade)?.vipFinish]
  if (finishLog && finishLog.state !== "complete") compile.push({ stage: "vip-finish", project: finishLog.project, state: finishLog.state, ok: false })
  const refused = new Map(finishes.flatMap(finish => finish?.failed ?? []).map(failed => [JSON.stringify([failed.project, failed.code]), failed]))
  for (const failed of refused.values()) compile.push({ stage: "vip-finish", ...failed, ok: false })
  const original = read("upstream-checks.json") ?? {}, current = read("upgraded-checks.json") ?? {}
  const completedSetup = includeSetup && readJsonIf(p.setup)
  for (const [pkg, before] of Object.entries(original)) {
    if (current[pkg]) compile.push({ stage: "upgrade", package: pkg, ...compilerAdmission(before, current[pkg]) })
    const candidate = includeSetup && readSetupCompile(p, pkg, Object.keys(original))
    // Compare actual exits: an Effect diagnostic printed as an error can
    // still exit zero under ignoreEffect*InTscExitCode. Missing or invalid
    // setup outcomes remain unverified, including legacy receipts.
    if (candidate) {
      const before_ = current[pkg] ?? before
      const { receipt, code } = candidate
      if (candidate.reason || !Number.isInteger(code) || code < 0) {
        compile.push({ stage: "setup", package: pkg, state: "unverified",
          receipt, reason: candidate.reason ?? "setup compiler exit is missing or invalid",
          ...(candidate.packages ? { packages: candidate.packages } : {}), ok: false })
      } else {
        compile.push({ stage: "setup", package: pkg,
          ...compilerAdmission(before_, { compiler: "setup", code, diagnostics: candidate.diagnostics }) })
      }
    } else if (completedSetup) {
      compile.push({ stage: "setup", package: pkg, state: "unverified", receipt: "setup.json",
        reason: "completed setup compiler diagnostics and exit receipts are missing", ok: false })
    }
  }
  const result = { state: [...tests, ...compile].every(check => check.ok) ? "accepted" : "rejected", tests, compile }
  const receipt = join(p.baseline, "admission.json")
  writeJson(receipt, result)
  if (result.state === "rejected") throw new Error("toolchain baseline regression: new test failures, compiler errors or unverified setup outcomes cannot become a migration baseline; see " + receipt)
  return result
}
