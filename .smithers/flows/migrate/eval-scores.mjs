// The migrate eval's scoring, apart from eval.ts so node:test can run it
// without the flow, the toolchain or @smthrs/evals.

/**
 * Splits verify.json's `checks` into the checks that ran and passed, ran and
 * failed, and did not run. A check whose receipt (`verify[name]`, such as
 * `verify.distList` or `verify.packLoad`) says `state: "not-run"` and that
 * verify counts as passing never ran, so it is in neither the passed nor the
 * failed list and stays out of the `checks` score. A not-run check that verify
 * counts as failing refused the batch, so it stays failed.
 */
export function verifyChecks(verify) {
  const checks = verify?.checks ?? {}
  const passed = [], failed = [], notRun = []
  for (const name of Object.keys(checks)) {
    const ok = checks[name] === true
    if (ok && verify?.[name]?.state === "not-run") notRun.push(name)
    else (ok ? passed : failed).push(name)
  }
  return { passed, failed, notRun }
}

/** The share of the checks that ran and passed; 0 when none ran. */
export function checksScore({ passed, failed }) {
  const total = passed.length + failed.length
  return total === 0 ? 0 : passed.length / total
}

/** The scores the README promises the eval gates: a baseline of 0 cannot show a drop, so a 0 fails the eval. */
export const PROMISED = ["declarations", "recorded"]

/** Each `case: scorer` among a run's observations whose promised score is 0. */
export function unmetPromises(observations) {
  return observations
    .filter((o) => o.kind === "score" && PROMISED.includes(o.scorerName) && o.score === 0)
    .map((o) => `${o.case}: ${o.scorerName}`)
}
