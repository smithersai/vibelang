import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import * as ts from "typescript-js";
import { compileSmithers } from "./compile.ts";
import { analyzeSource } from "./analyze.ts";
import { checkEmittedTypeScript } from "./validate.ts";
import { __vsInspectResult } from "../runtime/index.ts";

test("closed-union switch expressions accept proven exhaustiveness without a default", async () => {
  const source = `
    export const events: string[] = []
    class Missing extends Error {}
    function leaf(fail: boolean): Result<number, Missing> {
      if (fail) throw new Missing()
      return 7
    }
    type Kind = "loading" | "ready" | "failed"
    export function describe(kind: Kind): string {
      const message = switch (kind) {
        case "loading":
          "spinner"
        case "ready":
          "content"
        case "failed":
          "error"
      }
      return message
    }
    export function viaReturn(kind: Kind): number {
      return switch (kind) {
        case "loading": 1
        case "ready": 2
        case "failed": 3
      }
    }
    export function booleanScrutinee(active: boolean): string {
      return switch (active) {
        case true: "on"
        case false: "off"
      }
    }
    export function resultOwner(kind: "a" | "b", fail: boolean): Result<number, Missing> {
      return switch (kind) {
        case "a": leaf(fail).unwrap()
        case "b": 0
      }
    }
    export function inCall(kind: "x" | "y"): number {
      return double(switch (kind) { case "x": 10; case "y": 20 })
    }
    function double(value: number): number { return value * 2 }
  `;
  const compiled = compileSmithers(source, {
    fileName: `${import.meta.dir}/switch-exhaustive.sm`,
    outputFileName: `${import.meta.dir}/switch-exhaustive.generated.ts`,
    sourceName: "switch-exhaustive.sm",
    runtimeImport: "../runtime/index.ts",
  });
  expect(compiled.analysis.diagnostics).toEqual([]);
  expect(checkEmittedTypeScript(compiled.code, `${import.meta.dir}/switch-exhaustive.generated.ts`)
    .filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error)
    .map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"))).toEqual([]);

  const executable = compileSmithers(source, {
    fileName: `${import.meta.dir}/switch-exhaustive.sm`,
    outputFileName: `${import.meta.dir}/switch-exhaustive.generated.ts`,
    sourceName: "switch-exhaustive.sm",
    runtimeImport: pathToFileURL(`${import.meta.dir}/../runtime/index.ts`).href,
  });
  const javascript = new Bun.Transpiler({ loader: "ts", target: "bun" }).transformSync(executable.code);
  const directory = await mkdtemp(join(tmpdir(), "smithers-switch-exhaustive-"));
  try {
    const modulePath = join(directory, "switch.mjs");
    await writeFile(modulePath, javascript);
    const module = await import(pathToFileURL(modulePath).href) as Record<string, any>;
    expect(module.describe("loading")).toBe("spinner");
    expect(module.describe("ready")).toBe("content");
    expect(module.describe("failed")).toBe("error");
    expect(module.viaReturn("ready")).toBe(2);
    expect(module.booleanScrutinee(true)).toBe("on");
    expect(module.booleanScrutinee(false)).toBe("off");
    expect(__vsInspectResult(module.resultOwner("a", false))).toMatchObject({ ok: true, value: 7 });
    expect(__vsInspectResult(module.resultOwner("a", true)).ok).toBe(false);
    expect(__vsInspectResult(module.resultOwner("b", false))).toMatchObject({ ok: true, value: 0 });
    expect(module.inCall("y")).toBe(40);
  } finally {
    await rm(directory, { recursive: true });
  }
});

test("non-exhaustive closed-union switch expressions fail closed", () => {
  const missing = analyzeSource(`
    type Kind = "loading" | "ready" | "failed"
    function f(kind: Kind): string {
      return switch (kind) {
        case "loading": "spinner"
        case "ready": "content"
      }
    }
  `);
  const exhaustiveness = missing.diagnostics.filter((diagnostic) => diagnostic.code === "SMITHERS1716");
  expect(exhaustiveness).toHaveLength(1);
  expect(exhaustiveness[0]!.message).toContain('"failed"');

  // Non-literal case labels keep exhaustiveness unprovable.
  const unprovable = analyzeSource(`
    declare const dynamic: string
    function f(kind: "a" | "b"): number {
      return switch (kind) {
        case dynamic: 1
        case "b": 2
      }
    }
  `);
  expect(unprovable.diagnostics.some((diagnostic) => diagnostic.code === "SMITHERS1716" &&
    diagnostic.message.includes("non-literal"))).toBe(true);

  // Open scrutinee types keep the existing default requirement.
  const open = analyzeSource(`
    function f(value: number): string {
      return switch (value) {
        case 1: "one"
        case 2: "two"
      }
    }
  `);
  expect(open.diagnostics.some((diagnostic) => diagnostic.code === "SMITHERS1705" &&
    diagnostic.message.includes("default"))).toBe(true);

  // A default clause remains sufficient for any scrutinee.
  const defaulted = analyzeSource(`
    function f(value: number): string {
      return switch (value) {
        case 1: "one"
        default: "many"
      }
    }
  `);
  expect(defaulted.diagnostics).toEqual([]);
});
