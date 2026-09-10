import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

test("CLI compilation refuses native protocol methods that would silently discard Flow requests", () => {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), "vibelang-cli-body-protocol-")));
  try {
    const bodies = [
      "class Resource { [Symbol.dispose](): void { Write.run(input).isError() } } using r = new Resource(); return input + 1",
      "class Resource { [Symbol.iterator](): Iterator<number> { Write.run(input).isError(); return { next: () => ({ done: true, value: 0 }) } } } let n = 0; for (const item of new Resource()) n++; return n",
      "class Resource { toString(): string { Write.run(input).isError(); return 'value' } } return String(new Resource())",
    ];
    for (const [index, body] of bodies.entries()) {
      const source = `import { durable, Action } from "vibelang:flows"
class Write extends Action<(input: number) => Result<number, never>> {}
export const Flow = durable((input: number) => { ${body} })`;
      const input = join(directory, `main${index}.vibe`);
      const output = join(directory, `out${index}`);
      writeFileSync(input, source);
      const compiled = spawnSync(process.execPath, ["bin/vibe.js", "compile", input,
        "--rootDir", directory, "--outDir", output, "--format", "json"],
      { cwd: process.cwd(), encoding: "utf8" });
      assert.equal(compiled.status, 1, compiled.stderr || compiled.stdout);
      const report = JSON.parse(compiled.stdout);
      assert.ok(report.files[0].diagnostics.some(diagnostic => diagnostic.code === "VIBE1802" &&
        diagnostic.message.includes("implicit")), compiled.stdout);
      assert.equal(existsSync(join(output, `main${index}.mjs`)), false);
    }
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("CLI-emitted timer bodies suspend and resume through the public signed coordinator", () => {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), "vibelang-cli-timer-")));
  try {
    const source = `import { durable, sleep } from "vibelang:flows"
export const Pause = durable((count: number) => {
  for (let i = 0; i < count; i++) sleep(0)
  return count + 1
})`;
    writeFileSync(join(directory, "main.vibe"), source);
    const compiled = spawnSync(process.execPath, ["bin/vibe.js", "compile", join(directory, "main.vibe"),
      "--rootDir", directory, "--outDir", join(directory, "out"), "--declaration", "--sourceMap", "--format", "json"],
    { cwd: process.cwd(), encoding: "utf8" });
    assert.equal(compiled.status, 0, compiled.stderr || compiled.stdout);
    assert.match(readFileSync(join(directory, "out/main.d.mts"), "utf8"), /bodyVersion: 2/);
    assert.equal(JSON.parse(readFileSync(join(directory, "out/main.mjs.map"), "utf8")).sourcesContent[0], source);
    mkdirSync(join(directory, "node_modules"));
    symlinkSync(process.cwd(), join(directory, "node_modules/vibelang"), process.platform === "win32" ? "junction" : "dir");
    const executed = spawnSync("bun", ["-"], { cwd: directory, encoding: "utf8", input: `
import { Pause } from "./out/main.mjs";
import { Deployment, SignedDeployment, createAuthenticatedDurableExecutor, DurableStore, CoordinatorCrash,
  generateDeploymentSigningKeyPair, deploymentVerificationKey } from "vibelang/durable/bun";
const deployment = Deployment.build({ id: "cli-timer", flow: Pause, pools: [] });
const key = generateDeploymentSigningKeyPair();
const proof = SignedDeployment.authenticate(deployment,
  SignedDeployment.encode(Pause.body, deployment.manifest, key), [deploymentVerificationKey(key)]);
const store = new DurableStore();
try {
  try {
    await createAuthenticatedDurableExecutor(proof, store).execute(3, { executionId: "cli-timer",
      afterNodeAdopted: node => { throw new CoordinatorCrash(node) } });
    throw new Error("the first timer did not reach its commit hook");
  } catch (error) { if (!(error instanceof CoordinatorCrash)) throw error; }
  const resumed = createAuthenticatedDurableExecutor(proof, store).resume("cli-timer");
  console.log(JSON.stringify({ value: await resumed.result(), audit: resumed.audit(),
    timers: store.journal("cli-timer").filter(event => event.type === "timer_scheduled").length }));
} finally { store.close(); }
` });
    assert.equal(executed.status, 0, executed.stderr || executed.stdout);
    assert.deepEqual(JSON.parse(executed.stdout), { value: 4, timers: 3,
      audit: { requests: 3, recorded: 1, replayed: 1, dispatchedLive: 2 } });
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("the normal CLI emits a checked async Flow consumed by signed execution and replay", () => {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), "vibelang-cli-body-")));
  try {
    const source = `import { durable, Action } from "vibelang:flows"
import { comptime } from "vibelang:comptime"
class Read extends Action<(n: number) => Result<number, never>> {}
const bias = comptime(1 + 1); function read(n: number): Result<number, never> { return Read.run(n)! }
export const Flow = durable(async (n: number): Promise<Result<number, never>> => {
  await Promise.resolve()
  let total = bias
  for (let i = 0; i < n; i++) total += read(i)!
  return total
})`;
    writeFileSync(join(directory, "main.vibe"), source);
    const compiled = spawnSync(process.execPath, ["bin/vibe.js", "compile", join(directory, "main.vibe"),
      "--rootDir", directory, "--outDir", join(directory, "out"), "--declaration", "--sourceMap", "--format", "json"],
    { cwd: process.cwd(), encoding: "utf8" });
    assert.equal(compiled.status, 0, compiled.stderr || compiled.stdout);
    const report = JSON.parse(compiled.stdout);
    const emitted = readFileSync(join(directory, "out/main.mjs"), "utf8");
    assert.doesNotMatch(emitted, /from "vibelang:flows"/);
    assert.match(readFileSync(join(directory, "out/main.d.mts"), "utf8"), /bodyVersion: 1/);
    assert.equal(JSON.parse(readFileSync(join(directory, "out/main.mjs.map"), "utf8")).sourcesContent[0], source);
    mkdirSync(join(directory, "node_modules"));
    symlinkSync(process.cwd(), join(directory, "node_modules/vibelang"), process.platform === "win32" ? "junction" : "dir");
    const executed = spawnSync("bun", ["-"], { cwd: directory, encoding: "utf8", input: `
import { Flow } from "./out/main.mjs";
import { Action, Deployment, createAuthenticatedDurableExecutor, DurableStore, Provider, Worker,
  SignedDeployment, generateDeploymentSigningKeyPair, deploymentVerificationKey } from "vibelang/durable/bun";
const inputs = [];
const action = Action.fromDescriptor(Flow.manifest.actions[0]);
const provider = Provider.provide(action, n => { inputs.push(n); return n * 2 },
  { implementationId: "cli-worker", implementationVersion: "1", recovery: { mode: "repeatable", maxAttempts: 3 } });
const deployment = Deployment.build({ id: "cli", flow: Flow,
  pools: [Worker.pool("worker", { target: "typescript-bun", providers: [provider] })] });
const key = generateDeploymentSigningKeyPair();
const proof = SignedDeployment.authenticate(deployment,
  SignedDeployment.encode(Flow.body, deployment.manifest, key), [deploymentVerificationKey(key)]);
const store = new DurableStore();
try {
  const executor = createAuthenticatedDurableExecutor(proof, store);
  const options = { executionId: "cli" };
  const first = await executor.execute(4, options);
  const replay = await createAuthenticatedDurableExecutor(proof, store).execute(4, options);
  console.log(JSON.stringify({ first, replay, inputs, source: Flow.body.source.text,
    lowering: Flow.body.loweringIdentity, sites: Flow.manifest.sites.map(site => site.anchor),
    nodes: store.journal("cli").filter(event => event.type === "node_succeeded").length }));
} finally { store.close() }
` });
    assert.equal(executed.status, 0, executed.stderr || executed.stdout);
    const beforeRequest = source.slice(0, source.indexOf("Read.run"));
    const lines = beforeRequest.split("\n");
    assert.deepEqual(JSON.parse(executed.stdout), { first: 14, replay: 14, inputs: [0, 1, 2, 3], nodes: 4,
      source, lowering: report.files[0].comptime.identity, sites: [`${lines.length - 1}:${lines.at(-1).length}`] });
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("the public executable Flow compiler works under Node without the Bun coordinator", async () => {
  const durable = await import("vibelang/durable");
  const source = `import { durable, Action } from "vibelang:flows"
class Read extends Action<(n: number) => Result<number, Error>> {}
const bias = 2
export const Flow = durable(async (n: number) => {
  await Promise.resolve()
  let total = bias
  for (let i = 0; i < n; i++) total += Read.run(i)!
  return total
})`;
  const result = durable.compileDurableBody(source, { fileName: "node-body.vibe" });
  assert.equal(result.ok, true, result.ok ? undefined : JSON.stringify(result.diagnostics));
  assert.equal(result.body.async, true);
  assert.equal(durable.validateDurableBodyArtifact(result.body).digest, result.body.digest);
  assert.deepEqual(result.body.manifest.actions.map(action => action.id), ["node-body.vibe#Read"]);
  const flow = durable.compileDurableFlow(source, { fileName: "node-body.vibe" });
  assert.equal(flow.ok, true, flow.ok ? undefined : JSON.stringify(flow.diagnostics));
  assert.equal(flow.flow.body.digest, result.body.digest);
});

test("public durable compiler lowers and validates a Plan without loading the Bun coordinator", async () => {
  const durable = await import("vibelang/durable");
  const directCompiler = await import("vibelang/durable/source-compiler");
  const { Action } = await import("vibelang/durable/authoring");

  assert.equal(typeof durable.compileDurableSource, "function");
  assert.equal(typeof durable.generateDeploymentSigningKeyPair, "function");
  assert.equal(typeof durable.decodeSignedDeploymentArtifact, "function");
  assert.equal(directCompiler.compileDurableSource, durable.compileDurableSource);
  assert.equal(typeof durable.PlanArtifact.validate, "function");

  const Work = Action.define({ id: "package-test/Work", version: 1 });
  const actions = [{
    moduleSpecifier: "package-test:actions",
    exportName: "Work",
    descriptor: Work.descriptor,
  }];
  const source = `
import { durable as compileFlow } from "vibelang:flows"
import { Work as RunWork } from "package-test:actions"

export const Build = compileFlow(function Build(input: { value: number }) {
  return RunWork.run({ value: input.value })
})
`;
  const result = durable.compileDurableSource(source, {
    fileName: "consumer/build.vibe.ts",
    flowId: "package-test/Build",
    flowVersion: 1,
    actions,
  });
  assert.equal(result.ok, true, result.ok ? undefined : JSON.stringify(result.diagnostics));
  const validated = durable.PlanArtifact.validate(result.plan);
  assert.equal(validated.digest, result.plan.digest);
  assert.equal(durable.PlanArtifact.decode(result.artifact).digest, result.plan.digest);
  assert.equal(result.flow.artifactSource, "static-plan-artifact");

  // A runtime branch used to be refused here as VIBE4106. MIGRATION-PLAN.md
  // step 11 withdrew that wall: the Plan lowerer has no shape for such a body
  // and SIGNALS so — `PlanUnrepresentable`, never a diagnostic — while the Flow
  // compiler publishes the Effect Manifest instead. Both halves are asserted
  // through the PUBLIC package surface, which is what this file exists to
  // measure: `compileDurableFlow`, `PlanUnrepresentable` and the Manifest types
  // are exports a consumer can reach.
  const branchy = `
import { durable } from "vibelang:flows"
import { Work } from "package-test:actions"
export const Build = durable(function Build(input: { value: number }) {
  if (input.value) return Work.run({ value: input.value })
  return Work.run({ value: 0 })
})
`;
  assert.throws(
    () => durable.compileDurableSource(branchy, { actions }),
    (error) => error instanceof durable.PlanUnrepresentable,
  );
  const declined = durable.compileDurableFlow(branchy, { actions });
  assert.equal(declined.ok, true, declined.ok ? undefined : JSON.stringify(declined.diagnostics));
  assert.equal(declined.plan, undefined);
  assert.equal(declined.flow.artifactSource, "effect-manifest");
  assert.deepEqual(declined.manifest.actions.map((action) => action.id), ["package-test/Work"]);
});

test("a clean Bun consumer executes a Flow compiled through the public durable facade", () => {
  const consumer = String.raw`
import {
  authenticateDeployment,
  compileDurableSource,
  deploymentVerificationKey,
  encodeSignedDeploymentArtifact,
  generateDeploymentSigningKeyPair,
  PlanArtifact,
} from "vibelang/durable";
import {
  Action,
  createAuthenticatedDurableExecutor,
  Deployment,
  DurableStore,
  Provider,
  Worker,
} from "vibelang/durable/bun";

const Work = Action.define({ id: "package-test/Execute", version: 1 });
let implementationCalls = 0;
const durableSource = [
  'import { durable } from "vibelang:flows"',
  'import { Work } from "package-test:execute-actions"',
  'throw new Error("the durable author module was evaluated")',
  'export const Execute = durable(function Execute(input: { value: number }) {',
  '  return Work.run({ value: input.value })',
  '})',
].join("\n");
const compiled = compileDurableSource(durableSource, {
  fileName: "consumer/execute.vibe.ts",
  flowId: "package-test/ExecuteFlow",
  actions: [{
    moduleSpecifier: "package-test:execute-actions",
    exportName: "Work",
    descriptor: Work.descriptor,
  }],
});
if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics));
if (implementationCalls !== 0) throw new Error("Action implementation ran during compilation");
PlanArtifact.validate(compiled.plan);

const Live = Provider.provide(Work, ({ value }) => {
  implementationCalls += 1;
  return { doubled: value * 2 };
}, {
  implementationId: "package-test-live",
  implementationVersion: "1",
});
const deployment = Deployment.build({
  id: "package-test-deployment",
  flow: compiled.flow,
  pools: [Worker.pool("package-test-worker", {
    target: "typescript-bun",
    providers: [Live],
  })],
});
const signingKey = generateDeploymentSigningKeyPair();
const signedArtifact = encodeSignedDeploymentArtifact(
  deployment.flow.plan,
  deployment.manifest,
  signingKey,
);
const authentication = authenticateDeployment(
  deployment,
  signedArtifact,
  [deploymentVerificationKey(signingKey)],
);
const store = new DurableStore();
try {
  const output = await createAuthenticatedDurableExecutor(authentication, store).execute(
    { value: 6 },
    { executionId: "package-test-execution" },
  );
  console.log(JSON.stringify({ output, implementationCalls, nodes: compiled.plan.nodes.length }));
} finally {
  store.close();
}
`;
  const directory = mkdtempSync(join(tmpdir(), "vibelang-durable-consumer-"));
  try {
    const modules = join(directory, "node_modules");
    mkdirSync(modules);
    symlinkSync(process.cwd(), join(modules, "vibelang"), process.platform === "win32" ? "junction" : "dir");
    writeFileSync(join(directory, "package.json"), '{"name":"durable-consumer","private":true,"type":"module"}\n');
    const result = spawnSync("bun", ["-"], {
      cwd: directory,
      input: consumer,
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.deepEqual(JSON.parse(result.stdout), {
      output: { doubled: 12 },
      implementationCalls: 1,
      nodes: 1,
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
