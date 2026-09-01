import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const packagePath = require.resolve("smthrs/package.json");
const packageMetadata = JSON.parse(readFileSync(packagePath, "utf8"));
const isBun = typeof globalThis.Bun === "object";
const loaded = new Map();

/**
 * Subpaths that only a Bun runtime can evaluate. Each names a module whose body
 * touches a Bun-only global, so Node must fail closed on it rather than expose a
 * half-initialized namespace. The platform-neutral half of each subsystem lives
 * on its own subpath (`smthrs/agent`, `smthrs/durable`, and
 * `smthrs/concurrency`).
 */
const bunOnlyExports = new Map([
  ["./agent/bun", {
    reason: "SQLite agent journal and durable Flow tools",
    recognize: (error) =>
      error?.code === "ERR_UNSUPPORTED_ESM_URL_SCHEME" || /bun:sqlite|URL scheme/i.test(String(error)),
  }],
  ["./durable/bun", {
    reason: "durable executor",
    recognize: (error) =>
      error?.code === "ERR_UNSUPPORTED_ESM_URL_SCHEME" || /bun:sqlite|URL scheme/i.test(String(error)),
  }],
  ["./concurrency/bun", {
    reason: "typed worker host",
    recognize: (error) => error instanceof ReferenceError && /\bBun\b/.test(String(error)),
  }],
]);

for (const exportName of Object.keys(packageMetadata.exports).sort()) {
  const specifier = exportName === "." ? "smthrs" : `smthrs${exportName.slice(1)}`;
  if (exportName === "./package.json") {
    assert.equal(require(specifier).name, "smthrs");
    continue;
  }
  if (bunOnlyExports.has(exportName) && !isBun) {
    const { reason, recognize } = bunOnlyExports.get(exportName);
    let rejected = false;
    try {
      await import(specifier);
    } catch (error) {
      rejected = recognize(error);
    }
    assert.equal(rejected, true, `Node must reject the explicitly Bun-only ${reason}`);
    continue;
  }
  const namespace = await import(specifier);
  assert.equal(typeof namespace, "object", `${specifier} did not produce a module namespace`);
  loaded.set(exportName, namespace);
}

const runtime = loaded.get("./runtime");
const resultFacade = loaded.get("./result");
assert.equal(runtime.Result, resultFacade.Result);

// The specification withdrew `Optional<T>` and the portability pin on
// 2026-08-23. Absence is an ordinary `T | undefined` union and there is no
// second compilation target, so neither subpath may reach a consumer. This is
// the only gate that installs a real tarball, so it is the only place the
// withdrawal can be checked as a shipped fact rather than a source diff.
for (const withdrawn of ["./optional", "./targets"]) {
  assert.equal(loaded.has(withdrawn), false, `${withdrawn} is withdrawn but still exported`);
}
for (const withdrawn of ["Optional", "encodeOptional", "decodeOptional", "__vsOptionalSome"]) {
  assert.equal(withdrawn in runtime, false, `runtime still exports withdrawn ${withdrawn}`);
}

const stringCodec = Object.freeze({
  encode(value) {
    assert.equal(typeof value, "string");
    return value;
  },
  decode(value) {
    if (typeof value !== "string") throw new TypeError("expected string");
    return value;
  },
});
const resultWire = runtime.encodeResult(runtime.__vsResultSuccess("wire-ok"), stringCodec);
assert.equal(runtime.decodeResult(resultWire, stringCodec).match({ ok: (value) => value, error: () => "error" }), "wire-ok");
// Absence crosses the wire as the ordinary union it now is: a present value
// round-trips, and `undefined` stays `undefined` without a container.
const presentWire = runtime.encodeResult(runtime.__vsResultSuccess("present"), stringCodec);
assert.equal(runtime.decodeResult(presentWire, stringCodec).match({ ok: (value) => value, error: () => "error" }), "present");
assert.equal(undefined ?? "absent", "absent");

const language = loaded.get("./language");
const projectRoot = join(process.cwd(), "virtual-project");
const project = language.compileProject([
  {
    fileName: "service.sm",
    source: [
      "export class Missing extends Error {}",
      "export function load(valid: boolean): Result<string, Missing> {",
      "  if (!valid) throw new Missing(\"missing\")",
      "  return \"release\"",
      "}",
    ].join("\n"),
  },
  {
    fileName: "main.sm",
    source: [
      'import { load, type Missing } from "./service.sm"',
      "export function run(): Result<string, Missing> { return load(true)! }",
    ].join("\n"),
  },
], {
  rootDir: projectRoot,
  outDir: join(projectRoot, "out"),
  outputExtension: ".mjs",
  runtimeImport: "smthrs/runtime",
  sourceMap: true,
});
assert.deepEqual(project.diagnostics, []);
assert.match(project.files["main.sm"].code, /\.\/service\.mjs/);
assert.equal(typeof project.files["main.sm"].sourceMap, "string");

