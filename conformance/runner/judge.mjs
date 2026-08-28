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
 * The declared diagnostics of one case, in the ONE representation every walk in
 * this file compares against.
 *
 * A declared diagnostic may name the `file` it fires in; one that does not means
 * the case's entry module, which is where every declared diagnostic in the
 * corpus lands today. Defaulting here rather than at each comparison is the
 * point: the expectation side and the observation side then have the same shape,
 * and neither walk has to remember to fill a field in.
 *
 * Exported so `conformance/runner/run.mjs` can put the canonical form on the
 * report row, and `--json` therefore shows exactly what was compared rather than
 * what was typed.
 */
export function canonicalExpectation(testCase) {
  return (testCase.expectation.diagnostics ?? []).map((item) => ({
    ...item,
    file: item.file ?? testCase.entry,
  }));
}

/**
 * Declared expectations are written in contract spelling already, so they are
 * canonicalized as `"contract"` — never aliased — and only a backend's own
 * observation is translated into that space.
 *
 * `file` and `mapped` are carried through. This function used to drop both, and
 * both of its consumers then compared code, line and column alone, so a
 * diagnostic reported in the WRONG FILE satisfied any expectation whose
 * coordinates it happened to share, and two backends diagnosing different files
 * printed as agreeing. A canonicalizer is the wrong place to lose a field: every
 * comparison downstream inherits the loss and none of them can see that it
 * happened.
 */
function sortDiagnostics(list, backend = "contract") {
  return [...list]
    .map((item) => ({
      code: contractDiagnosticCode(item.code, backend),
      // Part of the answer: same code, same line, different module is a
      // different program point.
      file: item.file,
      // Whether the harness resolved this position back to authored source.
      // Never *compared* — the fork checks the authored `.sm` directly and has
      // nothing to map, so comparing it would report a divergence on every
      // diagnostics case — but `auditVerdict` reads it, and canonicalization
      // must not be where it disappears.
      mapped: item.mapped,
      line: item.line,
      column: item.column,
      // Carried through the sort so a declared `messageContains` can be checked
      // against the diagnostic it was declared for.
      message: item.message,
      messageContains: item.messageContains,
    }))
    .sort(byPosition);
}

/**
 * A total order over canonicalized diagnostics: code, file, line, column.
 *
 * `file` joins the key so the pairing is deterministic. Without it, two
 * diagnostics sharing a code, a line and a column in two different modules
 * sorted as ties, and `matches` paired them by whatever order each side happened
 * to arrive in — which is how a `messageContains` could be checked against the
 * other module's diagnostic.
 */
function byPosition(left, right) {
  if (left.code !== right.code) return left.code < right.code ? -1 : 1;
  const leftFile = left.file ?? "";
  const rightFile = right.file ?? "";
  if (leftFile !== rightFile) return leftFile < rightFile ? -1 : 1;
  if (left.line !== right.line) return left.line - right.line;
  return left.column - right.column;
}

/** True when two canonicalized diagnostics name the same program point. */
function samePoint(left, right) {
  return (
    left.code === right.code &&
    left.file === right.file &&
    left.line === right.line &&
    left.column === right.column
  );
}

/**
 * Render a diagnostic list for a human.
 *
 * The file is printed whenever it is known, because the whole reason this
 * function grew the field is that a diff between two files used to render as no
 * diff at all. Rendering is deliberately NOT what equality is computed from —
 * see `compareObservations` — so changing this format cannot change a verdict.
 */
function formatDiagnostics(list, backend = "contract") {
  return sortDiagnostics(list, backend)
    .map((item) =>
      item.file === undefined
        ? `${item.code}@${item.line}:${item.column}`
        : `${item.code}@${item.file}:${item.line}:${item.column}`,
    )
    .join(", ");
}

