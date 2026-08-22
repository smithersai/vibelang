import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

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

  const rejected = durable.compileDurableSource(`
import { durable } from "vibelang:flows"
import { Work } from "package-test:actions"
export const Build = durable(function Build(input: { value: number }) {
  if (input.value) return Work.run({ value: input.value })
  return Work.run({ value: 0 })
})
`, { actions });
  assert.equal(rejected.ok, false);
  assert.equal(rejected.diagnostics[0].code, "VIBE4106");
  assert.equal(rejected.diagnostics[0].line > 0, true);
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
