// Reference-side (TypeScript) specimens for scripts/coverage-codes.mjs.
//
// The four REPORT sites here (VIBE9001-9004) must be counted. The mentions
// must not be. Nothing in this file is executed; it is read as text.

// SPECIMEN — a line comment saying a rule is withdrawn. This is the shape that
// put VIBE4106 and VIBE4107 into BOTH implementations' code sets after
// step 11 felled the walls: `// WALL 1 (4106) and WALL 2 (4107), withdrawn.`
// WALL 1 (VIBE9101), withdrawn.

// SPECIMEN — a comment QUOTING a code, in full report shape. This one exists to
// make comment-stripping independently load-bearing: every other mention shape
// in this fixture is unquoted, so the "must be a quoted string" half of the rule
// would reject them on its own and a regression that stopped stripping comments
// could still pass. It cannot pass this one. The real counterpart is
// compiler/fork_error_identity_test.go:295, which holds `l.report(node,
// "VIBE1151"` inside a Go raw string.
//   The rule this replaced used to read: report(node, "VIBE9112", "gone").

/**
 * SPECIMEN — a JSDoc comment describing ANOTHER backend's behaviour. This is the
 * shape that made VIBE9102's real counterpart, VIBE1105, read as
 * fork-implemented from three code comments when the fork implements no such
 * rule at all.
 *
 * SPECIMEN — a comment recording a rule's own retirement, the VIBE9103
 * shape. Its real counterparts are VIBE1805 (retired, recorded in
 * poc/src/language/README.md) and VIBE1807 (retired by migration step 13,
 * recorded in comments in the very files that used to report it).
 */
export interface Diagnostic {
  readonly code: string;
  readonly message: string;
}

// SPECIMEN — a type union DECLARING the code space. A declaration of which codes
// exist is not a report of one. Real counterpart:
// poc/src/language/compiler-options.ts:109.
export interface OptionDiagnostic {
  readonly code: "VIBE9109" | "VIBE9110" | "VIBE9111";
}

declare function report(node: unknown, code: string, message: string): void;

export function reportSites(node: unknown, kind: string): Diagnostic[] {
  const collected: Diagnostic[] = [];

  // REPORT — a `code:` property in an object literal.
  collected.push({ code: "VIBE9001", message: "a code property is a report site" });

  // REPORT — an ordinary argument position.
  report(node, "VIBE9002", "an argument is a report site");

  // REPORT — an argument position broken across a line, which a line-oriented
  // matcher would miss.
  report(
    node,
    "VIBE9003",
    "an argument stays a report site across a line break",
  );

  // REPORT — a single-quoted argument, and a ternary selecting between codes.
  // The ternary shape is real: poc/src/language/semantic.ts:5800 picks between
  // VIBE2105 and VIBE1303 exactly this way.
  report(node, kind === "provide" ? 'VIBE9004' : "VIBE9002", "still a report site");

  return collected;
}

// NOT A REPORT — an equality comparison. A consumer filtering on a code is not a
// producer of it. Real counterpart: poc/src/language/project-compile.ts:173.
export const isRetired = (diagnostic: Diagnostic): boolean =>
  diagnostic.code === "VIBE9107";

// NOT A REPORT — a code named inside a LONGER string. Real counterpart:
// compiler/forkbridge/hostrules.go.txt:189.
export const precedent = "VIBE9103 is the precedent for this rule, and it is gone";