/** True when the observation is exactly what the case declares. */
function matches(testCase, observation, backend) {
  const expectation = testCase.expectation;
  // Resolved once, before either branch, so the `output` branch's "must be
  // rejected with" message names the same files the `diagnostics` branch would
  // have compared.
  const declared = canonicalExpectation(testCase);
  if (expectation.expect === "output") {
    if (observation.kind !== "output") {
      return { ok: false, detail: describeMismatch(declared, observation) };
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
    return { ok: false, detail: describeMismatch(declared, observation) };
  }
  const expected = sortDiagnostics(declared);
  const actual = sortDiagnostics(observation.diagnostics, backend);
  const same = expected.length === actual.length && expected.every((item, index) => samePoint(item, actual[index]));
  if (!same) {
    return {
      ok: false,
      detail: `diagnostics [${formatDiagnostics(observation.diagnostics, backend)}] != [${formatDiagnostics(declared)}]`,
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
        `${item.code}@${item.file}:${item.line}:${item.column} fires, but its message does not contain ` +
        `${JSON.stringify(item.messageContains)}: ${JSON.stringify(message)}`,
    };
  }
  return { ok: true };
}

function firstLine(text) {
  return String(text ?? "").split("\n").find((line) => line.trim().length > 0) ?? "";
}

/** `declared` is the canonical declared-diagnostic list, never the raw one. */
function describeMismatch(declared, observation) {
  if (observation.kind === "diagnostics") {
    return `rejected with [${formatDiagnostics(observation.diagnostics)}]: ${firstLine(observation.diagnostics[0]?.message)}`;
  }
  if (observation.kind === "output") {
    return `accepted and ran (exit ${observation.exitCode}), but the case must be rejected with [${formatDiagnostics(declared)}]`;
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

  const verdict = matches(testCase, observation, backend);
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
 * Every diagnostic that takes part in a comparison must name a file in the
 * staged project, in the staged spelling.
 *
 * A backend stages each case in a private temporary directory and reports its
 * diagnostics against it; the harness relates those paths back to the
 * project-relative names the corpus stages and an expectation declares
 * (`backend-js.mjs`'s `stagedFile`). When that relation fails, the path arrives
 * ABSOLUTE — and `corpus.mjs` refuses an absolute declared `file`, so such a
 * diagnostic can never match any expectation that can be written. It is
 * therefore not a divergence: it is a comparison the harness was unable to set
 * up, and it must be reported as one.
 *
 * This is not hypothetical and the failure mode is the reason for the check.
 * On macOS `os.tmpdir()` yields `/var/folders/...` while the compiler reports
 * the realpath `/private/var/folders/...`; the two spellings do not relativize
 * against each other, every asset-stage diagnostic kept its absolute path, and
 * the runner reported **12 divergent, agreement 479/510** — all of them in
 * `23-asset-imports`, none of them a disagreement between the two compilers.
 * A reader would have gone looking for a fault in the asset stage of one
 * backend. The staging root is realpath'd now (as `scripts/oracle-differential.mjs`
 * already did, for exactly this reason), but "one root is canonicalized" is a
 * property of one line, while "a path the harness could not relate is never
 * scored" is the property that has to hold — so it is checked here rather than
 * assumed, and any future spelling that escapes the relation exits 3 with the
 * path in hand instead of manufacturing a divergence somebody has to diagnose.
 */
function auditStagedFiles(observation, label) {
  if (observation.kind !== "diagnostics") return [];
  return (observation.diagnostics ?? [])
    .filter((item) => typeof item.file === "string" && /^([/\\]|[A-Za-z]:[/\\])/.test(item.file))
    .map(
      (item) =>
        `${label}: ${item.code} is reported in ${JSON.stringify(item.file)}, an absolute path the harness could not ` +
        `relate to the staged project. No expectation can declare one, so this diagnostic cannot be compared — ` +
        `any verdict over it is an artifact of the staging root, not a statement about the backend.`,
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
  violations.push(...auditStagedFiles(observation, label));

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
    violations.push(...auditMappedPositions(observation, verdict, backend, label, satisfied));
  }
  return violations;
}

/**
 * A satisfied verdict may not rest on a position the harness could not map.
 *
 * The JS backend maps emit-check diagnostics back through the compiler's own
 * source map and, when it cannot, keeps the GENERATED position and records
 * `mapped: false` rather than anchoring it somewhere plausible-looking. That is
 * the honest thing to observe — and it was then compared against an authored
 * coordinate as though the two were the same kind of number. A declared line and
 * column that happens to coincide with a line and column in emitted TypeScript
 * would certify the rule.
 *
 * This is `auditVerdict`'s business rather than a `fail`, for the same reason an
 * `output` case scored without the emit-check stage is: the backend did not
 * disagree with anything, the HARNESS failed to resolve what it was comparing.
 * Scoring it `fail` would report a divergence that no backend committed, and
 * `--report-only` could suppress it. Exit 3 cannot be suppressed, which is
 * correct — if this fires, the coordinate in the report is not the coordinate
 * the case is about.
 *
 * Driven by a capability the backend declares, not by the presence of the field.
 * The fork reports no mapping at all (it checks the authored `.sm` directly and
 * has nothing to map), so auditing `!== true` unconditionally would fail every
 * Go diagnostics pass. Reading `backend.reportsMapping` also means a reference
 * backend that ever stops recording the field goes red here instead of quietly
 * disabling the check.
 */
function auditMappedPositions(observation, verdict, backend, label, satisfied) {
  if (!satisfied || !backend.reportsMapping || observation.kind !== "diagnostics") return [];
  return (observation.diagnostics ?? [])
    .filter((item) => item.mapped !== true)
    .map(
      (item) =>
        `${label}: scored ${verdict.status} on ${item.code}@${item.file}:${item.line}:${item.column}, a position the ` +
        `harness could not resolve back to authored source (mapped: ${JSON.stringify(item.mapped)}). The coordinate ` +
        `compared is a generated one, so the match does not mean what the case declares.`,
    );
}

/**
 * Compare the two backends' raw observations, independently of the expectation.
 *
 * `left` is always the JS reference and `right` the Go fork (`run.mjs` builds
 * them from `observations.js` / `observations.go`), and each side is translated
 * into contract spelling under its OWN backend identity. Canonicalizing both
 * sides as one backend would apply the fork's comptime alias to the reference,
 * where `SMITHERS19xx` means a formatter rule — see `contractDiagnosticCode`.
 *
 * The diagnostics arm compares the same program point `matches` compares — code,
 * file, line, column — because "the two backends agree" and "the backend
 * satisfied the case" have to mean the same relation or the scoreboard's two
 * halves are measuring different things. It used to compare the two sides'
 * RENDERED strings, which is how the file got lost here as well: the renderer
 * omitted it, so `main.sm` and `wrong-module.mod.sm` at the same coordinates
 * rendered identically and printed as agreement. Equality is now computed from
 * the fields; `formatDiagnostics` is only ever asked to describe a disagreement
 * that has already been decided.
 *
 * `mapped` is deliberately not part of the relation. It is this harness's record
 * of whether IT could resolve a position, not a claim either implementation
 * makes — the fork checks the authored `.sm` directly and never reports one — so
 * comparing it would manufacture a divergence on every diagnostics case in the
 * corpus. It is audited instead, in `auditVerdict`.
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
    const a = sortDiagnostics(left.diagnostics, leftBackend);
    const b = sortDiagnostics(right.diagnostics, rightBackend);
    const same = a.length === b.length && a.every((item, index) => samePoint(item, b[index]));
    return same
      ? { agree: true, detail: "" }
      : {
          agree: false,
          detail:
            `[${formatDiagnostics(left.diagnostics, leftBackend)}] vs ` +
            `[${formatDiagnostics(right.diagnostics, rightBackend)}]`,
        };
  }
  return { agree: false, detail: `${left.reason ?? left.kind} vs ${right.reason ?? right.kind}` };
}

export { formatDiagnostics };
