import { expect, test } from "bun:test";
import { deriveDurableValueSchema } from "../durable/schema.ts";
import { EffectSiteIds, effectSiteId } from "../durable/site-id.ts";
import { buildSemanticModel, buildSemanticProjectModels, identityFileName } from "./semantic.ts";

/**
 * `SemanticModel.capabilitySites` / `.effectSites` / `.journaledRequirements`
 * are published for the effect lowering and consumed by NOTHING. These tests
 * pin both halves of that: the facts are real, and publishing them changed no
 * observable.
 */

const model = (source: string, fileName = "effects.sm") => buildSemanticModel(source, { fileName });

const SERVICE_CAPABILITY = `
import { Context } from "smthrs/context"

abstract class Reader extends Context {
  abstract read(key: string): string
}

class Missing extends Error {}

function lookup(key: string): Result<string, Missing> {
  return key
}

export function run(key: string): Result<string, Missing> {
  const found = lookup(key)!
  return Reader.context().read(found)
}
`;

test("a capability read is published with the call node the analysis used to answer", () => {
  // The gap this closes: `contextRequirement` is handed the CallExpression and
  // answers about it, and `collectFacts` kept only the name. The node — the
  // thing a `get` lowering has to rewrite — was computed and thrown away on
  // every compile since the rule was written.
  const built = model(SERVICE_CAPABILITY);
  expect(built.diagnostics).toEqual([]);

  const sites = [...built.capabilitySites.values()];
  expect(sites).toHaveLength(1);
  expect(sites[0]!.name).toBe("Reader");
  expect(sites[0]!.receiver).toEqual({ kind: "capability", name: "Reader" });
  expect(sites[0]!.call.getText()).toBe("Reader.context()");
  // The map is keyed BY that node, so a lowering can ask "is this call a
  // capability read" without re-running the classification.
  expect(built.capabilitySites.get(sites[0]!.call)).toBe(sites[0]!);
});

