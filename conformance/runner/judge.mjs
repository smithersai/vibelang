/**
 * Turn one backend observation into a conformance verdict.
 *
 * Statuses:
 *   pass         the backend's observable behavior is exactly the declared expectation
 *   fail         the backend completed and contradicted the expectation ("divergent")
 *   unsupported  the backend processed the case and could not handle the language
 *                construct at all (Go, during the migration)
 *   unmeasured   no observation was obtained: the backend crashed, refused the
 *                request, or was not runnable. This is a failure to MEASURE, not
 *                a result, and it is never folded into any other bucket — a
 *                harness that scores a crash as "unsupported" reports progress
 *                it did not make.
 *   xfail        the case is marked xfail for this backend and did indeed not match
 *   xpass        the case is marked xfail for this backend but matched anyway (a finding)
 */

/**
 * The Go comptime port intentionally uses `SMITHERS19xx` for the reference
 * frontend's `VCT10xx` rules, preserving the final two digits one-for-one.
 * Canonicalize that documented spelling difference at the contract boundary;
 * raw observations in the JSON report retain the backend's actual code.
 *
 * SCOPED TO THE FORK ON PURPOSE, and the scope is the whole point. The
 * reference ALSO spells `SMITHERS1900`, `SMITHERS1901` and `SMITHERS1902`, and
 * there they are unrelated FORMATTER rules — mask budget, overlapping masks,
 * and overlapping language-service edits (`poc/src/language/format.ts:646`,
 * `:667`, `:700`) — not comptime rules. Aliasing unconditionally rewrote those
 * three onto `VCT1000`/`VCT1001`/`VCT1002`, which are live comptime rules in
 * the same reference (`poc/src/build/comptime-intrinsic.ts:33-42`: Syntax,
 * MissingIdentity, UnrelatedIdentity). That folded two unrelated rules onto one
 * contract code, so a case declaring the comptime rule could have been
 * satisfied by the formatter failure and scored as agreement — the judge
 * certifying something it had not checked, which is the exact class the corpus
 * exists to catch.
 *
 * It was latent, not live: the formatter is reachable only through the
 * `smithers format` subcommand (`src/cli.ts:1505`) and never through
 * `compileProject`, which is the only path the harness observes, and no case
 * declares a `SMITHERS19xx` code. `auditReferenceCodeSpace` below keeps it that
 * way by failing the harness loudly if a reference observation ever carries one.
 */
function contractDiagnosticCode(code, backend) {
  if (backend !== "go") return code;
  const comptimeAlias = /^SMITHERS19(\d{2})$/.exec(code);
  return comptimeAlias ? `VCT10${comptimeAlias[1]}` : code;
}

/**
 * Declared expectations are written in contract spelling already, so they are
 * canonicalized as `"contract"` — never aliased — and only a backend's own
 * observation is translated into that space.
 */
function sortDiagnostics(list, backend = "contract") {
  return [...list]
    .map((item) => ({
      code: contractDiagnosticCode(item.code, backend),
      line: item.line,
      column: item.column,
      // Carried through the sort so a declared `messageContains` can be checked
      // against the diagnostic it was declared for. Neither field takes part in
      // ordering, and `formatDiagnostics` still prints code@line:column only.
      message: item.message,
      messageContains: item.messageContains,
    }))
    .sort((left, right) =>
      left.code !== right.code
        ? left.code < right.code
          ? -1
          : 1
        : left.line !== right.line
          ? left.line - right.line
          : left.column - right.column,
    );
}

function formatDiagnostics(list, backend = "contract") {
  return sortDiagnostics(list, backend)
    .map((item) => `${item.code}@${item.line}:${item.column}`)
    .join(", ");
}

/** True when the observation is exactly what the case declares. */
function matches(expectation, observation, backend) {
  if (expectation.expect === "output") {
    if (observation.kind !== "output") {
      return { ok: false, detail: describeMismatch(expectation, observation) };
    }
    if (observation.exitCode !== 0) {
      return {
        ok: false,
        detail: `program exited ${observation.exitCode}: ${firstLine(observation.stderr)}`,
      };
    }
    const expected = expectation.stdout;
    const actual = observation.stdout;
    if (expected.length === actual.length && expected.every((line, index) => line === actual[index])) {
      return { ok: true };
    }
    return { ok: false, detail: `stdout ${JSON.stringify(actual)} != ${JSON.stringify(expected)}` };
  }

  if (observation.kind !== "diagnostics") {
    return { ok: false, detail: describeMismatch(expectation, observation) };
  }
  const expected = sortDiagnostics(expectation.diagnostics);
  const actual = sortDiagnostics(observation.diagnostics, backend);
  const same =
    expected.length === actual.length &&
    expected.every(
      (item, index) =>
        item.code === actual[index].code &&
        item.line === actual[index].line &&
        item.column === actual[index].column,
    );
  if (!same) {
    return {
      ok: false,
      detail: `diagnostics [${formatDiagnostics(observation.diagnostics, backend)}] != [${formatDiagnostics(expectation.diagnostics)}]`,
    };
  }
  // The codes and positions line up. A case may additionally claim that a
  // diagnostic *says* something — used where the payload is the promise rather
  // than decoration, as the native pin's dependency path is. Checked only where
  // declared, so every case written before this field behaves exactly as it did.
  for (const [index, item] of expected.entries()) {
    if (item.messageContains === undefined) continue;
    const message = String(actual[index].message ?? "");
    if (message.includes(item.messageContains)) continue;
    return {
      ok: false,
      detail:
        `${item.code}@${item.line}:${item.column} fires, but its message does not contain ` +
        `${JSON.stringify(item.messageContains)}: ${JSON.stringify(message)}`,
    };
  }
  return { ok: true };
}

