import { describe, expect, test } from "bun:test";
import { analyzeProject } from "./index.ts";

/**
 * `SMITHERS1802` is the fail-closed backstop for a cross-module function that
 * becomes a VALUE. It is not a refusal of ordinary calls — those are exactly
 * what `specification/requirements.mdx` §Inference and
 * `specification/type-system.mdx` §Fallibility Inference require rows to travel
 * through, and `specification/compatibility.mdx` scopes fail-closed to "any
 * construct whose lowering depends on information the file alone does not
 * carry".
 *
 * Three spellings of an ordinary call used to draw it, and one of the three —
 * an accessor read — was drawing it while nothing at all charged the accessor's
 * row. Relaxing that one alone would have widened a live fail-open from
 * "same-module only" to "always", so the row edge lands with it.
 */

const CAPABILITY_SEAM = `
  import { Context } from "smthrs/context"

  export abstract class Clock extends Context {
    abstract now(): number
  }

  export class Stamp {
    get value(): number { return Clock.context().now() }
    set mark(next: number) { Clock.context().now() }
    get pair(): number { return Clock.context().now() }
    set pair(next: number) { Clock.context().now() }
    read(): number { return Clock.context().now() }
  }

  export function stamp(): Stamp { return new Stamp() }
`;

const REGISTRY_SEAM = `
  export interface Rule { readonly name: string }
  const rules: Rule[] = []
  export function register(rule: Rule): void { rules.push(rule) }
  export function count(): number { return rules.length }
`;

function project(consumer: string, seam = CAPABILITY_SEAM, rootDir = "/virtual/accessor-rows") {
  return analyzeProject(
    [{ fileName: "seam.sm", source: seam }, { fileName: "main.sm", source: consumer }],
    { rootDir },
  );
}

function codes(analysis: ReturnType<typeof analyzeProject>): readonly string[] {
  return analysis.diagnostics.filter((diagnostic) => diagnostic.severity === "error")
    .map((diagnostic) => diagnostic.code).sort();
}

describe("an accessor access is an ordinary call", () => {
  test("every spelling of an accessor access charges the accessor's requirement row", () => {
    // Each row is one spelling of "invoke this accessor". Before the edge
    // existed every one of them dropped `Clock` on the floor; only the
    // get-only cross-module READ was refused, and only by SMITHERS1802.
    const spellings: readonly (readonly [string, string])[] = [
      ["property read", "return source.value"],
      ["property read in a comparison", "return source.value === 0 ? 0 : 1"],
      ["setter write", "source.mark = 1; return 0"],
      ["get/set pair read", "return source.pair"],
      ["compound assignment through a pair", "source.pair += 1; return 0"],
      ["element access with a literal key", 'return source["value"]'],
      ["optional property read", "return source?.value ?? 0"],
      ["object destructuring", "const { value } = source; return value"],
      ["renamed object destructuring", "const { value: read } = source; return read"],
    ];
    for (const [label, body] of spellings) {
      const analysis = project(`
        import { Stamp } from "./seam.sm"
        export function read(source: Stamp): number { ${body} }
      `);
      expect({ [label]: codes(analysis) }).toEqual({ [label]: [] });
      expect({ [label]: analysis.files["main.sm"].rows.read.requirements })
        .toEqual({ [label]: ["Clock"] });
    }
  });

  test("a method call still charges its row, and an infallible accessor charges nothing", () => {
    const method = project(`
      import { Stamp } from "./seam.sm"
      export function read(source: Stamp): number { return source.read() }
    `);
    expect(codes(method)).toEqual([]);
    expect(method.files["main.sm"].rows.read.requirements).toEqual(["Clock"]);

    const plain = project(
      `
        import { Box } from "./seam.sm"
        export function read(box: Box): number { return box.size }
      `,
      `
        export class Box {
          private readonly items: number[] = [1, 2]
          get size(): number { return this.items.length }
        }
      `,
    );
    expect(codes(plain)).toEqual([]);
    expect(plain.files["main.sm"].rows.read.requirements).toEqual([]);
  });

  test("a top-level accessor access reports its unsatisfied requirements", () => {
    // Module evaluation has no enclosing function row, exactly as for a
    // top-level call — which has always reported SMITHERS2102.
    for (const body of [
      "const value = stamp().value",
      "const holder = stamp()\nholder.mark = 1",
      'const value = stamp()["value"]',
      "const { value } = stamp()",
    ]) {
      const analysis = project(`
        import { stamp } from "./seam.sm"
        ${body}
        export function main(): string[] { return ["x"] }
      `);
      expect({ [body]: codes(analysis) }).toEqual({ [body]: ["SMITHERS2102"] });
    }
  });

  test("a provide site sees a requirement that only an accessor read introduces", () => {
    // The load-bearing gate. Before the accessor edge this program compiled
    // with zero diagnostics on both backends and aborted at run time, because
    // `Clock` never reached the Layer.provide closure.
    const analysis = project(`
      import { Context } from "smthrs/context"
      import { Layer } from "smthrs/provider"
      import { Stamp, stamp } from "./seam.sm"

      abstract class Label extends Context {
        abstract text(): string
      }

      function readStamp(source: Stamp): string {
        return \`\${Label.context().text()}\${source.value}\`
      }

      const label: Label = { text: () => "t" }
      export const lines = Layer.provide(Layer.succeed(Label, label), () => [readStamp(stamp())])
    `);
    expect(codes(analysis)).toEqual(["SMITHERS2101"]);
    expect(analysis.diagnostics.find((diagnostic) => diagnostic.code === "SMITHERS2101")?.message)
      .toContain("Clock");
  });
});

