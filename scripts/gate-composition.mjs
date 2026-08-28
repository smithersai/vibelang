/**
 * What the pre-merge gate is made of, asserted rather than assumed.
 *
 * ## The defect this exists for
 *
 * `npm test` was the pre-merge gate and `npm run verify:pack` was not in it:
 * `verify:pack` was reachable only from `release:verify`. But
 * `scripts/release-fixtures/api-types.mts` and
 * `scripts/release-fixtures/runtime-smoke.mjs` are the ONLY things in the tree
 * that assert several properties of the shipped durable surface — that
 * `smthrs/durable` does not export `waitSignal`, that `MAX_DURABLE_JSON_NODES`
 * is 100_000, that the barrel and the `./durable/source-compiler` subpath are
 * the same function object, that `decodePlanArtifact(artifact).digest` equals
 * the compiler's own `plan.digest`. Nothing under `test/` asserts any of them,
 * and nothing `npm test` runs reads `scripts/release-fixtures/**` at all. A
 * change to that surface was therefore silent in PR CI and loud at release.
 *
 * Measured on 2026-08-27: appending one export to the installed
 * `dist/durable.js` of a real packed tarball made `runtime-smoke.mjs` fail at
 * its line 165 and left every `npm test` assertion untouched.
 *
 * ## The composition, and why it is this shape
 *
 * `verify:pack` shells out to `npm run prepack`, and `prepack` is `npm run
 * test`. So **`verify:pack` already contains the whole of `npm test`**, and the
 * two obvious wirings are both wrong:
 *
 *   - `"test": "... && npm run verify:pack"` is unbounded recursion. `prepack`
 *     is `npm run test`, so `test -> verify:pack -> prepack -> test -> ...`
 *     never terminates, and a plain `npm pack` would drag the entire release
 *     verification along with it.
 *   - `"gate:premerge": "npm test && npm run verify:pack"` runs every suite
 *     twice — roughly eighteen minutes of node, poc and Go gates, paid for a
 *     second time to learn nothing new.
 *
 * The composition that works is the trivial one: the pre-merge gate IS
 * `verify:pack`, entered through the name `gate:premerge`, and it reaches the
 * suites exactly once through the `prepack` it already runs.
 *
 * That makes two things load-bearing which used to be incidental, so they are
 * checked here instead of remembered:
 *
 *   1. `prepack` must stay exactly `npm run test`. If it is weakened, the
 *      pre-merge gate silently stops running the suites — the gate would still
 *      be green, and it would be measuring packaging alone.
 *   2. `npm test` must keep running the stages it runs today. Same reason: this
 *      gate does not enumerate the suites itself, it inherits them, so a stage
 *      that quietly leaves `npm test` quietly leaves the pre-merge gate.
 *
 * `REQUIRED_TEST_STAGES` is a subset check, not an equality check: adding a
 * gate to `npm test` needs no edit here, removing one does. That asymmetry is
 * deliberate — this repository's most-repeated defect is a check that exists
 * and does not run, so the direction that must be hard is the direction that
 * takes coverage away.
 */

/**
 * The stages `npm test` must still reach. Spelled as the substrings that
 * actually appear in the script, so a rename shows up here as a failure with a
 * name in it rather than as a silent subset.
 */
export const REQUIRED_TEST_STAGES = [
  "tsconfig.compat.json",
  "scripts/node-test-gate.mjs",
  "scripts/poc-test-gate.mjs",
  "scripts/go-test-gate.mjs",
];

/** Does `script` reach the packaging gate, under any of its names? */
function reachesPackagingGate(script) {
  return /verify:pack|verify-pack\.mjs|gate:premerge/.test(script ?? "");
}

/**
 * Does `script` run the suite gate directly, rather than through `prepack`?
 *
 * Matches `npm test` and `npm run test` in any one `&&`-separated segment,
 * including with flags in between (`npm --prefix . run test`). The negative
 * lookahead keeps a differently-named script such as `test:unit` from reading as
 * the root suite — that would be a false accusation, and a composition check
 * nobody can satisfy is worse than none.
 */
function runsSuitesDirectly(script) {
  return /\bnpm\b[^&|;]*?\b(?:run\s+)?test(?![\w:-])/.test(script ?? "");
}

/**
 * Every reason this package's gate wiring may not be trusted, as sentences.
 * Empty means the pre-merge gate runs the suites exactly once and the packaging
 * verification with them.
 */
export function gateCompositionViolations(scripts = {}) {
  const violations = [];
  const test = scripts.test ?? "";
  const premerge = scripts["gate:premerge"] ?? "";

  if (scripts.prepack !== "npm run test") {
    violations.push(
      "plain `npm pack` must retain the non-recursive `npm run test` prepack contract, because " +
        "`npm run gate:premerge` measures the suites only by running that prepack. Found: " +
        `${JSON.stringify(scripts.prepack)}.`,
    );
  }

  if (reachesPackagingGate(test)) {
    violations.push(
      "`npm test` must not reach the packaging gate. `prepack` is `npm run test` and the packaging " +
        "gate runs `npm run prepack`, so an edge from `test` back to `verify:pack` is unbounded " +
        "recursion rather than a stronger gate — and it would make a plain `npm pack` run the whole " +
        "release verification. The pre-merge entry point is `npm run gate:premerge`.",
    );
  }

  const missing = REQUIRED_TEST_STAGES.filter((stage) => !test.includes(stage));
  if (missing.length > 0) {
    violations.push(
      `\`npm test\` no longer runs ${missing.join(", ")}. The pre-merge gate does not enumerate the ` +
        "suites, it inherits them from `npm test` through `prepack`, so a stage that leaves `npm test` " +
        "leaves the pre-merge gate without leaving a trace. Put it back, or change this list on purpose.",
    );
  }

  if (premerge === "") {
    violations.push(
      "there is no `gate:premerge` script. The pre-merge gate has to have a name, or the thing CI " +
        "runs drifts away from the thing that was reasoned about.",
    );
  } else if (!reachesPackagingGate(premerge)) {
    violations.push(
      `\`gate:premerge\` (${JSON.stringify(premerge)}) does not run the packaging gate, which is the ` +
        "one place `scripts/release-fixtures/**` is executed and therefore the only place a change to " +
        "the shipped durable surface is checked before merge.",
    );
  } else if (runsSuitesDirectly(premerge)) {
    violations.push(
      `\`gate:premerge\` (${JSON.stringify(premerge)}) runs the suites directly AND runs the packaging ` +
        "gate, which runs them again through `prepack`. That is roughly eighteen minutes paid twice " +
        "for the same answer. Let the packaging gate reach them.",
    );
  }

  if (runsSuitesDirectly(scripts["release:verify"] ?? "")) {
    violations.push(
      `\`release:verify\` (${JSON.stringify(scripts["release:verify"])}) runs the suites directly on ` +
        "top of a packaging gate that already runs them through `prepack`. Same double-run, at the " +
        "point in the process where it is least affordable.",
    );
  }

  return violations;
}
