import { beforeAll, expect, test } from "bun:test";
import { getNativeCompiler } from "../compiler/native.ts";
import { analyzeSource } from "./analyze.ts";

// Preparing a source-checkout compiler is setup, not one of the diagnostic
// matrix's language operations. Installed packages do not need that build.
beforeAll(() => { getNativeCompiler(); }, 60_000);

const HEAD = `class Missing extends Error {}
function read(): Result<number, Missing> { throw new Missing() }
`;

test("the separate schema runtime does not expose private Result or continuation hooks", () => {
  for (const binding of ["__vsSchema", "__vsResultSuccess", "__vsRunResult", "__vsPropagate"]) {
    for (const specifier of ["vibelang/schema-runtime", "vibelang/context"]) {
      for (const source of [
        `import { ${binding} as local } from "${specifier}"; export const factory = local`,
        `import * as ns from "${specifier}"; export const factory = ns.${binding}`,
        `import * as ns from "${specifier}"; export const factory = ns["${binding}"]`,
        `export { ${binding} as local } from "${specifier}"`,
      ]) {
        const privateHookRefused = analyzeSource(source).diagnostics.some(d => d.code === "VIBE1201");
        expect(privateHookRefused).toBe(!(specifier === "vibelang/schema-runtime" && binding === "__vsSchema"));
      }
    }
  }
});

test("observers cannot silently discard their callback's Result channel", () => {
  const bodies = [
    `read().tap((): Result<number, Missing> => read()).unwrapOr(0)`,
    `read().tapError((): Result<number, Missing> => read()).unwrapOr(0)`,
    `read().tapBoth({ok: (): Result<number, Missing> => read(), error: () => 0}).unwrapOr(0)`,
    `(await read().tapAsync(async (): Promise<Result<number, Missing>> => read())).unwrapOr(0)`,
    `(await read().tapBothAsync({ok: async (): Promise<Result<number, Missing>> => read(), error: async () => 0})).unwrapOr(0)`,
  ];
  for (const body of bodies) {
    const analysis = analyzeSource(`${HEAD}async function main(): Promise<void> { ${body} }`);
    expect(analysis.diagnostics.map(d => d.code)).toContain("VIBE1303");
  }
});

test("synchronous observers do not own async callbacks hidden in handler objects", () => {
  const analysis = analyzeSource(`${HEAD}
function main(): number {
  return read().tapBoth({ok: async () => {}, error: () => {}}).unwrapOr(0)
}`);
  expect(analysis.diagnostics.map(d => d.code)).toContain("VIBE1404");
});

test("an observer's Result obligation survives a callback type boundary", () => {
  for (const shape of ["() => Result<number, Missing>", "() => Promise<Result<number, Missing>>"]) {
    const source = `${HEAD}
      async function work(observe: ${shape}): Promise<number> {
        return (await read().tapAsync(observe)).unwrapOr(0)
      }`;
    expect(analyzeSource(source).diagnostics.map(d => d.code)).toContain("VIBE1303");
  }
});

test("Promise-returning observers need ownership even without an async keyword", () => {
  for (const source of [
    `${HEAD}function work(observe: () => Promise<void>): number { return read().tap(observe).unwrapOr(0) }`,
    `${HEAD}function observe(): Promise<void> { return Promise.resolve() }
      function work(): number { return read().tap(observe).unwrapOr(0) }`,
  ]) {
    expect(analyzeSource(source).diagnostics.map(d => d.code)).toContain("VIBE1404");
  }
});

test("async observers own awaited branches but their resulting Result still must be consumed", () => {
  const positive = analyzeSource(`${HEAD}
async function main(): Promise<number> {
  const observed = await read().tapBothAsync({ok: async () => {}, error: async () => {}})
  return observed.unwrapOr(0)
}`);
  expect(positive.diagnostics).toEqual([]);
  const negative = analyzeSource(`${HEAD}
async function main(): Promise<void> {
  await read().tapBothAsync({ok: async () => {}, error: async () => {}})
}`);
  expect(negative.diagnostics.map(d => d.code)).toContain("VIBE1301");
});

test("only a compiler-produced Result codec can consume a Result encoder input", () => {
  const analysis = analyzeSource(`${HEAD}
const unrelated = { encode: (value: unknown): string => "ignored" }
export function main(): string { return unrelated.encode(read()) }
`);
  expect(analysis.diagnostics.map(d => d.code)).toContain("VIBE1301");
});
