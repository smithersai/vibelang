import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import * as ts from "typescript-js";
import { collectControlFlowExpressionPlans } from "./control-flow.ts";
import { compileSmithers } from "./compile.ts";
import { checkEmittedTypeScript } from "./validate.ts";
import { __vsInspectResult } from "../runtime/index.ts";

const collect = (source: string) => {
  const file = ts.createSourceFile("control.sm", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  return { file, plans: collectControlFlowExpressionPlans(source, file) };
};

test("recovery AST becomes explicit if and switch evaluation-order plans", () => {
  const { plans } = collect(`
    function choose(active: boolean, kind: "one" | "two"): number {
      const first = if (active) {
        const offset = 1
        offset + 1
      } else {
        0
      }
      return switch (kind) {
        case "one":
          first
        case "two":
          first + 2
        default:
          throw new Error("unreachable")
      }
    }
  `);
  expect(plans.diagnostics).toEqual([]);
  expect([...plans.byHost.values()].map((plan) => plan.kind)).toEqual(["if", "switch"]);
  expect(plans.recoveredKeywordStarts.size).toBe(2);
});

test("collects nested recovery plans inside selected branches", () => {
  const { plans } = collect(`
    function nested(outer: boolean, inner: boolean, kind: string): number {
      const value = if (outer) {
        const left = if (inner) { 1 } else { 2 }
        const right = switch (kind) {
          case "one": 10
          default: 20
        }
        left + right
      } else {
        0
      }
      return value
    }
  `);
  expect(plans.diagnostics).toEqual([]);
  expect([...plans.byHost.values()].map((plan) => plan.kind)).toEqual(["if", "if", "switch"]);
  expect(plans.recoveredKeywordStarts.size).toBe(3);
});

test("collects value control flow in methods and nested callable bodies", () => {
  const { plans } = collect(`
    class Choice {
      choose(active: boolean): number {
        return if (active) { 1 } else { 0 }
      }
    }
    const choose = (active: boolean): number => {
      const nested = () => {
        const value = if (active) { 2 } else { 3 }
        return value
      }
      return nested()
    }
  `);
  expect(plans.diagnostics).toEqual([]);
  expect(plans.byHost.size).toBe(2);
});

test("value control flow fails closed on incomplete normal exits", () => {
  const { plans } = collect(`
    function invalid(active: boolean, kind: string) {
      const missingElse = if (active) { 1 }
      const missingValue = if (active) { const value = 1 } else { 2 }
      return switch (kind) {
        case "known":
          1
      }
    }
  `);
  expect(plans.byHost.size).toBe(0);
  expect(plans.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
    "SMITHERS1705",
    "SMITHERS1705",
    "SMITHERS1705",
  ]);
  expect(plans.diagnostics.map((diagnostic) => diagnostic.message).join("\n")).toContain("else branch");
  expect(plans.diagnostics.map((diagnostic) => diagnostic.message).join("\n")).toContain("default clause");
});

test("ordinary statement control flow is never reclassified", () => {
  const { plans } = collect(`
    function ordinary(active: boolean): number {
      let value = 0
      if (active) value = 1
      switch (value) { case 1: value += 1; break }
      return value
    }
    function automaticSemicolon(active: boolean): void {
      return
      if (active) { 1 } else { 2 }
    }
  `);
  expect(plans.byHost.size).toBe(0);
  expect(plans.diagnostics).toEqual([]);
  expect(plans.recoveredKeywordStarts.size).toBe(0);
  expect(compileSmithers(`
    function automaticSemicolon(active: boolean): void {
      return
      if (active) { 1 } else { 2 }
    }
  `).analysis.diagnostics.filter((diagnostic) => diagnostic.code === "SMITHERS1702")).toEqual([]);
});

test("rejects jumps and fallthrough which can bypass an expression value", () => {
  const unsafe = collect(`
    function unsafe(kind: string, active: boolean): number {
      while (active) {
        const fromIf = if (active) { if (kind === "skip") continue; 1 } else { 2 }
        const fromSwitch = switch (kind) {
          case "break":
            if (active) break
            3
          default:
            4
        }
        return fromIf + fromSwitch
      }
      return 0
    }
    function fallthrough(kind: string): number {
      return switch (kind) {
        case "empty":
        case "value": 1
        default: 2
      }
    }
  `).plans;
  expect(unsafe.byHost.size).toBe(0);
  expect(unsafe.diagnostics.filter((diagnostic) => diagnostic.code === "SMITHERS1706"))
    .toHaveLength(2);
  expect(unsafe.diagnostics.filter((diagnostic) => diagnostic.code === "SMITHERS1705"))
    .toHaveLength(1);

  const contained = collect(`
    function contained(kind: string, active: boolean): number {
      return switch (kind) {
        case "one":
          while (active) { break }
          switch (kind) { case "one": break; default: break }
          1
        default:
          2
      }
    }
  `).plans;
  expect(contained.diagnostics).toEqual([]);
  expect(contained.byHost.size).toBe(1);
});