function firstLine(text) {
  return String(text ?? "").split("\n").find((line) => line.trim().length > 0) ?? "";
}

function describeMismatch(expectation, observation) {
  if (observation.kind === "diagnostics") {
    return `rejected with [${formatDiagnostics(observation.diagnostics)}]: ${firstLine(observation.diagnostics[0]?.message)}`;
  }
  if (observation.kind === "output") {
    return `accepted and ran (exit ${observation.exitCode}), but the case must be rejected with [${formatDiagnostics(expectation.diagnostics ?? [])}]`;
  }
  return observation.reason ?? observation.kind;
}

/**
 * Does this Go observation look like "not implemented yet" rather than
 * "implemented differently"? Stock TypeScript codes on an authored `.sm` file
 * mean the fork parsed or checked Smithers syntax it has no handling for; only
 * a SMITHERS code is the fork claiming a language rule of its own.
 */
function looksUnimplemented(observation) {
  if (observation.kind === "rejected" || observation.kind === "error") return true;
  if (observation.kind === "diagnostics") {
    return observation.diagnostics.some((item) => !/^SMITHERS\d{4}$/.test(item.code));
  }
  if (observation.kind === "output" && observation.exitCode !== 0) {
    // A crash naming a runtime hook the fork never emitted is a missing
    // lowering, not a semantic disagreement.
    return /is not a function|is not defined|Cannot read propert|missed lowering/.test(observation.stderr ?? "");
  }
  return false;
}

export function judge(testCase, observation, backend) {
  const expectation = testCase.expectation;
  const expectedToFail = (expectation.xfail?.backends ?? []).includes(backend);

  // No observation, no verdict. A backend that crashed, timed out, or refused
  // the request has not disagreed with the corpus and has not "not implemented"
  // it either; it has failed to answer, and an xfail marker cannot excuse a
  // measurement that never happened.
  if (observation.kind === "error" || observation.kind === "rejected") {
    return { status: "unmeasured", detail: observation.reason ?? `the backend returned ${observation.kind}` };
  }

  const verdict = matches(expectation, observation, backend);
  if (expectedToFail) {
    return verdict.ok
      ? { status: "xpass", detail: "the cited gap appears to be fixed; retire the xfail" }
      : { status: "xfail", detail: `${expectation.xfail.reason} [${expectation.xfail.doc}]` };
  }
  if (verdict.ok) return { status: "pass", detail: "" };
  if (backend === "go" && looksUnimplemented(observation)) {
    return { status: "unsupported", detail: verdict.detail };
  }
  return { status: "fail", detail: verdict.detail };
}

/**
 * The `SMITHERS19xx` code range means two different things in the two
 * implementations: comptime rules in the Go fork, formatter rules in the
 * reference. `contractDiagnosticCode` therefore translates the range for the
 * fork only, which is correct exactly as long as the reference never emits one
 * on the observed path — today it cannot, because the formatter lives behind
 * the `smithers format` subcommand and the harness only ever drives
 * `compileProject`.
 *
 * That is a property of the current wiring, not a law, so it is checked rather
 * than assumed. If a reference observation ever carries a `SMITHERS19xx`, the
 * two code spaces have collided and any verdict involving it is unsafe: report
 * it as a harness-integrity failure (`run.mjs` exit 3) instead of scoring the
 * case. The fix at that point is to renumber one of the two rule families, not
 * to widen the alias.
 */
function auditReferenceCodeSpace(observation, backend, label) {
  if (backend.name === "go" || observation.kind !== "diagnostics") return [];
  return (observation.diagnostics ?? [])
    .filter((item) => /^SMITHERS19\d{2}$/.test(item.code ?? ""))
    .map((item) =>
      `${label}: the reference emitted ${item.code}, which collides with the Go fork's comptime ` +
      `alias range (SMITHERS19xx -> VCT10xx). In the reference that range is the formatter's, so ` +
      `no verdict over it can be trusted until one of the two families is renumbered.`,
    );
}

