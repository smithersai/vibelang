/**
 * The `Layer.succeed` capability argument names the SAME capability that
 * `Capability.context()`'s receiver names, and it is resolved by the SAME
 * function.
 *
 * The runtime registers a layer under the constructor its capability argument
 * EVALUATES to, and resolves `.context()` by the constructor its receiver
 * EVALUATES to. A layer's provided set and a body's required set are therefore
 * one fact about one program. They were computed by two different resolvers —
 * `contextReceiver` for the read and a bespoke identifier walk for the layer —
 * and the two disagreed in OPPOSITE directions on the two backends, which is
 * why no one-sided fix worked:
 *
 *   * `Layer.succeed(Db as unknown as typeof Cfg, cfg)` — the Go fork read the
 *     ASSERTED type, recorded `Cfg`, compiled `ok: true`, RAN, and aborted with
 *     `Panic: unsatisfied Context requirement`. A fail-open.
 *   * `Layer.succeed(<any>Db, db)` — the Go fork read the ERASED type, found no
 *     class, and refused `SMITHERS2104` a program this backend accepted and
 *     RAN.
 *   * `const Alias = Db; Layer.succeed(Alias, db)` — a `const` value alias is
 *     not a class DECLARATION, so this backend fell back to the identifier's
 *     TEXT and recorded the phantom row `Alias`, refusing `SMITHERS2101
 *     "missing Db"` a program the fork accepted and RAN.
 *
 * The rule applied is `SMITHERS2106`'s, unchanged and not restated: resolve the
 * SYNTAX first and the checker type second, and refuse when the expression
 * cannot be pinned to exactly one `Context` class declaration. The ordering is
 * load-bearing because TypeScript subtype-reduces `typeof Db | typeof Twin` to
 * `typeof Db` and nothing in the resulting type remembers the other arm — the
 * measurement that decided `SMITHERS2106` in the first place, reproduced here
 * at the capability argument by `C08`, which the Go fork accepted and which
 * PANICKED reading `Db` after registering `Twin`.
 *
 * Refusal at this site is the fail-closed `SMITHERS2104` the resolver already
 * answers for every expression it cannot see through. No code is minted:
 * `SMITHERS2106` is the refusal for an unpinned `.context()` RECEIVER, where
 * the alternative is a silent capability read; the alternative here is a layer
 * whose closure is unproven, which is what `SMITHERS2104` says.
 *
 * WHAT THIS TABLE CANNOT SEE. Every accepting row is confirmed by the runtime
 * oracle out of band (`smithers run` prints `v: 3`); this file measures only
 * the diagnostics. And a table built solely from type-PRESERVING spellings is
 * vacuous for this rule — it cannot distinguish a syntax walk from a checker
 * walk, because both answer identically on every one of them. The rows that
 * carry the distinction are the LAUNDERING ones (`B*`, where the value and the
 * type name different classes) and the ERASING ones (`as any`, `<any>`); a
 * type-directed implementation passes every other row in this file and fails
 * exactly those.
 */
import { describe, expect, test } from "bun:test";
import { analyzeProject } from "./index.ts";

const HEAD = `import { Context } from "smthrs/context"
import { Layer } from "smthrs/provider"

abstract class Db extends Context { abstract read(): string }
abstract class Twin extends Context { abstract read(): string }
abstract class Cfg extends Context { abstract n(): number }

const db: Db = { read: () => "DB" }
const twin: Twin = { read: () => "TWIN" }
const cfg: Cfg = { n: () => 7 }
const flag: boolean = true

function needsDb(): string { return Db.context().read() }
function needsCfg(): number { return Cfg.context().n() }
`;

function codes(body: string): readonly string[] {
  const analysis = analyzeProject([{ fileName: "main.sm", source: HEAD + body + "\n" }], {
    rootDir: "/virtual/layer-capability",
  });
  return analysis.diagnostics.filter((diagnostic) => diagnostic.severity === "error")
    .map((diagnostic) => diagnostic.code).sort();
}

