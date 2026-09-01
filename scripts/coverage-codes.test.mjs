// Assertions about the CODE CENSUS that conformance/COVERAGE.md's two
// subtractions are derived from.
//
// Why this file exists, and why it is a fixture rather than a check over the
// real tree. COVERAGE.md's central claim — "N rules are in both implementations
// and in no case" — is a subtraction over three code sets, and for eight
// revisions those sets were extracted by grepping the literal string
// `SMITHERS[0-9]{4}` over whole directories. That command cannot tell a code an
// implementation REPORTS from a code a comment MENTIONS, and the page recorded
// the same defect biting six separate times before this census replaced it
// (SMITHERS1805, 1708, 4121, 1105, 1807, 4106/4107 — the roll is in
// scripts/coverage-codes.mjs).
//
// A census that miscounts is worse than no census: it is a fail-open about the
// codebase itself, and this project has twice shipped a gate that was green
// while measuring nothing. So the extractor gets a gate of its own, and the
// gate's subject is the METHOD, not the numbers. Numbers move whenever anyone
// touches either implementation; the method must not. Every assertion below is
// therefore over scripts/coverage-codes-fixture/, which does not move, except
// the two at the end that are tripwires on the real tree and are named as such.
//
// VERIFIED LOAD-BEARING, not assumed. Four mutations were applied to
// scripts/coverage-codes.mjs and each turned this file red, naming the specimen
// it regressed on; the file was restored and sha256-compared byte-identical
// after every one:
//   1. `stripComments(text)` -> `text`            => SMITHERS9112 counted
//   2. the `*_test.go` / `*.test.ts` exclusion    => SMITHERS9105, 9106 counted
//   3. the source-extension filter -> `true`      => SMITHERS9104, 9105, 9106,
//                                                    9108 counted
//   4. the comparison/type-union exclusion        => SMITHERS9107, 9109, 9110,
//                                                    9111 counted

import assert from "node:assert/strict";
import test from "node:test";

import {
  FIXTURE_MENTIONED_ONLY,
  FIXTURE_REPORTED,
  assertNoUndetectedConstruction,
  corpusCodes,
  extractFromSource,
  fixtureCensus,
  forkCensus,
  referenceCensus,
  stripComments,
} from "./coverage-codes.mjs";

test("the census counts every shape that REPORTS a code", async (t) => {
  const { reported } = fixtureCensus();
  for (const code of FIXTURE_REPORTED) {
    await t.test(`${code} is counted`, () => {
      assert.ok(
        reported.has(code),
        `${code} sits at a real report site in the fixture and was not counted. ` +
          "Undercounting an implementation SHRINKS the intersection, which makes " +
          "COVERAGE.md claim fewer unprobed rules than there are — the same " +
          "fail-open this census exists to remove.",
      );
    });
  }
});

test("the census counts no shape that merely MENTIONS a code", async (t) => {
  const { reported } = fixtureCensus();
  for (const code of FIXTURE_MENTIONED_ONLY) {
    await t.test(`${code} is rejected`, () => {
      assert.ok(
        !reported.has(code),
        `${code} is only MENTIONED in the fixture and was counted. The extractor ` +
          "has regressed to counting mentions, which is the defect that put " +
          "SMITHERS1105 into the fork's code set from three code comments and kept " +
          "the retired SMITHERS1807 in the reference's from prose.",
      );
    });
  }
});

test("the census counts nothing the fixture does not report", () => {
  const { reported } = fixtureCensus();
  assert.deepEqual([...reported].sort(), [...FIXTURE_REPORTED].sort());
});

test("a dropped code stays auditable rather than vanishing", () => {
  // Anything the census declines to count has to remain visible as a residual,
  // so a reader can check the judgement instead of trusting it. The residual is
  // what caught this extractor's own first bug: a plausible-looking `build`
  // entry in the directory skip list silently removed the whole SMITHERS52xx
  // asset family from the reference's half.
  const { residual } = fixtureCensus();
  for (const code of ["SMITHERS9107", "SMITHERS9109", "SMITHERS9110", "SMITHERS9111"]) {
    assert.ok(residual.has(code), `${code} was dropped without landing in the audit residual`);
  }
});

test("comment stripping does not swallow code that follows a string", () => {
  // The stripper is hand-rolled and string-aware, so the failure mode to guard
  // is a quote it mis-pairs, which would blank the rest of a file and silently
  // shrink a census.
  const source = [
    'const message = "a string with // and /* inside it";',
    'report(node, "SMITHERS9001", "after the tricky string");',
  ].join("\n");
  const { reported } = extractFromSource(source);
  assert.deepEqual([...reported], ["SMITHERS9001"]);
  assert.match(stripComments(source), /SMITHERS9001/);
});

test("a comment cannot hide a real report site from the census", () => {
  const source = [
    "// The rule this replaced used to read: report(node, \"SMITHERS9112\", \"gone\").",
    'report(node, "SMITHERS9001", "still live");',
  ].join("\n");
  const { reported } = extractFromSource(source);
  assert.deepEqual([...reported], ["SMITHERS9001"]);
});

test("the reference does not construct codes the census cannot see", () => {
  // The fork builds durable codes as prefix + bare suffix, which is why a
  // literal grep undercounted it by eleven. If the reference ever starts doing
  // the same, this census would undercount IT, in silence. Checked on every run
  // rather than believed.
  assert.doesNotThrow(assertNoUndetectedConstruction);
});

test("the census measures something", () => {
  // This project has twice shipped a gate that was green while measuring
  // nothing, so the floor is asserted rather than assumed. The bounds are
  // deliberately loose: they catch "the walk found no files", not ordinary
  // movement in either implementation.
  const reference = referenceCensus().reported;
  const fork = forkCensus().reported;
  const corpus = corpusCodes();
  assert.ok(reference.size > 50, `the reference census collapsed to ${reference.size} codes`);
  assert.ok(fork.size > 50, `the fork census collapsed to ${fork.size} codes`);
  assert.ok(corpus.size > 50, `the corpus census collapsed to ${corpus.size} codes`);
});

test("the codes COVERAGE.md calls phantoms are still reported by neither backend", () => {
  // A TRIPWIRE ON THE REAL TREE, and the only assertion here that a legitimate
  // implementation change can turn red.
  //
  // Each of these is a code COVERAGE.md states in prose that NOTHING reports —
  // 4106 and 4107 withdrawn with the durable walls at step 11, 1807 retired at
  // step 13, 1805 and 1708 retired earlier. Those are load-bearing claims: the
  // ledger's "in both, no case" set excludes 4106 on the strength of one, and
  // its reference-only table excludes 1708 on another. A prose claim nothing can
  // falsify is exactly the gap this lane was opened to close.
  //
  // If this goes red, an implementation has brought one of these rules BACK.
  // That is not a bug in this test — re-derive COVERAGE.md
  // (`node scripts/coverage-codes.mjs subtraction`) and re-stamp the sections
  // that name the code, then update this list.
  const reference = referenceCensus().reported;
  const fork = forkCensus().reported;
  for (const code of ["SMITHERS1708", "SMITHERS1805", "SMITHERS1807", "SMITHERS4106", "SMITHERS4107"]) {
    assert.ok(!reference.has(code), `${code} is live in the reference again; re-derive COVERAGE.md`);
    assert.ok(!fork.has(code), `${code} is live in the fork again; re-derive COVERAGE.md`);
  }
});