test("checked if and switch plans execute once and preserve outer Result exits", async () => {
  const source = `
    export const events: string[] = []
    class Missing extends Error {}
    function leaf(fail: boolean): Result<number, Missing> {
      events.push("leaf")
      if (fail) throw new Missing()
      return 2
    }
    export function selected(active: boolean, fail: boolean): Result<number, Missing> {
      const value = if (active) {
        events.push("then")
        leaf(fail).unwrap()
      } else {
        events.push("else")
        3
      }
      return value
    }
    export function switched(kind: string): number {
      const value = switch (tag("disc", kind)) {
        case tag("case-one", "one"):
          events.push("one")
          1
        case tag("case-two", "two"):
          events.push("two")
          2
        default:
          events.push("default")
          0
      }
      return value
    }
    function tag<T>(label: string, value: T): T {
      events.push(label)
      return value
    }
    function guard(fail: boolean): Result<boolean, Missing> {
      events.push("guard")
      if (fail) throw new Missing()
      return true
    }
    export function guarded(fail: boolean): Result<number, Missing> {
      return if (guard(fail).unwrap()) {
        events.push("guarded")
        10
      } else {
        0
      }
    }
    export function nested(outer: boolean, inner: boolean, kind: string): number {
      const value = if (outer) {
        const left = if (inner) {
          events.push("inner-then")
          1
        } else {
          events.push("inner-else")
          2
        }
        const right = switch (kind) {
          case "one":
            events.push("inner-switch-one")
            10
          default:
            events.push("inner-switch-default")
            20
        }
        left + right
      } else {
        events.push("outer-else")
        0
      }
      return value
    }
  `;
  const compiled = compileSmithers(source, {
    fileName: `${import.meta.dir}/control-execution.sm`,
    outputFileName: `${import.meta.dir}/control-execution.generated.ts`,
    sourceName: "control-execution.sm",
    runtimeImport: "../runtime/index.ts",
  });
  expect(compiled.analysis.diagnostics).toEqual([]);
  expect(checkEmittedTypeScript(compiled.code, `${import.meta.dir}/control-execution.generated.ts`)
    .filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error)).toEqual([]);
  expect(compiled.code).toContain("let __smithers_if_value_");
  expect(compiled.code).toContain("let __smithers_switch_value_");
  expect(compiled.code).toContain("return __vsResultFailure");

  const executable = compileSmithers(source, {
    fileName: `${import.meta.dir}/control-execution.sm`,
    outputFileName: `${import.meta.dir}/control-execution.generated.ts`,
    sourceName: "control-execution.sm",
    runtimeImport: pathToFileURL(`${import.meta.dir}/../runtime/index.ts`).href,
  });
  const javascript = new Bun.Transpiler({ loader: "ts", target: "bun" }).transformSync(executable.code);
  const directory = await mkdtemp(join(tmpdir(), "smithers-control-flow-"));
  try {
    const modulePath = join(directory, "control.mjs");
    await writeFile(modulePath, javascript);
    const module = await import(pathToFileURL(modulePath).href) as {
      events: string[];
      selected(active: boolean, fail: boolean): unknown;
      switched(kind: string): number;
      guarded(fail: boolean): unknown;
      nested(outer: boolean, inner: boolean, kind: string): number;
    };
    expect(__vsInspectResult(module.selected(true, false) as any)).toMatchObject({ ok: true, value: 2 });
    expect(module.events.splice(0)).toEqual(["then", "leaf"]);
    expect(__vsInspectResult(module.selected(false, true) as any)).toMatchObject({ ok: true, value: 3 });
    expect(module.events.splice(0)).toEqual(["else"]);
    expect(__vsInspectResult(module.selected(true, true) as any).ok).toBe(false);
    expect(module.events.splice(0)).toEqual(["then", "leaf"]);
    expect(module.switched("two")).toBe(2);
    expect(module.events.splice(0)).toEqual(["disc", "case-one", "case-two", "two"]);
    expect(module.switched("unknown")).toBe(0);
    expect(module.events.splice(0)).toEqual(["disc", "case-one", "case-two", "default"]);
    expect(__vsInspectResult(module.guarded(false) as any)).toMatchObject({ ok: true, value: 10 });
    expect(module.events.splice(0)).toEqual(["guard", "guarded"]);
    expect(__vsInspectResult(module.guarded(true) as any).ok).toBe(false);
    expect(module.events.splice(0)).toEqual(["guard"]);
    expect(module.nested(true, false, "one")).toBe(12);
    expect(module.events.splice(0)).toEqual(["inner-else", "inner-switch-one"]);
    expect(module.nested(false, true, "one")).toBe(0);
    expect(module.events.splice(0)).toEqual(["outer-else"]);
  } finally {
    await rm(directory, { recursive: true });
  }
});