const declarations = language.emitProjectDeclarations([{
  fileName: join(projectRoot, "declaration.ts"),
  code: "export const answer = 42 as const;",
}]);
assert.equal(declarations.ok, true, JSON.stringify(declarations.diagnostics));
assert.match(declarations.outputs[0].code, /answer: 42/);

const identityMap = (file, source, content) => JSON.stringify({
  version: 3,
  file,
  sources: [source],
  sourcesContent: [content],
  names: [],
  mappings: "AAAA",
});
const composedMap = JSON.parse(language.composeSourceMaps(
  identityMap("out.js", "lowered.ts", "const value = 1"),
  identityMap("lowered.ts", "authored.sm", "const value = 1"),
  "out.js",
));
assert.deepEqual(composedMap.sources, ["authored.sm"]);
assert.deepEqual(composedMap.sourcesContent, ["const value = 1"]);

const durableCompiler = loaded.get("./durable/source-compiler");
const durableArtifact = loaded.get("./durable/artifact");
const durable = loaded.get("./durable");
const durableSource = [
  'import { durable as lower } from "smithers:flows"',
  "export const Echo = lower(function Echo(input: { value: string }) {",
  "  return input.value",
  "})",
].join("\n");
const durableOptions = { fileName: "flows/echo.ts", flowId: "release/Echo", flowVersion: 1, actions: [] };
const durableResult = durableCompiler.compileDurableSource(durableSource, durableOptions);
assert.equal(durableResult.ok, true, JSON.stringify(durableResult.diagnostics));
assert.equal(durableArtifact.decodePlanArtifact(durableResult.artifact).digest, durableResult.plan.digest);
assert.equal(durable.compileDurableSource, durableCompiler.compileDurableSource);
// MIGRATION-PLAN.md §5 R2. The packed runtime is smoke-tested through the
// Manifest path as well as the Plan path, and the Manifest's published identity
// is re-derived from its own canonical bytes rather than read off the field —
// that is the property `smithers plan --outFile` publishes, so this is where a
// packed build that broke it would be caught.
const manifestResult = durableCompiler.compileEffectManifest(durableSource, durableOptions);
assert.equal(manifestResult.ok, true, JSON.stringify(manifestResult.diagnostics));
assert.equal(manifestResult.manifest.flowId, "release/Echo");
assert.equal(manifestResult.manifest.manifestVersion, 1);
assert.deepEqual(manifestResult.manifest.actions, []);
assert.deepEqual(manifestResult.manifest.sites, []);
const { digest: declaredManifestDigest, ...manifestSemantic } = manifestResult.manifest;
assert.equal(durable.digest(manifestSemantic), declaredManifestDigest);
assert.equal(typeof durable.canonicalJson(manifestResult.manifest), "string");
assert.equal(durable.compileEffectManifest, durableCompiler.compileEffectManifest);
assert.equal(typeof durable.validateDurableSchema, "function");
assert.equal("waitSignal" in durable, false);
assert.equal(durable.MAX_DURABLE_JSON_NODES, 100_000);
const signingKeyPair = durable.generateDeploymentSigningKeyPair();
const verificationKey = durable.deploymentVerificationKey(signingKeyPair);
assert.equal(signingKeyPair.algorithm, "Ed25519");
assert.equal(verificationKey.algorithm, "Ed25519");
assert.equal(verificationKey.keyId, signingKeyPair.keyId);
assert.equal(verificationKey.publicKey, signingKeyPair.publicKey);
if (isBun) {
  const durableBun = loaded.get("./durable/bun");
  assert.equal(durableBun.compileDurableSource, durableCompiler.compileDurableSource);
  assert.equal(typeof durableBun.SignalDeliveryConflictError, "function");
  assert.equal(typeof durableBun.SignalDeliveryRejectedError, "function");
  assert.equal(typeof durableBun.DurableExecutor.prototype.deliverSignal, "function");
  assert.equal(typeof durableBun.DurableStore.prototype.deliverSignal, "function");
  assert.equal(typeof durableBun.DurableStore.prototype.pollSignal, "function");
  assert.equal(typeof durableBun.validateDurableSchema, "function");
  assert.equal(durableBun.MAX_DURABLE_JSON_NODES, durable.MAX_DURABLE_JSON_NODES);
  assert.equal("waitSignal" in durableBun, false);
}

