/**
 * Rows THREE and FIVE of `specification/compatibility.mdx`
 * §Determinism-Sensitive Members, on the reference frontend, against the same
 * vectors the Go fork is checked against by
 * `compiler/fork_ambient_charge_test.go`.
 *
 * Both rows CHARGE rather than refuse. `Promise.race`/`Promise.any` "MUST charge
 * a `Scheduler` requirement, because their value *is* arrival order"; every
 * ICU-backed operation "MUST charge a `Locale` requirement". The paragraph under
 * the specification's table supplies the criterion that makes them charges and
 * not refusals: the ambient spelling is additionally refused only "where the
 * capability has a source-language surface the author can write instead", and
 * neither `Scheduler` nor `Locale` has one. A refusal here would name a remedy
 * that cannot be written.
 *
 * **This file exists because a charge emits no diagnostic of its own, and
 * because that was mistaken for a charge being unobservable.** `host-global-allowlist.test.ts`
 * already reads the row directly and pins the thirty ICU members; what it cannot
 * do is hold the OTHER backend to the same answer, because the Go fork's
 * `CompileResult` protocol carries no rows. For a full cycle both the fork's
 * `rowSet` comment, `compatibility.mdx`, and the notes of the one corpus case in
 * the class concluded from that that the disagreement was invisible to any
 * differential — and it was not. An UNSATISFIED requirement row is reported at a
 * top-level call as `SMITHERS2102`, on both backends, with the capability named
 * in the message. Every vector in the shared corpus is a program whose charge
 * reaches module scope, so both implementations can be, and now are, held to it.
 *
 * So this file asserts two things per vector: the diagnostic list, which is what
 * the fork is also held to, and the requirement ROW, which is the direct
 * observation only this backend can make. The first is the cross-backend
 * agreement; the second is what stops the first from being satisfied by a
 * `SMITHERS2102` that arrived for some other reason.
 */
import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { compileAndCheckProject } from "./index.ts";

const workspace = mkdtempSync(join(tmpdir(), "smithers-ambient-charge-"));
afterAll(() => rmSync(workspace, { recursive: true, force: true }));

const RUNTIME = join(import.meta.dir, "../runtime/index.ts");
const VECTORS = join(import.meta.dir, "../../../compiler/ambient-charge-vectors.json");

interface AmbientChargeVector {
  readonly name: string;
  readonly why: string;
  readonly source: string;
  readonly requirements: readonly string[];
  readonly diagnostics: readonly string[];
}

const vectors: readonly AmbientChargeVector[] = JSON.parse(readFileSync(VECTORS, "utf8")).vectors;

test("the shared ambient-charge corpus still has the direction it exists to pin", () => {
  // A corpus every one of whose vectors charges nothing would be green and would
  // assert nothing, which is the failure mode this file replaces. Checked here
  // rather than assumed, and mirrored by the Go side's own count.
  expect(vectors.length).toBeGreaterThanOrEqual(9);
  expect(vectors.filter((vector) => vector.requirements.length > 0).length).toBeGreaterThanOrEqual(5);
});

for (const vector of vectors) {
  test(vector.name, () => {
    const { result } = compileAndCheckProject(
      [{ fileName: join(workspace, `${vector.name}.sm`), source: vector.source }],
      { rootDir: workspace, outDir: join(workspace, "out"), runtimeImport: RUNTIME },
    );

    const diagnostics = result.diagnostics
      .filter((diagnostic) => diagnostic.severity === "error")
      .map((diagnostic) => `${diagnostic.code}@${diagnostic.line}:${diagnostic.column}`)
      .sort();
    expect([vector.name, diagnostics]).toEqual([vector.name, [...vector.diagnostics].sort()]);

    // The row itself: what "CHARGE" means, and the observation the fork's
    // protocol cannot carry. `main` is never the charging function in this
    // corpus — the charge lives in the helper the top level calls — so reading
    // every row but `main`'s is what makes the vector's `requirements` a
    // statement about the program rather than about one function name.
    const only = Object.values(result.files)[0];
    const rows = only?.analysis.rows ?? {};
    const charged = [
      ...new Set(
        Object.entries(rows)
          .filter(([name]) => name !== "main")
          .flatMap(([, row]) => row.requirements),
      ),
    ].sort();
    expect([vector.name, charged]).toEqual([vector.name, [...vector.requirements].sort()]);
  });
}