describe("a capability argument that pins one Context class is that capability", () => {
  /**
   * Every spelling whose VALUE is `Db`. The direct spelling is the baseline and
   * is asserted clean in its own right, so an accidentally-refusing baseline
   * cannot make the equalities below vacuous.
   */
  const pinned: ReadonlyArray<readonly [string, string, string]> = [
    ["direct", "", "Db"],
    ["parenthesised", "", "(Db)"],
    ["doubly parenthesised", "", "((Db))"],
    ["as typeof", "", "Db as typeof Db"],
    ["satisfies typeof", "", "Db satisfies typeof Db"],
    ["angle-bracket assertion", "", "<typeof Db>Db"],
    ["as any", "", "Db as any"],
    ["angle-bracket any", "", "<any>Db"],
    ["as unknown as", "", "Db as unknown as typeof Db"],
    ["as unknown as any", "", "Db as unknown as any"],
    ["satisfies unknown", "", "Db satisfies unknown"],
    ["parenthesised as any", "", "(Db as any)"],
    ["angle any then satisfies", "", "(<any>Db) satisfies unknown"],
    ["as then satisfies", "", "(Db as typeof Db) satisfies typeof Db"],
    ["satisfies then as", "", "(Db satisfies typeof Db) as typeof Db"],
    ["const value alias", "const Alias = Db", "Alias"],
    ["const alias chain", "const A1 = Db\nconst A2 = A1", "A2"],
    ["typed const alias", "const Alias: typeof Db = Db", "Alias"],
    ["const alias of a wrapped initializer", "const Alias = Db as any", "Alias"],
    ["const alias wrapped at the use", "const Alias = Db", "Alias as any"],
    ["const alias parenthesised at the use", "const Alias = Db", "(Alias)"],
    ["const alias with a union annotation", "const C: typeof Db | typeof Twin = Db", "C"],
    ["a conditional whose arms are the same class", "", "flag ? Db : Db"],
    ["a logical-or of the same class", "", "Db || Db"],
    ["a property-held alias", "const box = { Db }", "box.Db"],
    ["a satisfies against a structurally identical sibling", "", "Db satisfies typeof Twin"],
  ];

  for (const [label, declarations, argument] of pinned) {
    test(label, () => {
      const body = `${declarations}\nLayer.provide(Layer.succeed(${argument}, db), () => needsDb())`;
      expect({ [label]: codes(body) }).toEqual({ [label]: [] });
    });
  }
});

describe("a LAUNDERING capability argument answers its value, never its type", () => {
  /**
   * The value and the asserted type name different classes. These are the rows
   * a type-directed resolver gets wrong, and the ones the Go fork accepted and
   * then panicked on.
   */
  const laundered: ReadonlyArray<readonly [string, string, string, string, string]> = [
    ["as unknown as", "", "Db as unknown as typeof Cfg", "cfg", "needsCfg"],
    ["angle-bracket double assertion", "", "<typeof Cfg><unknown>Db", "cfg", "needsCfg"],
    ["through a const binding", "const L = Db as unknown as typeof Cfg", "L", "cfg", "needsCfg"],
    ["through an any hop", "", "(Db as any) as typeof Cfg", "cfg", "needsCfg"],
    ["in the other direction", "", "Cfg as unknown as typeof Db", "db", "needsDb"],
  ];

  for (const [label, declarations, argument, implementation, read] of laundered) {
    test(label, () => {
      const body = `${declarations}\nLayer.provide(Layer.succeed(${argument}, ${implementation}), () => ${read}())`;
      // The precise code that NAMES the capability, not the blunt one.
      expect({ [label]: codes(body) }).toEqual({ [label]: ["SMITHERS2101"] });
    });
  }
});

describe("a capability argument that pins no single class is opaque", () => {
  const ambiguous: ReadonlyArray<readonly [string, string, string]> = [
    ["a conditional over two capabilities", "", "flag ? Db : Twin"],
    ["a conditional whose runtime arm is the other class", "const off: boolean = false", "off ? Db : Twin"],
    ["a nested conditional", "", "flag ? Db : (flag ? Twin : Db)"],
    ["a logical-or over two capabilities", "", "Twin || Db"],
    ["a nullish coalescing over two capabilities", "", "(undefined as unknown as typeof Twin) ?? Db"],
    ["an anonymous class expression", "", 'class extends Context { read() { return "x" } }'],
  ];

  for (const [label, declarations, argument] of ambiguous) {
    test(label, () => {
      const body = `${declarations}\nLayer.provide(Layer.succeed(${argument}, db as never), () => needsDb())`;
      expect({ [label]: codes(body).includes("SMITHERS2104") }).toEqual({ [label]: true });
    });
  }

  /**
   * A parameter has no `const` initializer for the syntax step to read, and its
   * TYPE pins no class: a bound never pins the key even when it names exactly
   * one, because a SUBCLASS substitutes for it and carries a different nominal
   * key. Both details were settled with `SMITHERS2106` and are inherited here.
   *
   * `Layer.provide` inside a function never reports the missing-capability
   * `SMITHERS2101` (that check is top-level only), so the OBSERVABLE half of
   * these two rows is exactly "opaque or not".
   */
  const parameterised: ReadonlyArray<readonly [string, string]> = [
    ["a union-typed parameter", `function boot(C: typeof Db | typeof Twin, impl: Db): void {
  Layer.provide(Layer.succeed(C, impl), () => needsDb())
}
boot(Db, db)`],
    ["a bare type parameter, whose bound names ONE class", `function boot<C extends typeof Db>(C: C, impl: InstanceType<C>): void {
  Layer.provide(Layer.succeed(C, impl), () => needsDb())
}
boot(Db, db)`],
  ];

  for (const [label, body] of parameterised) {
    test(label, () => {
      expect({ [label]: codes(body).includes("SMITHERS2104") }).toEqual({ [label]: true });
    });
  }
});