test("an ambiguous receiver is recorded as ambiguous rather than dropped, and does not crash the compile", () => {
  // This is the case that caught a real defect while this step was being
  // built. The site identity is digested through `canonicalJson`, which
  // refuses `undefined` outright, so recording the absent capability key as a
  // present-but-undefined field turned SMITHERS2106 — a diagnostic the corpus
  // pins — into a TypeError out of the digest, i.e. a compiler crash on a
  // program that must merely be refused. The identity now OMITS the key.
  const built = model(`
import { Context } from "smthrs/context"

abstract class Left extends Context { abstract read(): string }
abstract class Right extends Context { abstract read(): string }

export function run(flag: boolean): string {
  const which = flag ? Left : Right
  return which.context().read()
}
`);
  expect(built.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(["SMITHERS2106"]);

  const sites = [...built.capabilitySites.values()];
  expect(sites).toHaveLength(1);
  expect(sites[0]!.receiver).toEqual({ kind: "ambiguous" });
  expect(sites[0]!.name).toBeUndefined();
  // A site table that omitted the refused form would be a table that disagrees
  // with the diagnostic, so the site is present and carries an id.
  expect(built.effectSites.get(sites[0]!.call)).toMatch(/^src-[0-9a-f]{24}$/);
});

test("every capability read and every postfix ! gets a content-addressed site id", () => {
  const built = model(SERVICE_CAPABILITY);
  const ids = [...built.effectSites.values()];
  expect(ids).toHaveLength(2);
  expect(new Set(ids).size).toBe(2);
  for (const id of ids) expect(id).toMatch(/^src-[0-9a-f]{24}$/);

  const texts = [...built.effectSites.keys()].map((node) => node.getText()).sort();
  expect(texts).toEqual(["Reader.context()", "lookup(key)!"]);
});

test("site ids are stable across recompilation and separate a `get` from an `abort` at the same position", () => {
  expect([...model(SERVICE_CAPABILITY).effectSites.values()])
    .toEqual([...model(SERVICE_CAPABILITY).effectSites.values()]);

  // The request kind participates in the identity, so two request kinds that
  // could ever anchor at one position cannot share a journal key.
  const identity = { file: "effects.sm", functionName: "run", anchor: "8:9" } as const;
  expect(effectSiteId({ ...identity, kind: "get" }, 0))
    .not.toBe(effectSiteId({ ...identity, kind: "abort" }, 0));
  expect(effectSiteId({ ...identity, kind: "get" }, 0))
    .not.toBe(effectSiteId({ ...identity, kind: "get" }, 1));
});

test("a site id collision is refused rather than reused", () => {
  // A silently reused journal key is worse than a hard stop; the Plan lowerer
  // raises SMITHERS4199 on the same condition. `assign` cannot be made to
  // collide through the occurrence counter, so the refusal is pinned on the
  // class's own invariant instead.
  const ids = new EffectSiteIds();
  const identity = { file: "effects.sm", functionName: "run", kind: "get", anchor: "1:1" } as const;
  const first = ids.assign(identity);
  const second = ids.assign(identity);
  expect(second).not.toBe(first);
});

test("journaledRequirements is empty for a service capability, and empty for a data-only one too", () => {
  // `specification/effects.mdx` §The Journaling Classifier: a Clock is not
  // journaled because it answers with a service. The implementation is
  // blunter than the spec's reason, and the difference matters to anyone
  // reading this field: the codec predicate refuses EVERY class instance,
  // so a capability that is plain data is also unjournaled.
  expect([...model(SERVICE_CAPABILITY).journaledRequirements]).toEqual([]);

  const dataOnly = model(`
import { Context } from "smthrs/context"

abstract class Settings extends Context {
  abstract readonly retries: number
}

export function run(): number {
  return Settings.context().retries
}
`);
  expect([...dataOnly.capabilitySites.values()].map((site) => site.name)).toEqual(["Settings"]);
  expect([...dataOnly.journaledRequirements]).toEqual([]);
});

test("the journaling classifier is live wiring, not a stub that always answers no", () => {
  // The previous test would pass against `return false`. This one would not:
  // it drives the SAME predicate the field is built from with a type the codec
  // contract accepts, and requires a yes.
  const built = model(`
export function run(): { readonly retries: number } {
  return { retries: 3 }
}
`);
  const [fn] = built.publicFunctions;
  expect(fn?.name).toBe("run");

  const declaration = built.sourceFile.statements.find((statement) =>
    statement.getText().startsWith("export function run")
  )!;
  const returned = built.checker.getSignatureFromDeclaration(declaration as never)!.getReturnType();
  const schema = deriveDurableValueSchema(
    built.checker,
    built.sourceFile,
    declaration,
    returned,
    "success",
    "capability answer",
  );
  expect(schema.descriptor.kind).toBe("object");
});

test("publishing the three facts moved no row, no diagnostic, and no public declaration", () => {
  // Inertness, stated as an assertion rather than as a claim in a commit
  // message. Nothing in the compiler reads the new fields; the observable
  // surface of this program is exactly what it was before they existed.
  const built = model(SERVICE_CAPABILITY);
  expect(built.diagnostics).toEqual([]);
  expect(built.rows).toEqual({
    lookup: { failures: ["Missing"], requirements: [] },
    run: { failures: ["Missing"], requirements: ["Reader"] },
  });
  expect(built.publicFunctions.map((fn) => fn.name).sort()).toEqual(["lookup", "run"]);
  // And the facts themselves are non-empty, so the assertion above is not
  // vacuously satisfied by a pass that never ran.
  expect(built.capabilitySites.size).toBe(1);
  expect(built.effectSites.size).toBe(2);
});

/**
 * The gap these close: "stable across recompilation" above is satisfied by an
 * id that embeds the absolute path of the checkout, because both compilations
 * in one test run happen in one checkout. `collectEffectFacts` was handed
 * `entry.absoluteName`, so every id carried `/Users/<someone>/...` and no two
 * machines — or CI and a laptop — could agree on one. A journal key that is a
 * function of where the repo was cloned is not a key.
 */
const projectSiteIds = (rootDir: string, fileName = "flows/effects.sm"): readonly string[] => {
  const project = buildSemanticProjectModels([{ fileName, source: SERVICE_CAPABILITY }], { rootDir });
  expect(project.analysis.diagnostics).toEqual([]);
  return [...project.models.get(fileName)!.effectSites.values()].sort();
};

test("effect site ids are byte-identical across two checkout paths", () => {
  const fromLaptop = projectSiteIds("/tmp/checkout-a");
  const fromCi = projectSiteIds("/home/ci/some/deeper/checkout-b");
  expect(fromLaptop).toHaveLength(2);
  expect(fromCi).toEqual(fromLaptop);
});

test("a project source named by absolute path mints the same ids as its root-relative spelling", () => {
  // The caller's spelling is an addressing key, not an identity: `files` and
  // every diagnostic stay keyed by whatever was supplied, while the id is
  // derived. Both spellings name the same file, so both must answer alike.
  expect(projectSiteIds("/tmp/checkout-a", "/tmp/checkout-a/flows/effects.sm"))
    .toEqual(projectSiteIds("/tmp/checkout-a", "flows/effects.sm"));
});

test("a single-file model anchors ids on the caller's name, not on the resolved absolute path", () => {
  // `buildSemanticModel` resolved its name against `process.cwd()` and appended
  // `.ts` for the checker, then used THAT as the identity, so a single-file id
  // moved with the working directory as well as with the checkout.
  const relativeName = [...model(SERVICE_CAPABILITY, "effects.sm").effectSites.values()].sort();
  const absoluteName = [...model(SERVICE_CAPABILITY, "/elsewhere/entirely/effects.sm").effectSites.values()].sort();
  expect(relativeName).toHaveLength(2);
  expect(absoluteName).toEqual(relativeName);
});

test("identityFileName is the one spelling, and it never yields an absolute path", () => {
  expect(identityFileName("flows/effects.sm", "/tmp/checkout-a")).toBe("flows/effects.sm");
  expect(identityFileName("/tmp/checkout-a/flows/effects.sm", "/tmp/checkout-a")).toBe("flows/effects.sm");
  // `./a.sm` and `a.sm` name one file and must not mint two identities.
  expect(identityFileName("./flows/effects.sm")).toBe("flows/effects.sm");
  // No root to be relative to: a single-file analysis has exactly one file.
  expect(identityFileName("/elsewhere/entirely/effects.sm")).toBe("effects.sm");
});
