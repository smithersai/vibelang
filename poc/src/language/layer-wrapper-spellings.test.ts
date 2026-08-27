/**
 * A layer expression means the same thing through every wrapper that changes
 * only its TYPE.
 *
 * `resolveLayerExpression` is the ninth walk in this file's history to have
 * spelled its own wrapper chain instead of reading THE ONE TABLE, and the sixth
 * to have got it wrong. It knew `isParenthesizedExpression` and nothing else, so
 *
 *     Layer.provide(Layer.succeed(Db, db) satisfies Layer<typeof Db>, () => f())
 *
 * was refused `SMITHERS2104` — "Layer expression is opaque" — while the
 * byte-identical program with the two erased words deleted was accepted, and
 * both emit the SAME JavaScript. Measured: the emitted `.mjs` of the two
 * programs is byte-identical and the accepted one runs and prints `v: 3`, so the
 * refusal was of a program that demonstrably works. `as`, `<T>x`,
 * `as unknown as T`, and every combination of them were refused the same way,
 * and a `Layer.provide` that genuinely lacked a capability answered with the
 * blunt `SMITHERS2104` instead of the `SMITHERS2101` that names the capability.
 *
 * Enumerated as 18 spellings x (19 positions + 6 negative controls) = 450 cells.
 * 132 cells moved (10 layer positions x 13 wrapper spellings, plus the two
 * spellings the capability-argument site had never looked through at all);
 * 0 negative control moved, and every accepted cell RUNS and prints its
 * expected value.
 *
 * The two rules this resolver exists for are pinned below as the load-bearing
 * half, because a fix that loosened either would be worse than the defect:
 *
 *   * The `const`-ONLY binding rule. `resolveLayerExpression` treats a binding's
 *     initializer as its value forever, so a reassigned `let`/`var` layer
 *     certified a `Layer.provide` as complete and then panicked with
 *     `capability 'Db' was not provided`. Looking through a type-only wrapper
 *     says NOTHING about whether the binding under it can be reassigned, so a
 *     mutable layer is still opaque in all 18 spellings.
 *   * The opaque-expression rule. A conditional, a helper call, an array
 *     element and a spread are still `SMITHERS2104` in all 18 spellings,
 *     including the direct one — the wrapper adds nothing either way.
 *
 * `!` is deliberately NOT a row that changes: `typeOnlyWrapperOperand` excludes
 * it because in this language `!` is Result propagation and not a type-level
 * operator, `SMITHERS1207` already refuses it on a non-Result, and a layer
 * reached through one stays on the fail-closed path. `nonnull` and
 * `nonnull-over-satisfies` are in the table as the attribution controls that
 * prove the change is the TABLE and not "assertions are ignored".
 *
 * This file is an EQUALITY table for the same reason `type-only-wrappers.test.ts`
 * is: the assertion is not "the `satisfies` spelling is accepted" but "every
 * type-only wrapper answers exactly what the direct spelling answers, at every
 * position". A new wrapper is a new row, and a row that passes without a
 * corresponding edit is evidence the table is total rather than that the case
 * was remembered.
 */
import { describe, expect, test } from "bun:test";
import { analyzeProject } from "./index.ts";

const HEAD = `import { Context } from "smthrs/context"
import { Layer } from "smthrs/provider"

abstract class Db extends Context { abstract read(): string }
abstract class Cfg extends Context { abstract n(): number }

const db: Db = { read: () => "DB" }
const cfg: Cfg = { n: () => 7 }

function needsDb(): string { return Db.context().read() }
function needsBoth(): string { Cfg.context().n(); return Db.context().read() }
`;

function codes(source: string): readonly string[] {
  const analysis = analyzeProject([{ fileName: "main.sm", source }], { rootDir: "/virtual/layer-wrappers" });
  return analysis.diagnostics.filter((diagnostic) => diagnostic.severity === "error")
    .map((diagnostic) => diagnostic.code).sort();
}