const build = loaded.get("./build");
const comptimeCache = mkdtempSync(join(tmpdir(), "smithers-release-comptime-"));
const comptimeCompiler = new build.ComptimeCompiler({
  root: process.cwd(),
  cacheDirectory: comptimeCache,
  target: isBun ? "bun" : "node",
});
const comptimeSource = 'import { comptime as now } from "smithers:comptime"; export const value = now({ release: true, count: 2 });';
let comptime;
try {
  comptime = await build.compileComptimeIntrinsics({
    compiler: comptimeCompiler,
    sources: { "release.sm": comptimeSource },
  });
} finally {
  rmSync(comptimeCache, { recursive: true, force: true });
}
assert.equal(comptime.ok, true, JSON.stringify(comptime.diagnostics));
assert.equal(comptime.calls[0].value.count, 2);
assert.equal(comptime.calls[0].value.release, true);
assert.deepEqual(Object.keys(comptime.calls[0].value), ["count", "release"]);
assert.doesNotMatch(comptime.loweredSources["release.sm"], /smithers:comptime/);

const agent = loaded.get("./agent");
assert.equal("SqliteTurnJournal" in agent, false);
assert.equal("flowTool" in agent, false);
const turn = await new agent.InMemoryTypeScriptCompiler().compile(
  "export default async function turn(functions: Functions) { void functions; return null }",
  "interface Functions {}",
);
assert.equal(turn.ok, true, JSON.stringify(turn.diagnostics));
assert.match(turn.javascript, /function turn/);
if (isBun) {
  const agentBun = loaded.get("./agent/bun");
  assert.equal(typeof agentBun.SqliteTurnJournal, "function");
  assert.equal(typeof agentBun.flowTool, "function");
  assert.equal(agentBun.InMemoryTypeScriptCompiler, agent.InMemoryTypeScriptCompiler);
}

// The derived-schema runtime is the module every lowered
// `comptime(Schema.derive<T>())` names, so it must resolve and interpret a
// descriptor from the installed package alone.
const schemaRuntime = loaded.get("./schema-runtime");
const smokeSchema = schemaRuntime.__vsSchema({
  kind: "object",
  properties: [
    { name: "count", optional: false, value: { kind: "number" } },
    { name: "name", optional: false, value: { kind: "string" } },
  ],
});
assert.equal(smokeSchema.descriptor.kind, "object");
assert.deepEqual(
  smokeSchema.parse({ name: "release", count: 1 }).match({ ok: (row) => row, error: () => null }),
  { count: 1, name: "release" },
);
assert.equal(
  smokeSchema.parse({ name: 1, count: 1 }).match({ ok: () => null, error: (failure) => failure.pointer }),
  "$.name",
);
assert.equal(typeof schemaRuntime.ValidationError, "function");

const platform = loaded.get("./platform");
assert.equal(platform.Duration.seconds(2).toMillis(), 2_000);
assert.equal(platform.Path.join("release", "smoke"), "release/smoke");
// `NodePlatform` is a ready-made Layer value; `nodePlatform(options)` is the
// factory that builds one with overrides. Pin both shapes so a regression in
// either direction is caught.
assert.equal(typeof platform.NodePlatform, "object");
assert.equal(typeof platform.nodePlatform, "function");
assert.equal(typeof platform.InMemoryFileSystem, "function");
const smokeClock = new platform.TestClock();
assert.equal(typeof smokeClock.monotonic(), "number");

const data = loaded.get("./data");
assert.deepEqual([...data.Chunk.of(1, 2, 3)], [1, 2, 3]);
assert.equal(data.Chunk.of(1, 2, 3).size, 3);
// A lookup that can miss now answers with the value or `undefined`, read by
// ordinary narrowing rather than a container. Both directions are pinned.
assert.equal(data.HashMap.of(["answer", 42]).get("answer") ?? null, 42);
assert.equal(data.HashMap.of(["answer", 42]).get("absent") ?? null, null);
assert.equal(data.HashSet.of("release").has("release"), true);
assert.equal(data.Data.equals(data.Data.struct({ id: 1 }), data.Data.struct({ id: 1 })), true);
assert.equal(typeof data.Match.value, "function");

const concurrency = loaded.get("./concurrency");
assert.equal(typeof concurrency.awaitAll, "function");
for (const name of ["Queue", "Semaphore", "Channel", "Stream", "Governor", "CancellationSource"]) {
  assert.equal(typeof concurrency[name], "function", `smthrs/concurrency must export ${name}`);
}
assert.equal(typeof concurrency.allKeyed, "function");
assert.equal("TypedWorker" in concurrency, false, "the Bun worker host stays on smthrs/concurrency/bun");
assert.deepEqual(await concurrency.awaitAll(Promise.resolve(1), Promise.resolve("two")), [1, "two"]);

console.log(JSON.stringify({ ok: true, runtime: isBun ? "bun" : "node", exports: Object.keys(packageMetadata.exports).length }));