describe("the refusals this resolver exists for", () => {
  test("a layer that genuinely misses a capability NAMES it", () => {
    expect(codes("Layer.provide(Layer.succeed(Cfg, cfg), () => needsDb())")).toEqual(["SMITHERS2101"]);
  });

  test("it names it through a wrapper too, and through a const alias", () => {
    expect(codes("Layer.provide(Layer.succeed(Cfg as typeof Cfg, cfg), () => needsDb())"))
      .toEqual(["SMITHERS2101"]);
    expect(codes("const Alias = Cfg\nLayer.provide(Layer.succeed(Alias, cfg), () => needsDb())"))
      .toEqual(["SMITHERS2101"]);
  });

  /**
   * `collectLayerBindings` is the `const`-ONLY rule for the LAYER binding and
   * is orthogonal to the capability argument by construction — looking through
   * a wrapper, or through a value alias, says nothing about whether the binding
   * holding the LAYER can be reassigned. "Orthogonal by construction" is an
   * argument and not a measurement, so it is measured.
   */
  test("the const-only LAYER binding tightening survives untouched", () => {
    const mutable = [
      "let app = Layer.succeed(Db, db)\napp = Layer.succeed(Cfg, cfg) as unknown as typeof app\nLayer.provide(app, () => needsDb())",
      "var app = Layer.succeed(Db, db)\napp = Layer.succeed(Cfg, cfg) as unknown as typeof app\nLayer.provide(app, () => needsDb())",
      "let app = Layer.succeed(Db, db)\nLayer.provide(app, () => needsDb())",
      "const a = Layer.succeed(Db, db)\nconst b = Layer.succeed(Db, db)\nLayer.provide(flag ? a : b, () => needsDb())",
      "function mk(): Layer<typeof Db> { return Layer.succeed(Db, db) }\nLayer.provide(mk(), () => needsDb())",
    ];
    for (const body of mutable) {
      expect({ [body]: codes(body) }).toEqual({ [body]: ["SMITHERS2104"] });
    }
  });

  test("a const layer still works, and a merged layer still adds up", () => {
    expect(codes("const app = Layer.succeed(Db, db)\nLayer.provide(app, () => needsDb())")).toEqual([]);
    expect(codes(
      "Layer.provide(Layer.merge(Layer.succeed(Db, db), Layer.succeed(Cfg, cfg)), () => needsDb() + needsCfg())",
    )).toEqual([]);
    expect(codes(
      "Layer.provide(Layer.merge(Layer.succeed(Cfg, cfg), Layer.succeed(Cfg, cfg)), () => needsDb())",
    )).toEqual(["SMITHERS2101"]);
  });

  /**
   * The attribution control. `!` is in `contextReceiver`'s wrapper list — it is
   * spelled out there DELIBERATELY, because `as` changes the type and never the
   * value — so the capability under one still resolves, and `SMITHERS1207`
   * refuses the `!` in its own right. If the change had been "assertions are
   * ignored in a layer position" rather than "this site calls the settled
   * receiver resolver", this row is what would have broken: it would have kept
   * a SMITHERS2104 beside the SMITHERS1207.
   */
  test("postfix ! is refused in its own right and adds no second refusal", () => {
    expect(codes("Layer.provide(Layer.succeed(Db!, db), () => needsDb())")).toEqual(["SMITHERS1207"]);
  });
});

/**
 * A residual, recorded rather than closed: a REASSIGNED binding.
 *
 * `let C = Db; C = Twin; Layer.succeed(C, db)` is accepted with the row `Db`
 * and PANICS at run time, on both backends. That is not this site's defect and
 * it is not this site's to fix: it is the settled `SMITHERS2106` rule's own
 * residual, measured identically at the receiver —
 * `let C = Db; C = Twin; C.context()` checks clean with the row `Db` and aborts
 * with `capability 'Twin' was not provided` — because `constantInitializer`
 * excludes `let` and the walk then falls through to the checker type, which
 * TypeScript has already narrowed back to `typeof Db`.
 *
 * It is pinned here so that the day the receiver rule closes it, this site is
 * KNOWN to move with it — they are one function now — and so that nobody reads
 * the acceptance as intentional. Closing it needs a decision this lane did not
 * have: `const`-ness alone would refuse `let C = Db` that is never reassigned,
 * which is a correct program that runs.
 */
describe("KNOWN RESIDUAL, shared with SMITHERS2106: a reassigned binding", () => {
  test("a reassigned let/var capability argument is accepted, exactly as the receiver is", () => {
    expect(codes("let C = Db\nC = Twin\nLayer.provide(Layer.succeed(C, db), () => needsDb())")).toEqual([]);
    expect(codes("var V = Db\nV = Twin\nLayer.provide(Layer.succeed(V, db), () => needsDb())")).toEqual([]);
    // The same shape at the RECEIVER, which is where the rule was settled.
    expect(codes(
      "let C = Db\nC = Twin\nfunction readIt(): string { return C.context().read() }\nLayer.provide(Layer.succeed(Db, db), () => readIt())",
    )).toEqual([]);
  });
});