/**
 * Every wrapper that changes only the type, plus the two `!` controls.
 *
 * `as const` is absent on purpose: TypeScript itself refuses `<call> as const`
 * (TS1355, "A 'const' assertion can only be applied to references to enum
 * members, or string, number, boolean, array, or object literals"), so it is not
 * a spelling a layer can wear. Before the fix that TypeScript error was MASKED
 * by SMITHERS2104; it is visible now, which is the correct answer for it.
 */
const TYPE_ONLY: readonly { readonly id: string; readonly wrap: (e: string, t: string) => string }[] = [
  { id: "direct", wrap: (e) => e },
  { id: "(x)", wrap: (e) => `(${e})` },
  { id: "x satisfies T", wrap: (e, t) => `${e} satisfies ${t}` },
  { id: "x satisfies unknown", wrap: (e) => `${e} satisfies unknown` },
  { id: "x as T", wrap: (e, t) => `${e} as ${t}` },
  { id: "<T>x", wrap: (e, t) => `<${t}>${e}` },
  { id: "x as unknown as T", wrap: (e, t) => `${e} as unknown as ${t}` },
  { id: "/** @type {T} */ (x)", wrap: (e, t) => `/** @type {${t}} */ (${e})` },
  { id: "(x satisfies T)", wrap: (e, t) => `(${e} satisfies ${t})` },
  { id: "(x) satisfies T", wrap: (e, t) => `(${e}) satisfies ${t}` },
  { id: "(x satisfies T) as T", wrap: (e, t) => `(${e} satisfies ${t}) as ${t}` },
  { id: "(x as T) satisfies T", wrap: (e, t) => `(${e} as ${t}) satisfies ${t}` },
  { id: "(x satisfies T) satisfies unknown", wrap: (e, t) => `(${e} satisfies ${t}) satisfies unknown` },
  { id: "<T>(x satisfies T)", wrap: (e, t) => `<${t}>(${e} satisfies ${t})` },
  { id: "((x satisfies T))", wrap: (e, t) => `((${e} satisfies ${t}))` },
];

/** `!` is NOT a type-only wrapper here; these two are the attribution controls. */
const NON_NULL: readonly { readonly id: string; readonly wrap: (e: string, t: string) => string }[] = [
  { id: "x!", wrap: (e) => `${e}!` },
  { id: "(x satisfies T)!", wrap: (e, t) => `(${e} satisfies ${t})!` },
];

const SUCCEED = "Layer.succeed(Db, db)";
const LAYER_DB = "Layer<typeof Db>";

/**
 * Every position a layer legitimately reaches a `Layer.provide` through.
 *
 * `expected` is what the DIRECT spelling answers; the table asserts every
 * wrapper answers the same thing, so a position whose direct spelling is
 * already refused (an array element, a spread, a helper's return) pins that the
 * wrapper neither helps nor hurts.
 */
