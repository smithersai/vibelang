// Keep upgrade failures outside the migration baseline, including old run receipts.
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
  const original = read("upstream-checks.json") ?? {}, current = read("upgraded-checks.json") ?? {}
  for (const [pkg, before] of Object.entries(original)) {
    if (current[pkg]) compile.push({ stage: "upgrade", package: pkg, ...compilerAdmission(before, current[pkg]) })
    const candidate = includeSetup && read("compile-" + slug(pkg) + ".json")
    // The setup compile's own exit code, as the upgraded check records its: an
    // Effect diagnostic printed as an error (EK38xx) exits 0 under
    // ignoreEffect*InTscExitCode, so a code derived from the categories said 2
    // where both compiles exited 0 (smithers packages/smithers, EK3870). A
    // receipt from before the code was recorded compares diagnostics only.
    const before_ = current[pkg] ?? before
    const code = read("compile-" + slug(pkg) + ".exit.json")?.code ?? before_.code
    if (candidate) compile.push({ stage: "setup", package: pkg,
      ...compilerAdmission(before_, { compiler: "setup", code, diagnostics: candidate }) })
  }
  const result = { state: [...tests, ...compile].every(check => check.ok) ? "accepted" : "rejected", tests, compile }
  const receipt = join(p.baseline, "admission.json")
  writeJson(receipt, result)
  if (result.state === "rejected") throw new Error("toolchain baseline regression: new test failures or compiler errors cannot become a migration baseline; see " + receipt)
  return result
}