test("raw Result/Promise branch values fail closed until ownership is in the shared IR", () => {
  const analysis = compileSmithers(`
    declare function result(): Result<number, Error>
    declare function task(): Promise<number>
    function resultValue(flag: boolean) { return if (flag) result() else result() }
    async function taskValue(flag: boolean) { return if (flag) task() else task() }
    function unsafeCase(value: number): Result<number, Error> {
      return switch (value) {
        case result().unwrap(): 1
        default: 0
      }
    }
  `).analysis;
  expect(analysis.diagnostics.filter((diagnostic) => diagnostic.code === "SMITHERS1706")).toHaveLength(5);
  expect(analysis.diagnostics.some((diagnostic) => diagnostic.code === "SMITHERS1706" &&
    diagnostic.message.includes("case labels"))).toBeTrue();
});

test("join temporaries preserve authored and inferred branch types", () => {
  const annotated = compileSmithers(`
    function mismatch(flag: boolean): number {
      const value: number = if (flag) { 1 } else { "wrong" }
      return value
    }
  `, {
    fileName: "/virtual/annotated-control.sm",
    outputFileName: "/virtual/annotated-control.ts",
  });
  expect(annotated.code).toContain(": number;");
  expect(checkEmittedTypeScript(annotated.code, "/virtual/annotated-control.ts")
    .filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error)
    .map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n")))
    .toEqual(["Type 'string' is not assignable to type 'number'."]);

  const inferred = compileSmithers(`
    function inferred(flag: boolean) {
      const value = if (flag) { 1 } else { "two" }
      return value
    }
  `, {
    fileName: "/virtual/inferred-control.sm",
    outputFileName: "/virtual/inferred-control.ts",
  });
  expect(inferred.code).toMatch(/let __smithers_if_value_\d+: 1 \| "two";/);
  expect(checkEmittedTypeScript(inferred.code, "/virtual/inferred-control.ts")
    .filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error)).toEqual([]);
});

test("branch-local nominal types fail closed instead of leaking into a generated join", () => {
  const compiled = compileSmithers(`
    function local(flag: boolean) {
      const value = if (flag) {
        class Left { readonly side = "left" }
        new Left()
      } else {
        class Right { readonly side = "right" }
        new Right()
      }
      return value
    }
  `, {
    fileName: "/virtual/local-control.sm",
    outputFileName: "/virtual/local-control.ts",
  });
  expect(compiled.analysis.diagnostics.filter((diagnostic) => diagnostic.code === "SMITHERS1706" &&
    diagnostic.message.includes("type declared inside"))).toHaveLength(2);
  expect(compiled.code).toMatch(/let __smithers_if_value_\d+: unknown;/);
  expect(checkEmittedTypeScript(compiled.code, "/virtual/local-control.ts")
    .filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error)).toEqual([]);
});

test("switch clauses are colon-delimited and there is no arrow-arm switch grammar", () => {
  const codes = (source: string) =>
    compileSmithers(source).analysis.diagnostics.map((entry) => `${entry.code}@${entry.line}:${entry.column}`);

  // control-flow.mdx, "Switch": switch syntax MUST use the same `switch`,
  // `case`, `default`, and colon-delimited clauses as TypeScript, and Smithers
  // MUST NOT introduce a separate arrow-arm switch grammar. TypeScript's parser
  // recovers `default => v` by discarding the arrow, so nothing survives in the
  // tree; the clause itself has to be re-read to hold the MUST NOT.
  expect(codes(`export function main(): string[] {
  const kind: string = "zzz"
  const label = switch (kind) {
    default => "other"
  }
  return [label]
}`)).toEqual(["SMITHERS1000@4:13"]);

  // The two clause grammars must not compose inside one switch either, which is
  // what separates a second grammar from lenient error recovery.
  expect(codes(`export function main(): string[] {
  const kind: string = "a"
  const label = switch (kind) {
    case "a" => "alpha"
    default: "other"
  }
  return [label]
}`)).toEqual(["SMITHERS1000@4:14"]);

  // Statement position is the same grammar: rejected at the arrow, exactly once
  // rather than once from the clause and again from the parser's own message.
  expect(codes(`export function main(): string[] {
  const kind: string = "zzz"
  let out = "none"
  switch (kind) {
    default => out = "other"
  }
  return [out]
}`)).toEqual(["SMITHERS1000@5:13"]);

  // A clause with no separator at all is the same defect. It used to depend on
  // DISTANCE: the parser's own "':' expected" is suppressed within 48
  // characters of a recovered `switch` expression host, so this first clause
  // compiled and lowered with an invented colon while the identical shape one
  // clause further down was rejected. Both positions now report.
  expect(codes(`export function main(): string[] {
  const kind: string = "a"
  const label = switch (kind) {
    case "a" "alpha"
    default: "other"
  }
  return [label]
}`)).toEqual(["SMITHERS1000@4:14"]);

  // Over-rejection is its own bug. The required colon form still compiles, an
  // arrow FUNCTION inside a clause value is ordinary code, an arrow inside a
  // comment is not a clause separator, and a case label that contains its own
  // colon still ends at the clause colon.
  expect(codes(`export function main(): string[] {
  const kind: string = "a"
  const flag = true
  const label = switch (kind) {
    case "a": (() => "alpha")()
    case "b" /* => */: "beta"
    case flag ? "c" : "d": "gamma"
    case "e" as string: "epsilon"
    default: "other"
  }
  return [label]
}`)).toEqual([]);
});