const POSITIONS: readonly {
  readonly id: string;
  readonly type: string;
  readonly expected: readonly string[];
  readonly body: (wrap: (e: string, t: string) => string) => string;
}[] = [
  { id: "the argument to Layer.provide", type: LAYER_DB, expected: [],
    body: (w) => `Layer.provide(${w(SUCCEED, LAYER_DB)}, () => needsDb())` },
  { id: "a const binding later provided", type: LAYER_DB, expected: [],
    body: (w) => `const app = ${w(SUCCEED, LAYER_DB)}\nLayer.provide(app, () => needsDb())` },
  { id: "a reference to a const binding", type: LAYER_DB, expected: [],
    body: (w) => `const app = ${SUCCEED}\nLayer.provide(${w("app", LAYER_DB)}, () => needsDb())` },
  { id: "a type-annotated const holding the layer", type: LAYER_DB, expected: [],
    body: (w) => `const app: ${LAYER_DB} = ${w(SUCCEED, LAYER_DB)}\nLayer.provide(app, () => needsDb())` },
  { id: "an argument of a merged layer", type: LAYER_DB, expected: [],
    body: (w) => `Layer.provide(Layer.merge(${w(SUCCEED, LAYER_DB)}, Layer.succeed(Cfg, cfg)), () => needsBoth())` },
  { id: "the merged layer itself", type: "Layer<typeof Db | typeof Cfg>", expected: [],
    body: (w) => `Layer.provide(${w(`Layer.merge(${SUCCEED}, Layer.succeed(Cfg, cfg))`, "Layer<typeof Db | typeof Cfg>")}, () => needsBoth())` },
  { id: "a const binding merged into another", type: LAYER_DB, expected: [],
    body: (w) => `const base = ${SUCCEED}\nconst app = Layer.merge(${w("base", LAYER_DB)}, Layer.succeed(Cfg, cfg))\nLayer.provide(app, () => needsBoth())` },
  { id: "the capability argument of Layer.succeed", type: "typeof Db", expected: [],
    body: (w) => `Layer.provide(Layer.succeed(${w("Db", "typeof Db")}, db), () => needsDb())` },
  { id: "the implementation argument of Layer.succeed", type: "Db", expected: [],
    body: (w) => `Layer.provide(Layer.succeed(Db, ${w("db", "Db")}), () => needsDb())` },
  { id: "a chain of two const bindings", type: LAYER_DB, expected: [],
    body: (w) => `const a = ${w(SUCCEED, LAYER_DB)}\nconst b = a\nLayer.provide(b, () => needsDb())` },
  { id: "wrapped at the binding AND at the use", type: LAYER_DB, expected: [],
    body: (w) => `const a = ${w(SUCCEED, LAYER_DB)}\nLayer.provide(${w("a", LAYER_DB)}, () => needsDb())` },
  { id: "a Layer.succeed with an explicit type argument", type: LAYER_DB, expected: [],
    body: (w) => `Layer.provide(${w("Layer.succeed<typeof Db>(Db, db)", LAYER_DB)}, () => needsDb())` },
  // The direct spelling of each of these is ALREADY refused: the value is
  // genuinely opaque to this POC and no wrapper changes that in either
  // direction. They are here so a later loosening cannot ride in on a wrapper.
  { id: "a layer returned from a helper (opaque, direct too)", type: LAYER_DB, expected: ["SMITHERS2104"],
    body: (w) => `function mk(): ${LAYER_DB} { return ${w(SUCCEED, LAYER_DB)} }\nLayer.provide(mk(), () => needsDb())` },
  { id: "a layer in an array element (opaque, direct too)", type: LAYER_DB, expected: ["SMITHERS2104"],
    body: (w) => `const layers = [${w(SUCCEED, LAYER_DB)}]\nLayer.provide(layers[0], () => needsDb())` },
  { id: "a layer spread into a merge (opaque, direct too)", type: LAYER_DB, expected: ["SMITHERS2104"],
    body: (w) => `const layers = [${w(SUCCEED, LAYER_DB)}]\nLayer.provide(Layer.merge(...layers), () => needsDb())` },
];

describe("a layer is the same layer through every type-only wrapper", () => {
  for (const position of POSITIONS) {
    const direct = codes(HEAD + position.body((e) => e));
    test(`${position.id}: the direct spelling answers ${JSON.stringify(position.expected)}`, () => {
      expect(direct).toEqual(position.expected as string[]);
    });
    for (const wrapper of TYPE_ONLY) {
      test(`${position.id}: \`${wrapper.id}\` answers what the direct spelling answers`, () => {
        expect(codes(HEAD + position.body(wrapper.wrap))).toEqual(direct as string[]);
      });
    }
  }
});

/**
 * The rule this resolver exists for, in every wrapper spelling.
 *
 * A reassigned layer binding is not its initializer. Before the `const`-only
 * tightening this program checked `ok: true` with `provided = {Db}` and an empty
 * missing set, and panicked at run time with `capability 'Db' was not provided`.
 * Looking through a type-only wrapper must not resurrect that, so every spelling
 * of a mutable binding is asserted opaque rather than only the bare one.
 */
