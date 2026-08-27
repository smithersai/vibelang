/**
 * The panic intrinsic is a CALL, and a template tag is not one of its spellings.
 *
 * `specification/failures.mdx` writes the intrinsic as `panic(...)` and writes
 * no tagged-template form, and the runtime says why: a tag hands the prelude's
 * `panic` a `TemplateStringsArray`, which is not a string, so the authored text
 * is demoted into `cause` and the message degrades. Measured before this rule:
 *
 *   * this backend — ``panic`authored message` `` compiled clean and aborted
 *     with `Panic: Smithers panic` and `[cause]: [ 'authored message' ]`, while
 *     `panic("authored message")` aborted with `Panic: authored message`;
 *   * the Go fork — the same program aborted with a `cause` that was the ARRAY
 *     `[ 'authored message' ]` rather than the authored string, so the two
 *     backends built structurally different `Panic` values for one program; and
 *     ``Reflect.panic`authored message` `` survived lowering untouched and the
 *     ACCEPTED program died with `TypeError: Reflect.panic is not a function`.
 *
 * The code is `SMITHERS1503` — the diagnostic that already answers "this is the
 * panic operation, in a spelling the lowering does not support" — reported at
 * the whole tagged expression, exactly where the call form reports it. Minting a
 * second code for the second member of a family that already has one is how a
 * catalogue stops being an index.
 *
 * The SHAPE is `SMITHERS1604`'s, settled this round on the `crypto` precedent:
 * refuse the OPERATION, leave the NAME resolvable. Refusing an undocumented
 * spelling is also the reversible reading — a refusal can be relaxed by a later
 * decision, where a degraded acceptance already shipped cannot be taken back
 * from programs relying on it.
 *
 * WHAT THIS TABLE CANNOT SEE: it measures diagnostics, not messages. That the
 * accepted call spellings still carry their AUTHORED text is a runtime fact,
 * confirmed out of band on both backends (`smithers run` prints
 * `Panic: authored message` for all four call spellings, before and after).
 */
import { describe, expect, test } from "bun:test";
import { analyzeProject } from "./index.ts";

function codes(source: string, extra: readonly { fileName: string; source: string }[] = []): readonly string[] {
  const analysis = analyzeProject([{ fileName: "main.sm", source }, ...extra], {
    rootDir: "/virtual/panic-tag",
  });
  return analysis.diagnostics.filter((diagnostic) => diagnostic.severity === "error")
    .map((diagnostic) => diagnostic.code).sort();
}

const IMPORTED = 'import { panic } from "smithers:exceptions"\n\n';

function inFunction(statement: string, declarations = ""): string {
  return `${IMPORTED}${declarations}
/** @throws {never} */
export function boom(): void {
  ${statement}
}

boom()
`;
}

describe("the panic intrinsic in a template TAG position is refused", () => {
  const refused: ReadonlyArray<readonly [string, string, string]> = [
    ["the bare spelling", "", "panic`authored message`"],
    ["an empty template", "", "panic``"],
    ["a substituted template", "const n = 7\n", "panic`authored ${n} message`"],
    ["parenthesised", "", "(panic)`authored message`"],
    ["through satisfies", "", "(panic satisfies typeof panic)`authored message`"],
    ["through as", "", "(panic as typeof panic)`authored message`"],
    ["through an angle-bracket assertion", "", "(<typeof panic>panic)`authored message`"],
    ["through a const value alias", "const p = panic\n", "p`authored message`"],
    ["through a const alias chain", "const p1 = panic\nconst p2 = p1\n", "p2`authored message`"],
    ["the ambient Reflect spelling", "", "Reflect.panic`authored message`"],
    ["the ambient Reflect spelling through a computed key", "", 'Reflect["panic"]`authored message`'],
  ];

  for (const [label, declarations, statement] of refused) {
    test(label, () => {
      expect({ [label]: codes(inFunction(statement, declarations)) })
        .toEqual({ [label]: ["SMITHERS1503"] });
    });
  }

  test("at module scope too, where no function channel exists to move it into", () => {
    expect(codes(`${IMPORTED}panic\`authored message\`\n`)).toEqual(["SMITHERS1503"]);
  });
});

describe("the NAME stays resolvable; only the tag operation is refused", () => {
  const accepted: ReadonlyArray<readonly [string, string, string]> = [
    ["an ordinary call", "", 'panic("authored message")'],
    ["a parenthesised call", "", '(panic)("authored message")'],
    ["the ambient Reflect call", "", 'Reflect.panic("authored message")'],
    ["a call through a const value alias", "const p = panic\n", 'p("authored message")'],
    ["a call whose argument is itself a template", "", "panic(`authored message`)"],
  ];

  for (const [label, declarations, statement] of accepted) {
    test(label, () => {
      expect({ [label]: codes(inFunction(statement, declarations)) }).toEqual({ [label]: [] });
    });
  }
});

/**
 * The acceptance guards. Without them the rule can be widened to "any tag whose
 * name is `panic`" and every refusal above stays green — the same trap
 * `20-host-globals/the-function-type-and-prototype-test-stay-available` exists
 * to spring for `SMITHERS1604`.
 */
describe("an ordinary tagged template is untouched, whatever it is called", () => {
  const TAGMOD = {
    fileName: "tagmod.sm",
    source: `/** @throws {never} */
export function panic(parts: TemplateStringsArray): string {
  return parts.join("")
}
`,
  };

  test("String.raw is still a tag", () => {
    expect(codes(`/** @throws {never} */
export function boom(): string {
  return String.raw\`authored message\`
}

boom()
`)).toEqual([]);
  });

  // An IMPORTED user `panic` draws SMITHERS1802 here for an unrelated,
  // pre-existing reason (a cross-module callee row a tagged template cannot
  // resolve in this harness), measured identically before and after this rule.
  // What matters is that this rule adds nothing to it.
  test("an imported user function named panic is not a panic tag", () => {
    expect(codes(`import { panic } from "./tagmod.sm"

/** @throws {never} */
export function boom(): string {
  return panic\`authored message\`
}

boom()
`, [TAGMOD])).not.toContain("SMITHERS1503");
  });

  test("a LOCAL function named panic is still a tag", () => {
    expect(codes(`/** @throws {never} */
function panic(parts: TemplateStringsArray): string { return parts.join("") }

/** @throws {never} */
export function boom(): string {
  return panic\`authored message\`
}

boom()
`)).toEqual([]);
  });

  test("a local object named Reflect with a panic member is still a tag", () => {
    expect(codes(`const Reflect = { panic: (parts: TemplateStringsArray): string => parts.join("") }

/** @throws {never} */
export function boom(): string {
  return Reflect.panic\`authored message\`
}

boom()
`)).toEqual([]);
  });
});

/**
 * A residual, recorded rather than closed. The walk over the tag uses the same
 * `const`-only binding step every other provenance walk in this file uses, so a
 * MUTABLE alias of `panic` escapes it and still degrades. Closing it needs the
 * same decision the reassigned-binding residual at the capability argument needs
 * (see `layer-capability-argument.test.ts`), and closing it here alone would
 * leave the two walks reading `let` differently.
 */
describe("KNOWN RESIDUAL: a mutable alias of panic is not recognized as a tag", () => {
  test("a let alias used as a tag is still accepted", () => {
    expect(codes(inFunction("p`authored message`", "let p = panic\n"))).toEqual([]);
  });
});
