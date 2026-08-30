/**
 * The `effectLowering: "yield"` backend: the SAME instrument as the reference,
 * asked for the resumable calling convention instead of the default one.
 *
 *   authored `.sm`
 *     -> the reference pipeline, verbatim, with `effectLowering: "yield"`
 *     -> emitted TypeScript in which a `.sm` function with a non-empty
 *        requirement row is a generator and `Layer.provide` is a handler install
 *     -> `checkEmittedProject` (stock TypeScript, unchanged)
 *     -> executed by bun through the shared harness, plus one assertion
 *
 * ## Why this is a third backend and not a flag on the second
 *
 * The whole content of migration step 6 is a claim about a DIFFERENCE: two
 * lowerings of one program produce one observation. A flag on the reference
 * would have made that claim invisible — the run would print one column, one
 * `pass/total` line, and no statement about which convention produced it. A
 * backend gets a column, a summary line, a share of the exit code, and an
 * agreement row against the reference, which is exactly the shape "these two
 * agree" has to take to be checkable rather than asserted.
 *
 * It is deliberately never requested alone. `--backend js-yield` asks for the
 * reference AND this one, the way `--backend both` asks for the reference and
 * the fork, because a `js-yield` column with nothing beside it measures the
 * lowering against the corpus rather than against the lowering it replaces, and
 * the second is the claim being made.
 *
 * ## The one assertion this backend adds
 *
 * `poc/src/runtime/layer.ts:16-119` is the promise-hook apparatus that decides
 * when an ASYNC `Layer.provide` body's extent is over. Under this lowering the
 * extent is a handler frame, so the apparatus should never be engaged, and
 * "should never" is worth nothing unless something measures it. The harness
 * epilogue below reads the module's own counters after the program has printed
 * everything it prints, and exits non-zero if either moved.
 *
 * BOTH counters, and the second is the one with teeth here. `live` is
 * `promiseHookLeases` itself, which a balanced run returns to zero whether the
 * block ran a thousand times or never — and `engagements` is what tells those
 * two apart. It matters because these cases execute under BUN, where
 * `promiseHooks.createHook` throws and no lease is ever taken even under the
 * default lowering: an assertion on leases alone would have passed on this host
 * without measuring anything.
 *
 * The exit code is part of the observation `compareObservations` diffs, so an
 * engagement turns into a visible divergence against the reference rather than
 * a line in a log nobody reads. It cannot perturb stdout, which is what the
 * byte-identity claim is about.
 */

import { join } from "node:path";

import { repositoryRoot } from "./corpus.mjs";
import { runJsCase, runJsInterop } from "./backend-js.mjs";

const runtimeImport = join(repositoryRoot, "poc", "src", "runtime", "index.ts");

/** Non-zero, and outside the range any corpus program exits with. */
export const PROMISE_HOOK_LEASE_EXIT = 97;

const PROMISE_HOOK_EPILOGUE = `
import { __vsPromiseHookLeases as __vsLeases } from ${JSON.stringify(runtimeImport)};
const __vsLeaseCount = __vsLeases();
if (__vsLeaseCount.live !== 0 || __vsLeaseCount.engagements !== 0) {
  console.error(
    "effectLowering yield: Layer.provide reached the promise-hook apparatus " +
      __vsLeaseCount.engagements + " time(s), leaving " + __vsLeaseCount.live +
      " live lease(s); layer.ts:16-119 is not dead under the flag",
  );
  process.exit(${PROMISE_HOOK_LEASE_EXIT});
}
`;

export const jsYieldBackend = {
  name: "js-yield",
  label: "JS instrument, effectLowering: \"yield\" (poc/src/language)",
  /**
   * The same work the reference must have done. Sharing the table is the point:
   * a convention that reached a verdict through fewer stages than the
   * convention it is compared against would not be a comparison.
   */
  requiredStages: {
    output: ["lower", "emit-check", "execute"],
    diagnostics: ["lower"],
  },
  emitCheckStage: "emit-check",
  assetStage: "assets",
  reportsMapping: true,
  probe: () => Promise.resolve(undefined),
};

export function runJsYieldCase(testCase, options = {}) {
  return runJsCase(testCase, { ...options, effectLowering: "yield", epilogue: PROMISE_HOOK_EPILOGUE });
}

/**
 * The interop spot-check is plain TypeScript executed directly — no `.sm`, no
 * lowering, therefore nothing for this backend to do differently. It runs the
 * reference's path so the column is populated rather than silently missing,
 * which `verifyCounts` would otherwise report as an integrity failure.
 */
export function runJsYieldInterop(interopCase) {
  return runJsInterop(interopCase);
}
