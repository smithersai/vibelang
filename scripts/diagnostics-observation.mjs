/** Refuse incomplete evidence before regenerating the diagnostic reference. */
export function validateDiagnosticObservation(runner, report, caseIds) {
  const refuse = (message) => { throw new Error(`diagnostics-reference: ${message}; existing documentation was not changed`); };
  if (runner.error || runner.status !== 0 || runner.signal) refuse("the conformance runner did not finish successfully");
  if (!report || typeof report !== "object" || !Array.isArray(report.cases) || !Array.isArray(caseIds) || caseIds.length === 0 ||
    new Set(caseIds).size !== caseIds.length || report.cases.length !== caseIds.length) refuse("the corpus measurement is incomplete");
  const remaining = new Set(caseIds);
  for (const entry of report.cases) {
    if (!entry || !remaining.delete(entry.id)) refuse("the corpus measurement has a missing, repeated or unknown case");
    const result = entry.results?.js;
    if (!result || !["pass", "fail", "xfail", "xpass", "divergent"].includes(result.status)) refuse(`case ${entry.id} was not measured`);
    const observation = result.observation;
    if (!observation || typeof observation !== "object") refuse(`case ${entry.id} has no observation`);
    if (observation.kind === "diagnostics") {
      if (!Array.isArray(observation.diagnostics) || observation.diagnostics.some((item) => !item || typeof item.code !== "string" || !item.code ||
        typeof item.message !== "string" || !item.message)) refuse(`case ${entry.id} has malformed diagnostics`);
    } else if (observation.kind === "output") {
      if (!Array.isArray(observation.stdout) || observation.stdout.some((line) => typeof line !== "string") || !Number.isSafeInteger(observation.exitCode)) refuse(`case ${entry.id} has malformed output`);
    } else if (observation.kind !== "unsupported" || result.status !== "xfail" || typeof observation.reason !== "string" || !observation.reason) {
      refuse(`case ${entry.id} has no usable compiler observation`);
    }
  }
  if (remaining.size !== 0) refuse("the corpus measurement omitted cases");
}
