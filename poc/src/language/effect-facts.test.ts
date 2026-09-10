import { expect, test } from "bun:test";
import { EffectSiteIds, effectSiteId, identityFileName } from "../durable/site-id.ts";
import { compileDurableBody } from "../durable/body-compiler.ts";
import { analyzeSource } from "./analyze.ts";
import { compileVibeLang } from "./compile.ts";
import { compileProject } from "./project-compile.ts";

/**
 * Public observations of the native effect analysis and two emission profiles.
 * The retired JS SemanticModel's unused fact tables were not a public contract.
 * Actual AST-node classification, ambiguous-site identity, codec predicates and
 * collision refusal now have Go coverage in TestPinnedForkInternalInvariants.
 */
const SERVICE_CAPABILITY = [
  'import { Context } from "vibelang/context"',
  "abstract class Reader extends Context { abstract read(key: string): string }",
  "class Missing extends Error {}",
  "function lookup(key: string): Result<string, Missing> { return key }",
  "export function run(key: string): Result<string, Missing> {",
  "  const found = lookup(key)!",
  "  return Reader.context().read(found)",
  "}",
].join("\n");

function compiled(fileName = "effects.vibe") {
  const output = compileVibeLang(SERVICE_CAPABILITY, { fileName, sourceMap: false });
  expect(output.analysis.diagnostics).toEqual([]);
  return output;
}

function emittedIds(code: string): readonly string[] {
  const ids = [...code.matchAll(/\bsrc-[0-9a-f]{24}\b/g)].map(match => match[0]);
  expect(ids).toHaveLength(1);
  return ids;
}

test("the native analyzer preserves the service capability's nominal row and declarations", () => {
  const built = analyzeSource(SERVICE_CAPABILITY, { fileName: "effects.vibe" });
  expect(built.diagnostics).toEqual([]);
  expect(built.rows).toEqual({
    lookup: { failures: ["Missing"], requirements: [] },
    run: { failures: ["Missing"], requirements: ["Reader"] },
  });
  expect(built.functions.map(fn => fn.name).sort()).toEqual(["lookup", "run"]);
});

test("an ambiguous receiver is refused by native analysis rather than dropped or crashed", () => {
  const source = [
    'import { Context } from "vibelang/context"',
    "abstract class Left extends Context { abstract read(): string }",
    "abstract class Right extends Context { abstract read(): string }",
    "export function run(flag: boolean): string {",
    "  const which = flag ? Left : Right",
    "  return which.context().read()",
    "}",
  ].join("\n");
  const result = analyzeSource(source, { fileName: "effects.vibe" });
  expect(result.diagnostics.map(issue => issue.code)).toEqual(["VIBE2106"]);
  expect(result.diagnostics[0]!.line).toBe(6);
});

test("SDK propagation gets a content-addressed site while ordinary context calls stay eager", () => {
  const output = compiled();
  expect(output.code).toContain("Reader.context()");
  expect(emittedIds(output.code)[0]).toMatch(/^src-[0-9a-f]{24}$/);
});

test("native emitted propagation sites are stable across recompilation", () => {
  expect(emittedIds(compiled().code)).toEqual(emittedIds(compiled().code));
});

test("request kind and static occurrence both discriminate the shared identity format", () => {
  const identity = { file: "effects.vibe", functionName: "run", anchor: "8:9" } as const;
  expect(effectSiteId({ ...identity, kind: "get" }, 0))
    .not.toBe(effectSiteId({ ...identity, kind: "abort" }, 0));
  expect(effectSiteId({ ...identity, kind: "get" }, 0))
    .not.toBe(effectSiteId({ ...identity, kind: "get" }, 1));
});

test("the data-only site allocator never reuses one static occurrence", () => {
  const ids = new EffectSiteIds();
  const identity = { file: "effects.vibe", functionName: "run", kind: "get", anchor: "1:1" } as const;
  expect(ids.assign(identity)).not.toBe(ids.assign(identity));
  // The real native collision-refusal branch is forced in
  // TestNativeInvariantEffectSiteIdentity, not inferred from this acceptance.
});

test("a data-only capability is still a nominal requirement", () => {
  const result = analyzeSource([
    'import { Context } from "vibelang/context"',
    "abstract class Settings extends Context { abstract readonly retries: number }",
    "export function run(): number { return Settings.context().retries }",
  ].join("\n"), { fileName: "settings.vibe" });
  expect(result.diagnostics).toEqual([]);
  expect(result.rows.run).toEqual({ failures: [], requirements: ["Settings"] });
});

test("the executable-body profile publishes the actual native Get site", () => {
  const source = [
    'import { durable } from "vibelang:flows"',
    'import { Context } from "vibelang/context"',
    'import { Layer } from "vibelang/provider"',
    "abstract class Settings extends Context { abstract readonly retries: number }",
    "export const Flow = durable((input: number) =>",
    "  Layer.provide(Layer.succeed(Settings, { retries: 3 }), () => Settings.context().retries + input))",
  ].join("\n");
  const result = compileDurableBody(source, { fileName: "effects.vibe" });
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  expect(result.body.manifest.sites).toHaveLength(1);
  expect(result.body.manifest.sites[0]).toMatchObject({ kind: "get", key: "effects.vibe#Settings" });
  expect(result.body.manifest.sites[0]!.id).toMatch(/^src-[0-9a-f]{24}$/);
  expect(result.body.manifest.actions).toEqual([]);
});

function projectSiteIds(rootDir: string, fileName = "flows/effects.vibe"): readonly string[] {
  const result = compileProject([{ fileName, source: SERVICE_CAPABILITY }], {
    rootDir, outDir: rootDir + "/output", sourceMap: false,
  });
  expect(result.diagnostics).toEqual([]);
  expect(Object.keys(result.files)).toEqual([fileName]);
  return emittedIds(result.files[fileName]!.code);
}

test("native effect site ids are byte-identical across checkout paths", () => {
  expect(projectSiteIds("/tmp/checkout-a")).toEqual(projectSiteIds("/home/ci/some/deeper/checkout-b"));
});

test("absolute and root-relative project addressing mint the same native site ids", () => {
  expect(projectSiteIds("/tmp/checkout-a", "/tmp/checkout-a/flows/effects.vibe"))
    .toEqual(projectSiteIds("/tmp/checkout-a", "flows/effects.vibe"));
});

test("single-file native lowering does not put a checkout path into site identities", () => {
  expect(emittedIds(compiled("effects.vibe").code))
    .toEqual(emittedIds(compiled("/elsewhere/entirely/effects.vibe").code));
});

test("host identity normalization is portable and keeps addressing separate", () => {
  expect(identityFileName("flows/effects.vibe", "/tmp/checkout-a")).toBe("flows/effects.vibe");
  expect(identityFileName("/tmp/checkout-a/flows/effects.vibe", "/tmp/checkout-a")).toBe("flows/effects.vibe");
  expect(identityFileName("./flows/effects.vibe")).toBe("flows/effects.vibe");
  expect(identityFileName("/elsewhere/entirely/effects.vibe")).toBe("effects.vibe");
});
