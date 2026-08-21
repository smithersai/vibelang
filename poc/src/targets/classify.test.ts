import { describe, expect, test } from "bun:test";
import { analyzeCompatibility } from "./index.ts";

describe("TypeScript/native portability requirements", () => {
  test("type-only imports erase while runtime boundaries propagate", () => {
    const result = analyzeCompatibility(`
      import type { User } from "./legacy-types";
      import { readFileSync } from "node:fs";
      function boundary(): any { return readFileSync("x") as any }
      function middle() { return boundary() }
      /** @native */
      function pinned() { return middle() }
    `);
    expect(result.functions.boundary.requirements).toEqual(['Module<"node:fs">', "TypeScript"]);
    expect(result.functions.middle.requirementPaths.TypeScript).toEqual(["middle", "boundary"]);
    expect(result.functions.pinned.requirementPaths.TypeScript).toEqual(["pinned", "middle", "boundary"]);
    expect(result.diagnostics.find((diagnostic) => diagnostic.code === "VIBE3001")?.message)
      .toContain("pinned -> middle -> boundary");
  });

  test("eval is allowed but visible and open dynamic features warn", () => {
    const result = analyzeCompatibility(`
      function dynamic(source: string) { const proxy = new Proxy({}, {}); return eval(source) }
    `);
    expect(result.functions.dynamic.requirements).toContain("TypeScript");
    expect(result.diagnostics.some((diagnostic) => diagnostic.code === "VIBE3002")).toBe(true);
  });

  test("any in a public shape is visible even without an assertion in the body", () => {
    const result = analyzeCompatibility("function unsafe(input: any): string { return String(input) }");
    expect(result.functions.unsafe.requirements).toContain("TypeScript");
  });

  test("classifies constructor-style Function and side-effect runtime imports", () => {
    const dynamic = analyzeCompatibility(`
      /** @native */
      function pinned() { return new Function("return 1")() }
    `);
    expect(dynamic.functions.pinned.requirements).toContain("TypeScript");
    expect(dynamic.diagnostics.some((diagnostic) => diagnostic.code === "VIBE3001")).toBe(true);

    const sideEffect = analyzeCompatibility(`
      import "./legacy-runtime";
      /** @native */
      function pinned() { return 1 }
    `);
    expect(sideEffect.functions.pinned.requirements).toContain("TypeScript");
    expect(sideEffect.diagnostics.some((diagnostic) => diagnostic.code === "VIBE3001")).toBe(true);
  });

  test("does not classify shadowed bindings or property names as ambient requirements", () => {
    const result = analyzeCompatibility(`
      import { read } from "node:fs";
      function safe(read: number, value: { process: string; Proxy: string }) {
        const window = "local";
        return read + value.process.length + value.Proxy.length + window.length;
      }
      function boundary() { return read("x") }
    `);
    expect(result.functions.safe.requirements).toEqual([]);
    expect(result.functions.boundary.requirements).toEqual(['Module<"node:fs">']);
    expect(result.diagnostics.some((diagnostic) => diagnostic.code === "VIBE3002")).toBe(false);
  });
});