describe("SMITHERS1802 refuses values, not calls", () => {
  test("an ordinary cross-module call is accepted wherever its row is attributed", () => {
    const accepted: readonly (readonly [string, string])[] = [
      ["inside a function body", "export function go(): number { return count() }"],
      ["at module top level", "const total = count()\nexport function go(): number { return total }"],
      ["inside a top-level block", "let total = 0\nif (count() >= 0) { total = count() }"],
      ["as a top-level statement with a callback-bearing argument", 'register({ name: "Thing" })'],
      ["in a top-level array literal", "const totals = [count()]"],
      ["through a parenthesized callee", "export function go(): number { return (count)() }"],
      ["in a class property initializer", "export class Holder { readonly total: number = count() }"],
      ["re-exported as a binding", "export { count }"],
      ["named by a type query", "export type Sig = typeof count"],
    ];
    for (const [label, body] of accepted) {
      const analysis = project(
        `import { register, count } from "./seam.sm"\n${body}\n`,
        REGISTRY_SEAM,
      );
      expect({ [label]: codes(analysis) }).toEqual({ [label]: [] });
    }
  });

  test("a cross-module function that becomes a value is still refused", () => {
    const refused: readonly (readonly [string, string])[] = [
      ["aliased to a const", "export const chosen = count"],
      ["handed to a callback argument", "export function go(): number[] { return [1].map(count) }"],
      ["in an array literal", "const table = [count]"],
      ["as an object literal property", "const table = { run: count }"],
      // `{ count }` carries the same value `{ count: count }` does; the
      // shorthand's own symbol is the object literal's PROPERTY, which used to
      // let exactly this spelling through.
      ["as an object literal shorthand", "const table = { count }"],
      ["bound with Function.prototype.bind", "const bound = count.bind(null)"],
      ["as a default export expression", "export default count"],
      ["tagged onto a template literal", "export function go(): number { return count`x` }"],
      // A parameter default is walked by neither collectFacts nor the
      // top-level passes, so nothing charges the callee's row there.
      ["in a parameter default", "export function go(total: number = count()): number { return total }"],
    ];
    for (const [label, body] of refused) {
      const analysis = project(
        `import { register, count } from "./seam.sm"\n${body}\n`,
        REGISTRY_SEAM,
      );
      expect({ [label]: codes(analysis) }).toEqual({ [label]: ["SMITHERS1802"] });
    }
  });

  test("an unattributed cross-module accessor reference is impossible, so none is refused", () => {
    // There is no syntax that names an accessor without running it: `box.size`
    // reads it. The rule therefore has nothing to fail closed on here, and the
    // row edge above proves the read is accounted for.
    const analysis = project(`
      import { Stamp, stamp } from "./seam.sm"
      export function main(): string[] {
        const source: Stamp = stamp()
        return [String(source.value)]
      }
    `);
    expect(codes(analysis)).toEqual([]);
    expect(analysis.files["main.sm"].rows.main.requirements).toEqual(["Clock"]);
  });
});