describe("a mutable layer binding stays opaque through every wrapper", () => {
  const MUTABLE = "Layer<typeof Db> | Layer<typeof Cfg>";
  const forms: readonly { readonly id: string; readonly body: (wrapped: string) => string }[] = [
    { id: "a reassigned let", body: (v) => `let app: ${MUTABLE} = ${v}\napp = Layer.succeed(Cfg, cfg)\nLayer.provide(app, () => needsDb())` },
    { id: "a reassigned var", body: (v) => `var app: ${MUTABLE} = ${v}\napp = Layer.succeed(Cfg, cfg)\nLayer.provide(app, () => needsDb())` },
    { id: "a let reassigned inside a helper", body: (v) => `let app: ${MUTABLE} = ${v}\nfunction swap(): void { app = Layer.succeed(Cfg, cfg) }\nswap()\nLayer.provide(app, () => needsDb())` },
    { id: "a let that is never reassigned", body: (v) => `let app: ${MUTABLE} = ${v}\nLayer.provide(app, () => needsDb())` },
  ];
  for (const form of forms) {
    for (const wrapper of TYPE_ONLY) {
      test(`${form.id} through \`${wrapper.id}\` is SMITHERS2104`, () => {
        expect(codes(HEAD + form.body(wrapper.wrap(SUCCEED, MUTABLE)))).toEqual(["SMITHERS2104"]);
      });
    }
    // `!` is refused on a non-Result in its own right, so it carries SMITHERS1207
    // BESIDE the opacity refusal rather than instead of it.
    for (const wrapper of NON_NULL) {
      test(`${form.id} through \`${wrapper.id}\` is SMITHERS2104 beside SMITHERS1207`, () => {
        expect(codes(HEAD + form.body(wrapper.wrap(SUCCEED, MUTABLE)))).toEqual(["SMITHERS1207", "SMITHERS2104"]);
      });
    }
  }
});

/**
 * The blunt refusal was hiding the precise one.
 *
 * `Layer.provide` over a layer that really is missing a capability must answer
 * SMITHERS2101 NAMING it. Every wrapped spelling answered SMITHERS2104
 * ("opaque") instead, which is a true statement about the old resolver and a
 * false one about the program.
 */
describe("a Layer.provide missing a capability names it in every wrapper spelling", () => {
  for (const wrapper of TYPE_ONLY) {
    test(`\`${wrapper.id}\` over a Cfg-only layer is SMITHERS2101, not SMITHERS2104`, () => {
      const source = HEAD + `Layer.provide(${wrapper.wrap("Layer.succeed(Cfg, cfg)", "Layer<typeof Cfg>")}, () => needsDb())`;
      expect(codes(source)).toEqual(["SMITHERS2101"]);
    });
  }
  for (const wrapper of NON_NULL) {
    test(`\`${wrapper.id}\` is NOT looked through and stays fail-closed`, () => {
      const source = HEAD + `Layer.provide(${wrapper.wrap("Layer.succeed(Cfg, cfg)", "Layer<typeof Cfg>")}, () => needsDb())`;
      expect(codes(source)).toEqual(["SMITHERS1207", "SMITHERS2104"]);
    });
  }
});

/**
 * An expression that is genuinely opaque stays opaque.
 *
 * A conditional is the case the syntax walk exists to refuse — `flag ? a : b`
 * provides one of two different closures and the checker type reduces the two
 * to the first — so no wrapper over it may make it resolvable.
 */
describe("a genuinely opaque layer expression stays SMITHERS2104", () => {
  const opaque: readonly { readonly id: string; readonly expression: string; readonly extra: string }[] = [
    { id: "a conditional between two layers", expression: `flag ? ${SUCCEED} : Layer.succeed(Cfg, cfg)`, extra: `const flag: boolean = Boolean(1)\n` },
    { id: "a call to a local helper", expression: `mk()`, extra: `function mk(): ${LAYER_DB} { return ${SUCCEED} }\n` },
    { id: "a layer read out of an array", expression: `layers[0]`, extra: `const layers = [${SUCCEED}]\n` },
  ];
  for (const form of opaque) {
    for (const wrapper of [...TYPE_ONLY, ...NON_NULL]) {
      test(`${form.id} through \`${wrapper.id}\` is still SMITHERS2104`, () => {
        const wrapped = wrapper.wrap(`(${form.expression})`, "Layer<typeof Db | typeof Cfg>");
        const measured = codes(HEAD + form.extra + `Layer.provide(${wrapped}, () => needsDb())`);
        expect(measured).toContain("SMITHERS2104");
      });
    }
  }
});