/**
 * Was this verdict actually earned?
 *
 * A verdict is only as good as the checks that ran before it. The JS backend
 * used to reach `compileProject` and stop, so every `output` case was scored
 * without ever type-checking the emitted TypeScript, and at least one case was
 * green purely because that check was missing. This audit makes the omission of
 * a check a loud harness failure rather than a quiet extra pass: each backend
 * declares the stages a verdict must have gone through, and a satisfied
 * expectation whose observation did not record them is reported as a defect in
 * the harness, not as a result.
 *
 * Returns an array of human-readable violations; empty means the verdict is
 * backed by the work it claims.
 */
export function auditVerdict(testCase, observation, verdict, backend) {
  const violations = [];
  const expectation = testCase.expectation;
  const label = `${backend.name}: ${testCase.id}`;
  const stages = observation.stages ?? [];

  violations.push(...auditReferenceCodeSpace(observation, backend, label));

  if (verdict.status === "unmeasured") return violations;
  if (stages.length === 0) {
    violations.push(`${label}: the backend recorded no stages, so nothing proves the case was exercised at all`);
    return violations;
  }

  const satisfied = verdict.status === "pass" || verdict.status === "xpass";
  const required = backend.requiredStages?.[expectation.expect] ?? [];
  // A case that ships sibling assets is a claim about a file the compiler had
  // to open. A backend that declares an asset stage must have run it before
  // that claim counts, for the same reason an output case must have run the
  // emitted-TypeScript check: otherwise the case is green because a check was
  // skipped, not because the behavior was observed.
  if (satisfied && (expectation.assets ?? []).length > 0 && backend.assetStage &&
    !stages.includes(backend.assetStage)) {
    violations.push(
      `${label}: scored ${verdict.status} for a case that stages ${expectation.assets.length} asset(s) ` +
        `without running the ${backend.assetStage} stage`,
    );
  }
  if (satisfied) {
    for (const stage of required) {
      if (!stages.includes(stage)) {
        violations.push(
          `${label}: scored ${verdict.status} for an "${expectation.expect}" expectation without running the ${stage} stage`,
        );
      }
    }
  }

  if (expectation.expect === "output") {
    if (satisfied && observation.kind !== "output") {
      violations.push(`${label}: an output expectation was satisfied by a ${observation.kind} observation`);
    }
    if (satisfied && !Array.isArray(observation.stdout)) {
      violations.push(`${label}: an output expectation was satisfied without any captured stdout`);
    }
  } else {
    if (satisfied && observation.kind !== "diagnostics") {
      violations.push(`${label}: a diagnostics expectation was satisfied by a ${observation.kind} observation`);
    }
    if (satisfied && (observation.diagnostics ?? []).length !== expectation.diagnostics.length) {
      violations.push(`${label}: a diagnostics expectation was satisfied without comparing the same number of diagnostics`);
    }
    // A declared stock-TypeScript code is a claim about the *emitted* program,
    // so it can only be satisfied by the stage that checks the emitted program.
    const wantsEmitStage = expectation.diagnostics.some((entry) => entry.code.startsWith("TS"));
    const emitStage = backend.emitCheckStage;
    if (satisfied && wantsEmitStage && emitStage && !stages.includes(emitStage)) {
      violations.push(`${label}: a TS-code expectation was satisfied without running the ${emitStage} stage`);
    }
  }
  return violations;
}

/**
 * Compare the two backends' raw observations, independently of the expectation.
 *
 * `left` is always the JS reference and `right` the Go fork (`run.mjs` builds
 * them from `observations.js` / `observations.go`), and each side is translated
 * into contract spelling under its OWN backend identity. Canonicalizing both
 * sides as one backend would apply the fork's comptime alias to the reference,
 * where `SMITHERS19xx` means a formatter rule — see `contractDiagnosticCode`.
 */
export function compareObservations(left, right, leftBackend = "js", rightBackend = "go") {
  if (left.kind !== right.kind) return { agree: false, detail: `${left.kind} vs ${right.kind}` };
  if (left.kind === "output") {
    const same =
      left.exitCode === right.exitCode &&
      left.stdout.length === right.stdout.length &&
      left.stdout.every((line, index) => line === right.stdout[index]);
    return same
      ? { agree: true, detail: "" }
      : { agree: false, detail: `${JSON.stringify(left.stdout)} vs ${JSON.stringify(right.stdout)}` };
  }
  if (left.kind === "diagnostics") {
    const a = formatDiagnostics(left.diagnostics, leftBackend);
    const b = formatDiagnostics(right.diagnostics, rightBackend);
    return a === b ? { agree: true, detail: "" } : { agree: false, detail: `[${a}] vs [${b}]` };
  }
  return { agree: false, detail: `${left.reason ?? left.kind} vs ${right.reason ?? right.kind}` };
}

export { formatDiagnostics };
