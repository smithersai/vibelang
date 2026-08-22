import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

function run(file, args) {
  return spawnSync(process.execPath, [file, ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
}

function snapshotTree(root, directory = root, output = {}) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const absolute = join(directory, entry.name);
    if (entry.isDirectory()) snapshotTree(root, absolute, output);
    else if (entry.isFile()) output[absolute.slice(root.length + 1)] = readFileSync(absolute);
    else throw new TypeError(`unexpected output entry: ${absolute}`);
  }
  return output;
}

test("vibec forwards raw TypeScript CLI flags", () => {
  const result = run("bin/vibec.js", ["--version"]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Version 7\.0\./);
});

test("vibec type-checks ordinary TypeScript", () => {
  const result = run("bin/vibec.js", ["--noEmit", "test/fixtures/basic.ts"]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test("Incur CLI publishes its command surface", () => {
  const result = run("bin/vibe.js", ["--help"]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /compile/);
  assert.match(result.stdout, /doctor/);
  assert.match(result.stdout, /format/);
});

test("Incur check command delegates to the compiler", () => {
  const result = run("bin/vibe.js", ["check", "test/fixtures/basic.ts", "--strict"]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test("Vibe CLI checks, inspects, compiles, and runs .vibe source", () => {
  const checked = run("bin/vibe.js", ["check", "test/fixtures/basic.vibe", "--format", "json"]);
  assert.equal(checked.status, 0, checked.stderr || checked.stdout);
  assert.equal(JSON.parse(checked.stdout).ok, true);

  const inspected = run("bin/vibe.js", ["inspect", "test/fixtures/basic.vibe", "--format", "json"]);
  assert.equal(inspected.status, 0, inspected.stderr || inspected.stdout);
  const inspection = JSON.parse(inspected.stdout);
  assert.deepEqual(inspection.files[0].language.rows.answer.failures, ["InvalidAnswer"]);

  const output = mkdtempSync(join(tmpdir(), "vibelang-cli-test-"));
  try {
    const compiled = run("bin/vibe.js", ["compile", "test/fixtures/basic.vibe", "--outDir", output, "--format", "json"]);
    assert.equal(compiled.status, 0, compiled.stderr || compiled.stdout);
    assert.equal(JSON.parse(compiled.stdout).ok, true);
    assert.equal(existsSync(join(output, "basic.mjs")), true);
    assert.equal(existsSync(join(output, "basic.mjs.map")), false);
    assert.doesNotMatch(readFileSync(join(output, "basic.mjs"), "utf8"), /sourceMappingURL/);
  } finally {
    rmSync(output, { recursive: true, force: true });
  }

  const executed = run("bin/vibe.js", ["run", "test/fixtures/basic.vibe"]);
  assert.equal(executed.status, 0, executed.stderr || executed.stdout);
  assert.match(executed.stdout, /ok: true/);
});

test("source asset imports work across compile, check, inspect, run, and test", async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "vibelang-cli-assets-")));
  let assetCacheIdentity;
  try {
    const source = join(root, "main.vibe");
    const output = join(root, "output");
    const noEmitOutput = join(root, "no-emit-output");
    writeFileSync(join(root, "config.json"), '{"answer":42,"label":"asset"}\n');
    writeFileSync(source, `
      import config from "./config.json" with { type: "json", mode: "const" }
      export const answer: 42 = config.answer
      export function readAsset(): number { return config.answer }
      export function testAsset(): void { const exact: 42 = config.answer }
    `);

    const compiled = run("bin/vibe.js", [
      "compile",
      source,
      "--rootDir",
      root,
      "--outDir",
      output,
      "--declaration",
      "--sourceMap",
      "--format",
      "json",
    ]);
    assert.equal(compiled.status, 0, compiled.stderr || compiled.stdout);
    const report = JSON.parse(compiled.stdout);
    assert.equal(report.ok, true);
    assert.equal(report.files[0].assets.modules.length, 1);
    assert.equal(report.files[0].assets.modules[0].cacheHit, false);
    assetCacheIdentity = report.files[0].assets.cacheIdentity;
    assert.match(assetCacheIdentity, /^[0-9a-f]{64}$/);

    const logicalKey = report.files[0].assets.modules[0].logicalKey;
    const mainJavaScript = join(output, "main.mjs");
    const assetJavaScript = join(output, "__vibelang_assets__", `${logicalKey}.mjs`);
    assert.equal(existsSync(mainJavaScript), true);
    assert.equal(existsSync(`${mainJavaScript}.map`), true);
    assert.equal(existsSync(join(output, "main.d.mts")), true);
    assert.equal(existsSync(assetJavaScript), true);
    assert.equal(existsSync(`${assetJavaScript}.map`), true);
    assert.equal(existsSync(assetJavaScript.replace(/\.mjs$/, ".d.mts")), true);
    const emittedMain = readFileSync(mainJavaScript, "utf8");
    assert.match(emittedMain, new RegExp(`__vibelang_assets__/${logicalKey}\\.mjs`));
    assert.doesNotMatch(emittedMain, /\bwith\s*\{|\bassert\s*\{/);
    assert.equal(JSON.parse(readFileSync(`${assetJavaScript}.map`, "utf8")).version, 3);
    const namespace = await import(`${pathToFileURL(mainJavaScript).href}?cold=${Date.now()}`);
    assert.equal(namespace.answer, 42);
    assert.equal(namespace.readAsset(), 42);

    const repeated = run("bin/vibe.js", [
      "compile",
      source,
      "--rootDir",
      root,
      "--outDir",
      output,
      "--declaration",
      "--sourceMap",
      "--format",
      "json",
    ]);
    assert.equal(repeated.status, 0, repeated.stderr || repeated.stdout);
    const repeatedReport = JSON.parse(repeated.stdout);
    assert.equal(repeatedReport.files[0].assets.modules[0].cacheHit, true);
    assert.equal(repeatedReport.files[0].assets.modules[0].logicalKey, logicalKey);

    const noEmit = run("bin/vibe.js", [
      "compile",
      source,
      "--rootDir",
      root,
      "--outDir",
      noEmitOutput,
      "--noEmit",
      "--format",
      "json",
    ]);
    assert.equal(noEmit.status, 0, noEmit.stderr || noEmit.stdout);
    assert.equal(JSON.parse(noEmit.stdout).ok, true);
    assert.equal(existsSync(noEmitOutput), false);

    const checked = run("bin/vibe.js", ["check", source, "--rootDir", root, "--format", "json"]);
    assert.equal(checked.status, 0, checked.stderr || checked.stdout);
    assert.equal(JSON.parse(checked.stdout).files[0].rows.readAsset.failures.length, 0);

    const inspected = run("bin/vibe.js", ["inspect", source, "--format", "json"]);
    assert.equal(inspected.status, 0, inspected.stderr || inspected.stdout);
    const inspection = JSON.parse(inspected.stdout);
    assert.deepEqual(inspection.files[0].language.rows.readAsset, { failures: [], requirements: [] });

    const executed = run("bin/vibe.js", ["run", source, "--format", "json"]);
    assert.equal(executed.status, 0, executed.stderr || executed.stdout);
    assert.equal(JSON.parse(executed.stdout).ok, true);

    const tested = run("bin/vibe.js", ["test", source, "--format", "json"]);
    assert.equal(tested.status, 0, tested.stderr || tested.stdout);
    assert.equal(JSON.parse(tested.stdout).summary, "1 passed, 0 failed");
  } finally {
    rmSync(root, { recursive: true, force: true });
    if (typeof assetCacheIdentity === "string" && /^[0-9a-f]{64}$/.test(assetCacheIdentity)) {
      rmSync(join(tmpdir(), "vibelang-source-asset-cache-v1", assetCacheIdentity), { recursive: true, force: true });
    }
  }
});

test("source asset diagnostics fail inspect stably and commit no partial output", () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "vibelang-cli-assets-rejected-")));
  try {
    const source = join(root, "main.vibe");
    const output = join(root, "output");
    mkdirSync(output);
    writeFileSync(join(output, "sentinel.txt"), "preserve");
    writeFileSync(join(root, "config.json"), "{}\n");
    writeFileSync(source, 'import config from "./config.json"\nexport const value = config\n');

    const compiled = run("bin/vibe.js", [
      "compile", source, "--rootDir", root, "--outDir", output, "--format", "json",
    ]);
    assert.equal(compiled.status, 1, compiled.stderr || compiled.stdout);
    const report = JSON.parse(compiled.stdout);
    assert.equal(report.files[0].diagnostics.some((item) => item.code === "VIBE5201"), true);
    assert.deepEqual(readdirSync(output), ["sentinel.txt"]);

    const inspected = run("bin/vibe.js", ["inspect", source, "--format", "json"]);
    assert.equal(inspected.status, 1, inspected.stderr || inspected.stdout);
    const inspection = JSON.parse(inspected.stdout);
    assert.equal(inspection.code, "VIBE_ASSET_IMPORT");
    assert.equal(inspection.assets.diagnostics.some((item) => item.code === "VIBE5201"), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("prototype package subpaths expose real compiler and runtime APIs", async () => {
  const language = await import("vibelang/language");
  const vibe = await import("vibelang/vibe");
  const runtime = await import("vibelang/runtime");
  const targets = await import("vibelang/targets");

  assert.equal(typeof language.compileVibe, "function");
  assert.equal(typeof language.annotateDeclarationEffects, "function");
  assert.equal(typeof language.readDeclarationEffects, "function");
  assert.equal(typeof vibe.annotateDeclarationEffects, "function");
  assert.equal(typeof vibe.readDeclarationEffects, "function");
  const annotated = language.annotateDeclarationEffects(
    "export declare function sample(): string;\n",
    { sample: { failures: ["Missing"], requirements: ["Clock"] } },
  );
  assert.deepEqual(vibe.readDeclarationEffects(annotated).sample, {
    failures: ["Missing"],
    requirements: ["Clock"],
  });
  assert.equal(typeof runtime.panic, "function");
  assert.equal(typeof runtime.Layer.provide, "function");
  assert.equal(typeof targets.analyzeCompatibility, "function");
});

test("root Context and Layer subpaths execute the real async environment", async () => {
  const { Context } = await import("vibelang/context");
  const { Layer } = await import("vibelang/provider");
  class Clock extends Context {}
  const service = { now: () => 42 };

  const value = await Layer.provide(Layer.succeed(Clock, service), async () => {
    await Promise.resolve();
    return Clock.context().now();
  });
  assert.equal(value, 42);
});

// `format` and `lsp` are implemented; their behaviour lives in
// test/format.test.mjs and test/lsp.test.mjs. This keeps the usage-error and
// stdout-ownership contracts next to the rest of the command surface.
test("format and lsp report usage errors without the old NOT_IMPLEMENTED stub", () => {
  const formatted = run("bin/vibe.js", ["format", "--format", "json"]);
  assert.equal(formatted.status, 2);
  assert.equal(JSON.parse(formatted.stdout).code, "INVALID_INPUT");

  // The language server owns stdout for the whole session, so a closed stdin
  // ends it with the LSP code for `exit` without `shutdown` and prints nothing.
  const lsp = run("bin/vibe.js", ["lsp"]);
  assert.equal(lsp.status, 1);
  assert.equal(lsp.stdout, "");
});

test("vibe test runs exported checked and async test functions", () => {
  const passing = run("bin/vibe.js", [
    "test",
    "test/fixtures/tests/passing.vibe",
    "--format",
    "json",
  ]);
  assert.equal(passing.status, 0, passing.stderr || passing.stdout);
  const passingReport = JSON.parse(passing.stdout);
  assert.equal(passingReport.summary, "2 passed, 0 failed");
  assert.equal(passingReport.tests.length, 2);
  assert.equal(passingReport.tests.every((item) => item.ok), true);
  assert.deepEqual(passingReport.tests.map((item) => item.name), [
    "test/fixtures/tests/passing.vibe#testAsyncSuccess",
    "test/fixtures/tests/passing.vibe#testCheckedSuccess",
  ]);
  assert.equal(passingReport.tests.some((item) => item.name.includes("vibelang-test-")), false);

  const failing = run("bin/vibe.js", [
    "test",
    "test/fixtures/tests/failing.vibe",
    "--format",
    "json",
  ]);
  assert.equal(failing.status, 1, failing.stderr || failing.stdout);
  const failingReport = JSON.parse(failing.stdout);
  assert.equal(failingReport.ok, false);
  assert.equal(failingReport.summary, "0 passed, 1 failed");
  assert.equal(failingReport.tests[0].ok, false);
  assert.match(failingReport.tests[0].error, /expected test failure/);

  const hanging = run("bin/vibe.js", [
    "test",
    "test/fixtures/tests/hanging.vibe",
    "--timeoutMs",
    "100",
    "--format",
    "json",
  ]);
  assert.equal(hanging.status, 1, hanging.stderr || hanging.stdout);
  const hangingReport = JSON.parse(hanging.stdout);
  assert.equal(hangingReport.ok, false);
  assert.match(hangingReport.summary, /exceeded 100ms/);
});

test("vibe test rejects ambiguous discovery and bounds hostile test processes", () => {
  const missing = run("bin/vibe.js", ["test", "--format", "json"]);
  assert.equal(missing.status, 2, missing.stderr || missing.stdout);
  assert.equal(JSON.parse(missing.stdout).code, "INVALID_INPUT");

  const noTests = run("bin/vibe.js", [
    "test",
    "test/fixtures/tests/no-tests.vibe",
    "--format",
    "json",
  ]);
  assert.equal(noTests.status, 1, noTests.stderr || noTests.stdout);
  const noTestsReport = JSON.parse(noTests.stdout);
  assert.deepEqual({
    discovered: noTestsReport.discovered,
    passed: noTestsReport.passed,
    failed: noTestsReport.failed,
    summary: noTestsReport.summary,
  }, { discovered: 0, passed: 0, failed: 1, summary: "0 passed, 1 failed" });
  assert.equal(noTestsReport.tests[0].name, "<discovery>");

  const forged = run("bin/vibe.js", [
    "test",
    "test/fixtures/tests/protocol-forge.vibe",
    "--format",
    "json",
  ]);
  assert.equal(forged.status, 2, forged.stderr || forged.stdout);
  const forgedReport = JSON.parse(forged.stdout);
  assert.equal(forgedReport.code, "VIBE_TEST_ERROR");
  assert.match(forgedReport.message, /without its result protocol/);

  const flooded = run("bin/vibe.js", [
    "test",
    "test/fixtures/tests/output-flood.vibe",
    "--format",
    "json",
  ]);
  assert.equal(flooded.status, 2, flooded.stderr || flooded.stdout);
  const floodedReport = JSON.parse(flooded.stdout);
  assert.equal(floodedReport.code, "VIBE_TEST_ERROR");
  assert.match(floodedReport.message, /ENOBUFS|maxBuffer/i);

  const duplicate = run("bin/vibe.js", [
    "test",
    "test/fixtures/tests/passing.vibe",
    "test/fixtures/tests/passing.vibe",
    "--format",
    "json",
  ]);
  assert.equal(duplicate.status, 2, duplicate.stderr || duplicate.stdout);
  assert.match(JSON.parse(duplicate.stdout).message, /same canonical module/);

  const temporary = mkdtempSync(join(tmpdir(), "vibelang-test-adversarial-"));
  try {
    const alias = join(temporary, "passing.vibe");
    symlinkSync(resolve("test/fixtures/tests/passing.vibe"), alias);
    const aliasDuplicate = run("bin/vibe.js", [
      "test",
      "test/fixtures/tests/passing.vibe",
      alias,
      "--format",
      "json",
    ]);
    assert.equal(aliasDuplicate.status, 2, aliasDuplicate.stderr || aliasDuplicate.stdout);
    assert.match(JSON.parse(aliasDuplicate.stdout).message, /same canonical module/);

    const hardLinkSource = join(temporary, "passing-hard-link-source.vibe");
    copyFileSync(resolve("test/fixtures/tests/passing.vibe"), hardLinkSource);
    const hardLinkAlias = join(temporary, "passing-hard-link.vibe");
    linkSync(hardLinkSource, hardLinkAlias);
    const hardLinkDuplicate = run("bin/vibe.js", [
      "test",
      hardLinkSource,
      hardLinkAlias,
      "--format",
      "json",
    ]);
    assert.equal(hardLinkDuplicate.status, 2, hardLinkDuplicate.stderr || hardLinkDuplicate.stdout);
    assert.match(JSON.parse(hardLinkDuplicate.stdout).message, /same canonical module/);

    const oversized = join(temporary, "oversized.vibe");
    writeFileSync(oversized, " ".repeat(2 * 1024 * 1024 + 1));
    const oversizedResult = run("bin/vibe.js", ["test", oversized, "--format", "json"]);
    assert.equal(oversizedResult.status, 2, oversizedResult.stderr || oversizedResult.stdout);
    assert.match(JSON.parse(oversizedResult.stdout).message, /exceeds 2097152 bytes/);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});

test("doctor reports implemented project compiler and test-runner surfaces", () => {
  const result = run("bin/vibe.js", ["doctor", "--format", "json"]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const report = JSON.parse(result.stdout);
  assert.match(report.surfaces.vibeCompile, /cross-module/);
  assert.match(report.surfaces.vibeCompile, /declarations/);
  assert.match(report.surfaces.vibeCompile, /source maps/);
  assert.match(report.surfaces.testRunner, /test\*/);
  assert.doesNotMatch(report.surfaces.testRunner, /not implemented/);
});

test("vibe plan emits a canonical durable artifact without executing authored code", async () => {
  const { Action } = await import("vibelang/durable/authoring");
  const { decodePlanArtifact } = await import("vibelang/durable/artifact");
  const Compile = Action.define({ id: "test/cli/Compile", version: 1 });
  const Package = Action.define({ id: "test/cli/Package", version: 1 });
  const temporary = mkdtempSync(join(tmpdir(), "vibelang-plan-cli-"));
  try {
    const bindings = join(temporary, "actions.json");
    const artifact = join(temporary, "build.plan.json");
    const bindingsSource = JSON.stringify({
      flowId: "test/cli/Build",
      flowVersion: 2,
      actions: [
        { moduleSpecifier: "test:cli-actions", exportName: "Compile", descriptor: Compile.descriptor },
        { moduleSpecifier: "test:cli-actions", exportName: "Package", descriptor: Package.descriptor },
      ],
    });
    writeFileSync(bindings, bindingsSource);

    const compiled = run("bin/vibe.js", [
      "plan",
      "test/fixtures/durable/build.vibe",
      "--bindings",
      bindings,
      "--outFile",
      artifact,
      "--format",
      "json",
    ]);
    assert.equal(compiled.status, 0, compiled.stderr || compiled.stdout);
    const report = JSON.parse(compiled.stdout);
    assert.equal(report.ok, true);
    assert.equal(report.plan.flowId, "test/cli/Build");
    assert.deepEqual(report.plan.nodes.map((node) => node.actionId), ["test/cli/Compile", "test/cli/Package"]);
    const decoded = decodePlanArtifact(new Uint8Array(readFileSync(artifact)));
    assert.equal(decoded.digest, report.digest);

    const repeatedArtifact = join(temporary, "build-repeated.plan.json");
    const repeated = run("bin/vibe.js", [
      "plan",
      "test/fixtures/durable/build.vibe",
      "--bindings",
      bindings,
      "--outFile",
      repeatedArtifact,
      "--format",
      "json",
    ]);
    assert.equal(repeated.status, 0, repeated.stderr || repeated.stdout);
    assert.equal(JSON.parse(repeated.stdout).digest, report.digest);
    assert.deepEqual(readFileSync(repeatedArtifact), readFileSync(artifact));

    const rejectedArtifact = join(temporary, "unsupported.plan.json");
    writeFileSync(rejectedArtifact, "existing artifact must survive");
    const rejected = run("bin/vibe.js", [
      "plan",
      "test/fixtures/durable/unsupported.vibe",
      "--bindings",
      bindings,
      "--outFile",
      rejectedArtifact,
      "--format",
      "json",
    ]);
    assert.equal(rejected.status, 1, rejected.stderr || rejected.stdout);
    assert.match(rejected.stdout + rejected.stderr, /VIBE4106/);
    assert.equal(readFileSync(rejectedArtifact, "utf8"), "existing artifact must survive");

    const duplicateBindings = join(temporary, "duplicate-actions.json");
    writeFileSync(duplicateBindings, '{"flowId":"first","flowId":"second","actions":[]}');
    const duplicateConfig = run("bin/vibe.js", [
      "plan",
      "test/fixtures/durable/build.vibe",
      "--bindings",
      duplicateBindings,
      "--format",
      "json",
    ]);
    assert.equal(duplicateConfig.status, 2, duplicateConfig.stderr || duplicateConfig.stdout);
    const duplicateConfigReport = JSON.parse(duplicateConfig.stdout);
    assert.equal(duplicateConfigReport.code, "VIBE_PLAN_ERROR");
    assert.match(duplicateConfigReport.message, /duplicate key "flowId"/);

    const reservedExportBindings = join(temporary, "reserved-export.json");
    writeFileSync(reservedExportBindings, JSON.stringify({
      actions: [{ moduleSpecifier: "test:cli-actions", exportName: "default", descriptor: Compile.descriptor }],
    }));
    const reservedExport = run("bin/vibe.js", [
      "plan",
      "test/fixtures/durable/build.vibe",
      "--bindings",
      reservedExportBindings,
      "--format",
      "json",
    ]);
    assert.equal(reservedExport.status, 2, reservedExport.stderr || reservedExport.stdout);
    assert.match(JSON.parse(reservedExport.stdout).message, /non-keyword identifier exportName/);

    const sourceCopy = join(temporary, "source.vibe");
    const sourceText = readFileSync("test/fixtures/durable/build.vibe", "utf8");
    writeFileSync(sourceCopy, sourceText);
    const overwriteSource = run("bin/vibe.js", [
      "plan", sourceCopy, "--bindings", bindings, "--outFile", sourceCopy, "--format", "json",
    ]);
    assert.equal(overwriteSource.status, 2, overwriteSource.stderr || overwriteSource.stdout);
    assert.match(JSON.parse(overwriteSource.stdout).message, /cannot overwrite its source or bindings/);
    assert.equal(readFileSync(sourceCopy, "utf8"), sourceText);

    const overwriteBindings = run("bin/vibe.js", [
      "plan",
      "test/fixtures/durable/build.vibe",
      "--bindings",
      bindings,
      "--outFile",
      bindings,
      "--format",
      "json",
    ]);
    assert.equal(overwriteBindings.status, 2, overwriteBindings.stderr || overwriteBindings.stdout);
    assert.match(JSON.parse(overwriteBindings.stdout).message, /cannot overwrite its source or bindings/);
    assert.equal(readFileSync(bindings, "utf8"), bindingsSource);

    const directoryOutput = run("bin/vibe.js", [
      "plan",
      "test/fixtures/durable/build.vibe",
      "--bindings",
      bindings,
      "--outFile",
      temporary,
      "--format",
      "json",
    ]);
    assert.equal(directoryOutput.status, 2, directoryOutput.stderr || directoryOutput.stdout);
    assert.match(JSON.parse(directoryOutput.stdout).message, /output must be a regular file/);

    const redirectedArtifact = join(temporary, "redirected.plan.json");
    const symbolicArtifact = join(temporary, "symbolic.plan.json");
    writeFileSync(redirectedArtifact, "existing redirected artifact must survive");
    symlinkSync(redirectedArtifact, symbolicArtifact);
    const symbolicOutput = run("bin/vibe.js", [
      "plan",
      "test/fixtures/durable/build.vibe",
      "--bindings",
      bindings,
      "--outFile",
      symbolicArtifact,
      "--format",
      "json",
    ]);
    assert.equal(symbolicOutput.status, 2, symbolicOutput.stderr || symbolicOutput.stdout);
    assert.match(JSON.parse(symbolicOutput.stdout).message, /cannot be a symbolic link/);
    assert.equal(readFileSync(redirectedArtifact, "utf8"), "existing redirected artifact must survive");

    const hardLink = join(temporary, "source-hard-link.plan");
    linkSync(sourceCopy, hardLink);
    const overwriteHardLink = run("bin/vibe.js", [
      "plan", sourceCopy, "--bindings", bindings, "--outFile", hardLink, "--format", "json",
    ]);
    assert.equal(overwriteHardLink.status, 2, overwriteHardLink.stderr || overwriteHardLink.stdout);
    assert.match(JSON.parse(overwriteHardLink.stdout).message, /cannot overwrite its source or bindings/);
    assert.equal(readFileSync(sourceCopy, "utf8"), sourceText);

    const disguisedTarget = join(temporary, "disguised.ts");
    const disguisedInput = join(temporary, "disguised.vibe");
    writeFileSync(disguisedTarget, sourceText);
    symlinkSync(disguisedTarget, disguisedInput);
    const disguised = run("bin/vibe.js", [
      "plan", disguisedInput, "--bindings", bindings, "--format", "json",
    ]);
    assert.equal(disguised.status, 2, disguised.stderr || disguised.stdout);
    assert.match(JSON.parse(disguised.stdout).message, /canonical \.vibe input/);

    const oversizedSource = join(temporary, "oversized.vibe");
    writeFileSync(oversizedSource, " ".repeat(2 * 1024 * 1024 + 1));
    const oversized = run("bin/vibe.js", [
      "plan", oversizedSource, "--bindings", bindings, "--format", "json",
    ]);
    assert.equal(oversized.status, 2, oversized.stderr || oversized.stdout);
    assert.match(JSON.parse(oversized.stdout).message, /exceeds 2097152 bytes/);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});

test(".vibe commands fail closed instead of ignoring TypeScript-only options", () => {
  const compile = run("bin/vibe.js", [
    "compile",
    "test/fixtures/basic.vibe",
    "--target",
    "es2020",
    "--format",
    "json",
  ]);
  assert.equal(compile.status, 2);
  assert.equal(JSON.parse(compile.stdout).code, "UNSUPPORTED_VIBE_OPTION");

  const check = run("bin/vibe.js", [
    "check",
    "test/fixtures/basic.vibe",
    "--strict",
    "--format",
    "json",
  ]);
  assert.equal(check.status, 2);
  assert.equal(JSON.parse(check.stdout).code, "UNSUPPORTED_VIBE_OPTION");

  const conflicting = run("bin/vibe.js", [
    "compile",
    "test/fixtures/basic.vibe",
    "--noEmit",
    "--declaration",
    "--format",
    "json",
  ]);
  assert.equal(conflicting.status, 2);
  assert.equal(JSON.parse(conflicting.stdout).code, "CONFLICTING_VIBE_OPTIONS");
});

test(".vibe commands reject mixing .vibe with TypeScript inputs in one invocation", () => {
  const temporary = mkdtempSync(join(tmpdir(), "vibelang-mixed-inputs-"));
  try {
    const typescript = join(temporary, "extra.ts");
    writeFileSync(typescript, "export const extra = 1\n");
    const output = join(temporary, "output");

    const compiled = run("bin/vibe.js", [
      "compile",
      "test/fixtures/basic.vibe",
      typescript,
      "--outDir",
      output,
      "--format",
      "json",
    ]);
    assert.equal(compiled.status, 2, compiled.stderr || compiled.stdout);
    assert.equal(JSON.parse(compiled.stdout).code, "MIXED_FRONTENDS");
    assert.equal(existsSync(output), false);

    const checked = run("bin/vibe.js", [
      "check",
      "test/fixtures/basic.vibe",
      typescript,
      "--format",
      "json",
    ]);
    assert.equal(checked.status, 2, checked.stderr || checked.stdout);
    assert.equal(JSON.parse(checked.stdout).code, "MIXED_FRONTENDS");
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});

test("compile, check, and run use strict bounded UTF-8 project reads", () => {
  const temporary = realpathSync(mkdtempSync(join(tmpdir(), "vibelang-cli-source-bounds-")));
  const output = join(temporary, "output");
  try {
    const invalid = join(temporary, "invalid.vibe");
    writeFileSync(invalid, Buffer.from([0x65, 0x78, 0x70, 0x6f, 0x72, 0x74, 0x20, 0xc3, 0x28]));
    const invocations = [
      ["compile", invalid, "--outDir", output, "--format", "json"],
      ["check", invalid, "--format", "json"],
      ["run", invalid, "--format", "json"],
    ];
    for (const invocation of invocations) {
      const result = run("bin/vibe.js", invocation);
      assert.equal(result.status, 2, result.stderr || result.stdout);
      const report = JSON.parse(result.stdout);
      assert.equal(report.code, "VIBE_PROJECT_ERROR");
      assert.match(report.message, /not valid UTF-8/);
    }

    const oversized = join(temporary, "oversized.vibe");
    writeFileSync(oversized, " ".repeat(2 * 1024 * 1024 + 1));
    const bounded = run("bin/vibe.js", [
      "compile",
      oversized,
      "--outDir",
      output,
      "--format",
      "json",
    ]);
    assert.equal(bounded.status, 2, bounded.stderr || bounded.stdout);
    assert.match(JSON.parse(bounded.stdout).message, /exceeds 2097152 bytes/);
    assert.equal(existsSync(output), false);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});

test(".vibe JavaScript source maps compose back to authored source", () => {
  const output = mkdtempSync(join(tmpdir(), "vibelang-source-map-"));
  try {
    const compiled = run("bin/vibe.js", [
      "compile",
      "test/fixtures/basic.vibe",
      "--outDir",
      output,
      "--sourceMap",
      "--format",
      "json",
    ]);
    assert.equal(compiled.status, 0, compiled.stderr || compiled.stdout);
    const javascript = readFileSync(join(output, "basic.mjs"), "utf8");
    assert.match(javascript, /sourceMappingURL=basic\.mjs\.map/);
    const map = JSON.parse(readFileSync(join(output, "basic.mjs.map"), "utf8"));
    assert.equal(map.version, 3);
    assert.equal(
      resolve(output, map.sources[0]),
      resolve("test/fixtures/basic.vibe"),
    );
    assert.match(map.sourcesContent[0], /class InvalidAnswer/);
    assert.equal(typeof map.mappings, "string");
    assert.notEqual(map.mappings.length, 0);
  } finally {
    rmSync(output, { recursive: true, force: true });
  }
});

test(".vibe CLI lowers checker-owned comptime across the project before compile, check, run, and test", async () => {
  const { readDeclarationEffects } = await import("vibelang/language");
  const project = realpathSync(mkdtempSync(join(tmpdir(), "vibelang-cli-comptime-project-")));
  const output = join(project, "output");
  let cacheIdentity;
  try {
    for (const name of ["config.vibe", "main.vibe", "test.vibe"]) {
      writeFileSync(
        join(project, name),
        readFileSync(join("test/fixtures/comptime", name), "utf8"),
      );
    }

    const compileArgs = [
      "compile",
      join(project, "main.vibe"),
      "--outDir",
      output,
      "--sourceMap",
      "--declaration",
      "--format",
      "json",
    ];
    const cold = run("bin/vibe.js", compileArgs);
    assert.equal(cold.status, 0, cold.stderr || cold.stdout);
    const coldReport = JSON.parse(cold.stdout);
    const coldMain = coldReport.files.find((file) => file.input === join(project, "main.vibe"));
    cacheIdentity = coldMain.comptime.cacheIdentity;
    assert.equal(coldMain.comptime.calls.length, 1);
    assert.equal(coldMain.comptime.calls[0].cacheHit, false);
    assert.deepEqual(coldMain.comptime.provenance.edits.map((edit) => edit.kind), [
      "remove-import",
      "intrinsic-call",
    ]);
    assert.equal(coldMain.comptime.provenance.edits[1].mappedOrigin.file, "config.vibe");
    assert.deepEqual(coldMain.rows.readCompiled, { failures: ["ConfigFailure"], requirements: [] });
    assert.deepEqual(readdirSync(output).sort(), [
      "config.d.mts",
      "config.mjs",
      "config.mjs.map",
      "main.d.mts",
      "main.mjs",
      "main.mjs.map",
    ]);
    const declaration = readFileSync(join(output, "main.d.mts"), "utf8");
    assert.deepEqual(readDeclarationEffects(declaration, join(output, "main.d.mts")).readCompiled, {
      failures: ["ConfigFailure"],
      requirements: [],
    });
    const coldJavascript = readFileSync(join(output, "main.mjs"));
    const coldMap = readFileSync(join(output, "main.mjs.map"));
    assert.doesNotMatch(coldJavascript.toString("utf8"), /vibelang:comptime|staticValue\s*\(/);
    const decodedMap = JSON.parse(coldMap.toString("utf8"));
    assert.equal(decodedMap.x_vibelang_comptime, undefined);
    assert.equal(decodedMap.sourcesContent.some((source) => source.includes("vibelang:comptime")), true);
    assert.deepEqual(
      new Set(decodedMap.sources.map((source) => resolve(output, source))),
      new Set([join(project, "main.vibe"), join(project, "config.vibe")]),
    );

    const warm = run("bin/vibe.js", compileArgs);
    assert.equal(warm.status, 0, warm.stderr || warm.stdout);
    const warmReport = JSON.parse(warm.stdout);
    const warmMain = warmReport.files.find((file) => file.input === join(project, "main.vibe"));
    assert.equal(warmMain.comptime.calls[0].cacheHit, true);
    assert.equal(warmMain.comptime.calls[0].key, coldMain.comptime.calls[0].key);
    assert.equal(warmMain.comptime.calls[0].logicalKey, coldMain.comptime.calls[0].logicalKey);
    assert.equal(warmMain.comptime.identity, coldMain.comptime.identity);
    assert.equal(warmMain.comptime.cacheIdentity, coldMain.comptime.cacheIdentity);
    assert.deepEqual(readFileSync(join(output, "main.mjs")), coldJavascript);
    assert.deepEqual(readFileSync(join(output, "main.mjs.map")), coldMap);

    mkdirSync(join(project, "node_modules"));
    symlinkSync(resolve("."), join(project, "node_modules", "vibelang"), process.platform === "win32" ? "junction" : "dir");
    const loaded = await import(`${pathToFileURL(join(output, "main.mjs")).href}?identity=${warmMain.comptime.identity}`);
    assert.deepEqual(loaded.compiled, { code: 42, message: "comptime cli works" });

    const checked = run("bin/vibe.js", ["check", join(project, "main.vibe"), "--format", "json"]);
    assert.equal(checked.status, 0, checked.stderr || checked.stdout);
    const checkedMain = JSON.parse(checked.stdout).files.find((file) => file.input === join(project, "main.vibe"));
    assert.equal(checkedMain.comptime.calls[0].cacheHit, true);

    const executed = run("bin/vibe.js", ["run", join(project, "main.vibe"), "--format", "json"]);
    assert.equal(executed.status, 0, executed.stderr || executed.stdout);
    assert.equal(JSON.parse(executed.stdout).ok, true);

    const tested = run("bin/vibe.js", ["test", join(project, "test.vibe"), "--format", "json"]);
    assert.equal(tested.status, 0, tested.stderr || tested.stdout);
    assert.equal(JSON.parse(tested.stdout).summary, "1 passed, 0 failed");
  } finally {
    rmSync(project, { recursive: true, force: true });
    if (typeof cacheIdentity === "string" && /^[0-9a-f]{64}$/.test(cacheIdentity)) {
      rmSync(join(tmpdir(), "vibelang-comptime-cache-v1", cacheIdentity), { recursive: true, force: true });
    }
  }
});

test(".vibe CLI executes bounded comptime functions with target, tracked embed, and generated literal types", async () => {
  const project = realpathSync(mkdtempSync(join(tmpdir(), "vibelang-cli-comptime-function-")));
  const output = join(project, "output");
  let cacheIdentity;
  try {
    const input = join(project, "main.vibe");
    writeFileSync(join(project, "config.json"), JSON.stringify({ answer: 42 }));
    writeFileSync(input, [
      `import { comptime, embed } from "vibelang:comptime"`,
      `export const generated = comptime(() => {`,
      `  if (comptime.target === "node-es2022") {`,
      `    const config = JSON.parse(embed("./config.json"))`,
      `    return { target: comptime.target, config }`,
      `  }`,
      `  return process.env.UNSELECTED_COMPTIME_BRANCH`,
      `})()`,
      `const exactTarget: "node-es2022" = generated.target`,
      `const exactAnswer: 42 = generated.config.answer`,
      `export function readGenerated(): number { return generated.config.answer }`,
    ].join("\n"));

    const compiled = run("bin/vibe.js", [
      "compile",
      input,
      "--outDir",
      output,
      "--declaration",
      "--format",
      "json",
    ]);
    assert.equal(compiled.status, 0, compiled.stderr || compiled.stdout);
    const report = JSON.parse(compiled.stdout);
    const file = report.files.find((candidate) => candidate.input === input);
    cacheIdentity = file.comptime.cacheIdentity;
    assert.equal(file.comptime.calls.length, 1);
    assert.deepEqual(file.comptime.calls[0].dependencies.map((dependency) => ({
      path: dependency.path,
      kind: dependency.kind,
      access: dependency.access,
    })), [{ path: "config.json", kind: "file", access: "text" }]);
    const javascript = readFileSync(join(output, "main.mjs"), "utf8");
    assert.doesNotMatch(javascript, /UNSELECTED_COMPTIME_BRANCH|vibelang:comptime|embed\s*\(/);
    const declaration = readFileSync(join(output, "main.d.mts"), "utf8");
    assert.match(declaration, /readonly target: "node-es2022"/);
    assert.match(declaration, /readonly answer: 42/);
    const loaded = await import(`${pathToFileURL(join(output, "main.mjs")).href}?comptime-function`);
    assert.equal(loaded.readGenerated(), 42);
  } finally {
    rmSync(project, { recursive: true, force: true });
    if (typeof cacheIdentity === "string" && /^[0-9a-f]{64}$/.test(cacheIdentity)) {
      rmSync(join(tmpdir(), "vibelang-comptime-cache-v1", cacheIdentity), { recursive: true, force: true });
    }
  }
});

test(".vibe CLI returns intrinsic diagnostics without writing project outputs", () => {
  const output = mkdtempSync(join(tmpdir(), "vibelang-cli-comptime-invalid-"));
  try {
    const compiled = run("bin/vibe.js", [
      "compile",
      "test/fixtures/comptime/invalid.vibe",
      "--outDir",
      output,
      "--format",
      "json",
    ]);
    assert.equal(compiled.status, 1, compiled.stderr || compiled.stdout);
    const report = JSON.parse(compiled.stdout);
    assert.equal(report.ok, false);
    assert.equal(report.files[0].diagnostics.some((diagnostic) => diagnostic.code === "VCT1002"), true);
    assert.deepEqual(readdirSync(output), []);
  } finally {
    rmSync(output, { recursive: true, force: true });
  }
});

test("post-comptime diagnostics map back to authored lines after multiline replacement", () => {
  const project = realpathSync(mkdtempSync(join(tmpdir(), "vibelang-cli-comptime-diagnostic-")));
  const output = realpathSync(mkdtempSync(join(tmpdir(), "vibelang-cli-comptime-diagnostic-output-")));
  const source = readFileSync("test/fixtures/comptime/diagnostic.vibe", "utf8");
  let cacheIdentity;
  try {
    const input = join(project, "diagnostic.vibe");
    writeFileSync(input, source);
    const compiled = run("bin/vibe.js", [
      "compile",
      input,
      "--outDir",
      output,
      "--format",
      "json",
    ]);
    assert.equal(compiled.status, 1, compiled.stderr || compiled.stdout);
    const report = JSON.parse(compiled.stdout);
    const diagnostic = report.files[0].diagnostics.find((item) => item.code === "VIBE3001");
    assert.ok(diagnostic);
    assert.equal(diagnostic.file, input);
    assert.equal(diagnostic.line, source.slice(0, source.indexOf("export function nativePinned")).split("\n").length);
    assert.equal(diagnostic.column, 1);
    assert.equal(report.files[0].comptime.provenance.edits[1].authored.endLine > 3, true);
    assert.equal(existsSync(join(output, "diagnostic.mjs")), false);
    cacheIdentity = report.files[0].comptime.cacheIdentity;
  } finally {
    rmSync(project, { recursive: true, force: true });
    rmSync(output, { recursive: true, force: true });
    if (typeof cacheIdentity === "string" && /^[0-9a-f]{64}$/.test(cacheIdentity)) {
      rmSync(join(tmpdir(), "vibelang-comptime-cache-v1", cacheIdentity), { recursive: true, force: true });
    }
  }
});

test(".vibe output moved to an outDir keeps relative imports resolvable", () => {
  const output = mkdtempSync(join(tmpdir(), "vibelang-relative-import-"));
  try {
    const compiled = run("bin/vibe.js", [
      "compile",
      "test/fixtures/relative-import.vibe",
      "--outDir",
      output,
      "--format",
      "json",
    ]);
    assert.equal(compiled.status, 0, compiled.stderr || compiled.stdout);

    const executed = run(join(output, "relative-import.mjs"), []);
    assert.equal(executed.status, 0, executed.stderr || executed.stdout);
  } finally {
    rmSync(output, { recursive: true, force: true });
  }
});

test(".vibe stages and executes a bounded mixed TypeScript/JavaScript runtime graph", () => {
  const output = mkdtempSync(join(tmpdir(), "vibelang-foreign-runtime-"));
  try {
    const args = [
      "compile",
      "test/fixtures/foreign-runtime/main.vibe",
      "--outDir",
      output,
      "--declaration",
      "--sourceMap",
      "--format",
      "json",
    ];
    const cold = run("bin/vibe.js", args);
    assert.equal(cold.status, 0, cold.stderr || cold.stdout);
    const report = JSON.parse(cold.stdout);
    assert.equal(report.ok, true);
    assert.deepEqual(report.files[0].rows.foreignSummary, {
      failures: ["Panic"],
      requirements: ["TypeScript"],
    });

    const coldTree = snapshotTree(output);
    const foreignRoot = "__vibelang_foreign__/lib";
    for (const name of [
      "trusted.mjs",
      "nested.mjs",
      "view.mjs",
      "plain.mjs",
      "plain-jsx.mjs",
      "module.mjs",
      "modern.mjs",
      "dynamic.mjs",
      "external.mjs",
      "legacy.cjs",
      "nested.cjs",
      "common.cjs",
      "common-nested.cjs",
    ]) assert.ok(coldTree[`${foreignRoot}/${name}`], `missing staged foreign output ${name}`);
    assert.equal(Object.keys(coldTree).some((name) => name.includes("types-only")), false);
    assert.match(coldTree["main.mjs"].toString("utf8"), /\.\/__vibelang_foreign__\/lib\/trusted\.mjs/);
    assert.match(coldTree[`${foreignRoot}/trusted.mjs`].toString("utf8"), /\.\/nested\.mjs/);
    assert.match(coldTree[`${foreignRoot}/dynamic.mjs`].toString("utf8"), /import\("\.\/nested\.mjs"\)/);
    assert.match(coldTree[`${foreignRoot}/common.cjs`].toString("utf8"), /require\("\.\/common-nested\.cjs"\)/);
    assert.match(coldTree[`${foreignRoot}/external.mjs`].toString("utf8"), /from "node:path"/);
    assert.match(coldTree[`${foreignRoot}/trusted.d.mts`].toString("utf8"), /trustedTs\(\): string/);
    const foreignMap = JSON.parse(coldTree[`${foreignRoot}/trusted.mjs.map`].toString("utf8"));
    assert.equal(foreignMap.version, 3);
    assert.match(foreignMap.sourcesContent[0], /unsafeTs\(value: string\)/);

    const warm = run("bin/vibe.js", args);
    assert.equal(warm.status, 0, warm.stderr || warm.stdout);
    const warmTree = snapshotTree(output);
    assert.deepEqual(Object.keys(warmTree).sort(), Object.keys(coldTree).sort());
    for (const name of Object.keys(coldTree)) assert.deepEqual(warmTree[name], coldTree[name], name);

    const checked = run("bin/vibe.js", [
      "check",
      "test/fixtures/foreign-runtime/main.vibe",
      "--format",
      "json",
    ]);
    assert.equal(checked.status, 0, checked.stderr || checked.stdout);
    assert.equal(JSON.parse(checked.stdout).ok, true);

    const executed = run("bin/vibe.js", [
      "run",
      "test/fixtures/foreign-runtime/main.vibe",
      "--format",
      "json",
    ]);
    assert.equal(executed.status, 0, executed.stderr || executed.stdout);
    assert.equal(JSON.parse(executed.stdout).ok, true);

    const tested = run("bin/vibe.js", [
      "test",
      "test/fixtures/foreign-runtime/test.vibe",
      "--format",
      "json",
    ]);
    assert.equal(tested.status, 0, tested.stderr || tested.stdout);
    assert.equal(JSON.parse(tested.stdout).summary, "1 passed, 0 failed");
  } finally {
    rmSync(output, { recursive: true, force: true });
  }
});

test("foreign module initialization fails closed while a dynamic-import adapter stays on the async panic boundary", () => {
  const temporary = mkdtempSync(join(tmpdir(), "vibelang-module-init-"));
  const staticProject = join(temporary, "static");
  const dynamicProject = join(temporary, "dynamic");
  try {
    for (const project of [staticProject, dynamicProject]) mkdirSync(project, { recursive: true });
    writeFileSync(join(staticProject, "main.vibe"), `
      import { value } from "./adapter.ts"
      export function read(): number { return value }
    `);
    writeFileSync(join(staticProject, "adapter.ts"), `
      /** @module @throws {never} */
      import { nested } from "./nested.ts"
      export const value = nested
    `);
    writeFileSync(join(staticProject, "nested.ts"), "export const nested = 1\n");
    const staticOutput = join(staticProject, "output");
    const rejected = run("bin/vibe.js", [
      "compile",
      join(staticProject, "main.vibe"),
      "--outDir",
      staticOutput,
      "--format",
      "json",
    ]);
    assert.equal(rejected.status, 1, rejected.stderr || rejected.stdout);
    const rejectedReport = JSON.parse(rejected.stdout);
    const diagnostic = rejectedReport.files[0].diagnostics.find((item) => item.code === "VIBE1510");
    assert.ok(diagnostic);
    assert.equal(diagnostic.file, realpathSync(join(staticProject, "nested.ts")));
    assert.equal(existsSync(join(staticOutput, "main.mjs")), false);

    writeFileSync(join(dynamicProject, "main.vibe"), `
      import { load } from "./adapter.ts"
      export async function read(): Promise<Result<string, Panic>> {
        return (await load()).unwrap()
      }
    `);
    writeFileSync(join(dynamicProject, "adapter.ts"), `
      /** @module @throws {never} */
      export async function load(): Promise<string> {
        const loaded = await import("./nested.ts")
        return loaded.value
      }
    `);
    writeFileSync(join(dynamicProject, "nested.ts"), `
      export const value = "never reached"
      throw new Error("captured by import rejection")
    `);
    const dynamicOutput = join(dynamicProject, "output");
    const accepted = run("bin/vibe.js", [
      "compile",
      join(dynamicProject, "main.vibe"),
      "--outDir",
      dynamicOutput,
      "--format",
      "json",
    ]);
    assert.equal(accepted.status, 0, accepted.stderr || accepted.stdout);
    const acceptedReport = JSON.parse(accepted.stdout);
    assert.equal(acceptedReport.files[0].diagnostics.some((item) => item.code === "VIBE1510"), false);
    assert.equal(existsSync(join(dynamicOutput, "main.mjs")), true);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});

test("mixed runtime graph resolution fails closed without changing output", () => {
  const temporary = mkdtempSync(join(tmpdir(), "vibelang-foreign-adversarial-"));
  try {
    const reject = (name, files, pattern, prepare) => {
      const project = join(temporary, name);
      const output = join(project, "output");
      mkdirSync(project, { recursive: true });
      mkdirSync(output);
      writeFileSync(join(output, "sentinel.txt"), "preserve");
      for (const [fileName, source] of Object.entries(files)) {
        const destination = join(project, fileName);
        mkdirSync(resolve(destination, ".."), { recursive: true });
        writeFileSync(destination, source);
      }
      prepare?.(project);
      const compiled = run("bin/vibe.js", [
        "compile",
        join(project, "main.vibe"),
        "--outDir",
        output,
        "--format",
        "json",
      ]);
      assert.equal(compiled.status, 2, compiled.stderr || compiled.stdout);
      const report = JSON.parse(compiled.stdout);
      assert.equal(report.code, "VIBE_PROJECT_ERROR");
      assert.match(report.message, pattern);
      assert.deepEqual(snapshotTree(output), { "sentinel.txt": Buffer.from("preserve") });
    };

    reject("dynamic", {
      "main.vibe": 'import { value } from "./dynamic.ts"\nexport const result = value\n',
      "dynamic.ts": 'const target = "./value.ts"\nexport const value = import(target)\n',
      "value.ts": "export const value = 1\n",
    }, /module specifier must be a string literal/);

    reject("vibe-dynamic", {
      "main.vibe": 'export const pending = import("./value.ts")\n',
      "value.ts": "export const value = 1\n",
    }, /Vibe dynamic import is deferred/);

    reject("esm-require", {
      "main.vibe": 'import { value } from "./value.ts"\nexport const result = value\n',
      "value.ts": 'export const value = require("node:path")\n',
    }, /ESM sources cannot use require/);

    reject("aliased-require", {
      "main.vibe": 'import value from "./value.cjs"\nexport const result = value\n',
      "value.cjs": 'const load = require\nmodule.exports = load("./nested.cjs")\n',
      "nested.cjs": "module.exports = 1\n",
    }, /require may not be aliased/);

    reject("outside/project", {
      "main.vibe": 'import { value } from "../outside.ts"\nexport const result = value\n',
      "../outside.ts": "export const value = 1\n",
    }, /outside the project root/);

    reject("outside-type/project", {
      "main.vibe": 'import type { Secret } from "./types.ts"\nexport const value: Secret = "ok"\n',
      "types.ts": 'export type { Secret } from "../secret.ts"\n',
      "../secret.ts": 'export type Secret = "ok"\n',
    }, /checker dependency is outside the project root/);

    reject("collision", {
      "main.vibe": 'import { one } from "./same.ts"\nimport { two } from "./same.mts"\nexport const value = one + two\n',
      "same.ts": "export const one = 1\n",
      "same.mts": "export const two = 2\n",
    }, /runtime outputs collide/);

    reject("invalid-utf8", {
      "main.vibe": 'import { value } from "./invalid.ts"\nexport const result = value\n',
      "invalid.ts": Buffer.from([0xff, 0xfe]),
    }, /not valid UTF-8/);

    reject("oversized", {
      "main.vibe": 'import "./large.ts"\n',
      "large.ts": Buffer.alloc(2 * 1024 * 1024 + 1, 0x20),
    }, /exceeds 2097152 bytes/);

    reject("symlink", {
      "main.vibe": 'import { real } from "./real.ts"\nimport { real as alias } from "./alias.ts"\nexport const value = real + alias\n',
      "real.ts": "export const real = 1\n",
    }, /symbolic-link alias/, (project) => {
      symlinkSync(join(project, "real.ts"), join(project, "alias.ts"));
    });

    reject("hardlink", {
      "main.vibe": 'import { real } from "./real.ts"\nimport { real as alias } from "./alias.ts"\nexport const value = real + alias\n',
      "real.ts": "export const real = 1\n",
    }, /hard-link aliases/, (project) => {
      linkSync(join(project, "real.ts"), join(project, "alias.ts"));
    });
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});

test(".vibe CLI discovers, checks, and emits a cross-module project graph", async () => {
  const { readDeclarationEffects } = await import("vibelang/language");
  const output = mkdtempSync(join(tmpdir(), "vibelang-project-"));
  try {
    const checked = run("bin/vibe.js", [
      "check",
      "test/fixtures/project/main.vibe",
      "--format",
      "json",
    ]);
    assert.equal(checked.status, 0, checked.stderr || checked.stdout);
    const checkedReport = JSON.parse(checked.stdout);
    assert.equal(checkedReport.ok, true);
    assert.equal(checkedReport.files.length, 2);
    const main = checkedReport.files.find((file) => file.input.endsWith("/project/main.vibe"));
    assert.deepEqual(main.rows.run, { failures: ["Missing"], requirements: [] });

    const compiled = run("bin/vibe.js", [
      "compile",
      "test/fixtures/project/main.vibe",
      "--outDir",
      output,
      "--declaration",
      "--format",
      "json",
    ]);
    assert.equal(compiled.status, 0, compiled.stderr || compiled.stdout);
    assert.equal(existsSync(join(output, "main.mjs")), true);
    assert.equal(existsSync(join(output, "service.mjs")), true);
    assert.equal(existsSync(join(output, "main.d.mts")), true);
    assert.equal(existsSync(join(output, "service.d.mts")), true);
    assert.match(readFileSync(join(output, "main.mjs"), "utf8"), /from "\.\/service\.mjs"/);
    const mainDeclaration = readFileSync(join(output, "main.d.mts"), "utf8");
    assert.match(mainDeclaration, /run\(\): Result<string, Missing>/);
    assert.match(mainDeclaration, /@vibeEffects/);
    assert.deepEqual(readDeclarationEffects(mainDeclaration, join(output, "main.d.mts")).run, {
      failures: ["Missing"],
      requirements: [],
    });
  } finally {
    rmSync(output, { recursive: true, force: true });
  }

  const executed = run("bin/vibe.js", ["run", "test/fixtures/project/main.vibe"]);
  assert.equal(executed.status, 0, executed.stderr || executed.stdout);
});

test(".vibe project compilation fails closed before writing any module", () => {
  const output = mkdtempSync(join(tmpdir(), "vibelang-project-error-"));
  try {
    const compiled = run("bin/vibe.js", [
      "compile",
      "test/fixtures/project/missing-import.vibe",
      "--outDir",
      output,
      "--format",
      "json",
    ]);
    assert.equal(compiled.status, 1, compiled.stderr || compiled.stdout);
    const report = JSON.parse(compiled.stdout);
    assert.equal(report.ok, false);
    assert.equal(report.files[0].diagnostics.some((item) => item.code === "VIBE1801"), true);
    assert.equal(existsSync(join(output, "missing-import.mjs")), false);
  } finally {
    rmSync(output, { recursive: true, force: true });
  }
});

test(".vibe compilation enforces checker-backed native portability pins", () => {
  const output = mkdtempSync(join(tmpdir(), "vibelang-native-pin-"));
  try {
    const compiled = run("bin/vibe.js", [
      "compile",
      "test/fixtures/project/invalid-native.vibe",
      "--outDir",
      output,
      "--format",
      "json",
    ]);
    assert.equal(compiled.status, 1, compiled.stderr || compiled.stdout);
    const report = JSON.parse(compiled.stdout);
    assert.equal(report.files[0].diagnostics.some((item) => item.code === "VIBE3001"), true);
    assert.equal(existsSync(join(output, "invalid-native.mjs")), false);
  } finally {
    rmSync(output, { recursive: true, force: true });
  }
});

test(".vibe compilation rejects colliding outputs before writing", () => {
  const output = mkdtempSync(join(tmpdir(), "vibelang-output-collision-"));
  try {
    const compiled = run("bin/vibe.js", [
      "compile",
      "test/fixtures/basic.vibe",
      "test/fixtures/basic.vibe",
      "--outDir",
      output,
      "--format",
      "json",
    ]);
    assert.equal(compiled.status, 2);
    assert.equal(JSON.parse(compiled.stdout).code, "DUPLICATE_VIBE_OUTPUT");
    assert.equal(existsSync(join(output, "basic.mjs")), false);
  } finally {
    rmSync(output, { recursive: true, force: true });
  }
});

test(".vibe compilation rejects a symlinked output ancestor without escaping outDir", () => {
  if (process.platform === "win32") return;
  const temporary = realpathSync(mkdtempSync(join(tmpdir(), "vibelang-output-symlink-")));
  try {
    const sourceRoot = join(temporary, "source");
    const sourceDirectory = join(sourceRoot, "nested");
    const output = join(temporary, "output");
    const outside = join(temporary, "outside");
    mkdirSync(sourceDirectory, { recursive: true });
    mkdirSync(output);
    mkdirSync(outside);
    const source = join(sourceDirectory, "main.vibe");
    writeFileSync(source, "export const answer = 42\n");
    symlinkSync(outside, join(output, "nested"), "dir");

    const compiled = run("bin/vibe.js", [
      "compile",
      source,
      "--rootDir",
      sourceRoot,
      "--outDir",
      output,
      "--format",
      "json",
    ]);
    assert.equal(compiled.status, 2, compiled.stderr || compiled.stdout);
    assert.match(JSON.parse(compiled.stdout).message, /output parent must be a real directory/);
    assert.equal(existsSync(join(outside, "main.mjs")), false);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});

test("inspect does not apply .vibe semantics silently to TypeScript files", () => {
  const inspected = run("bin/vibe.js", [
    "inspect",
    "test/fixtures/basic.ts",
    "--format",
    "json",
  ]);
  assert.equal(inspected.status, 2);
  assert.equal(JSON.parse(inspected.stdout).code, "INVALID_INPUT");
});

// VibeLang's expression-oriented control flow (`defer`/`errdefer`, a
// declaration in a conditional, value-position `if`/`switch`, a labeled block
// value, and a loop value with `else`) does not parse under stock TypeScript.
// The CLI runs three passes over authored `.vibe` text before the checked
// frontend sees it — the source-asset import preflight, the comptime intrinsic
// frontend, and the target portability analysis — and every one of them has to
// run the frontend's pre-parse recovery first.
const DIVERGENT_FORMS_FIXTURE = resolve("poc/examples/language/divergent-forms.vibe");
const DIVERGENT_FORMS_HOST = resolve("poc/examples/language/foreign.ts");

function stageDivergentForms() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "vibelang-cli-divergent-")));
  copyFileSync(DIVERGENT_FORMS_FIXTURE, join(root, "divergent-forms.vibe"));
  copyFileSync(DIVERGENT_FORMS_HOST, join(root, "foreign.ts"));
  return root;
}

const DIVERGENT_FORMS_OUTPUT = [
  "ada met the bar weighted=106",
  "missing zoe",
  "firstPassing=78",
  "events=scoreOf:ada:done,scoreOf:zoe:failed,scoreOf:zoe:done",
].join("\n");

test("expression-oriented .vibe source checks, inspects, compiles, runs, and tests", () => {
  const root = stageDivergentForms();
  const source = join(root, "divergent-forms.vibe");
  const output = join(root, "output");
  try {
    const checked = run("bin/vibe.js", ["check", source, "--format", "json"]);
    assert.equal(checked.status, 0, checked.stderr || checked.stdout);
    const checkReport = JSON.parse(checked.stdout);
    assert.equal(checkReport.ok, true);
    assert.deepEqual(checkReport.files[0].diagnostics, []);
    assert.deepEqual(checkReport.files[0].rows.scoreOf, { failures: ["Missing"], requirements: [] });

    // The portability pass builds its own checked Program over the same
    // authored text. Without recovery it read a shredded AST — stock
    // TypeScript parses a value-position `if` as an identifier — and the run
    // never reached it, because the asset preflight had already rejected the
    // module with the parser's TS1109 cascade.
    const inspected = run("bin/vibe.js", ["inspect", source, "--format", "json"]);
    assert.equal(inspected.status, 0, inspected.stderr || inspected.stdout);
    const inspection = JSON.parse(inspected.stdout);
    assert.equal(inspection.ok, true);
    assert.deepEqual(inspection.files[0].portability.diagnostics, []);
    assert.deepEqual(Object.keys(inspection.files[0].portability.functions).sort(), [
      "classify",
      "combine",
      "describe",
      "firstPassing",
      "lookup",
      "record",
      "scoreOf",
      "testDivergentForms",
      "weighted",
    ]);

    const compiled = run("bin/vibe.js", [
      "compile", source, "--outDir", output, "--declaration", "--sourceMap", "--format", "json",
    ]);
    assert.equal(compiled.status, 0, compiled.stderr || compiled.stdout);
    assert.equal(JSON.parse(compiled.stdout).ok, true);
    assert.equal(existsSync(join(output, "divergent-forms.mjs")), true);
    assert.equal(existsSync(join(output, "divergent-forms.mjs.map")), true);
    const declaration = readFileSync(join(output, "divergent-forms.d.mts"), "utf8");
    assert.match(declaration, /export declare function scoreOf\(key: string\): Result<number, Missing>;/);
    assert.match(declaration, /export declare function firstPassing\(scores: number\[\]\): number;/);
    const map = JSON.parse(readFileSync(join(output, "divergent-forms.mjs.map"), "utf8"));
    assert.equal(map.sources.length, 1);
    assert.match(map.sources[0], /divergent-forms\.vibe$/);
    assert.equal(map.sourcesContent[0], readFileSync(source, "utf8"));

    // The end-to-end proof: the emitted module executes, and `defer`,
    // `errdefer`, the labeled block value, and the loop `else` value all
    // produce the values the authored module names.
    const executed = run("bin/vibe.js", ["run", source]);
    assert.equal(executed.status, 0, executed.stderr || executed.stdout);
    assert.equal(executed.stdout.startsWith(`${DIVERGENT_FORMS_OUTPUT}\n`), true, executed.stdout);
    assert.match(executed.stdout, /ok: true/);

    const tested = run("bin/vibe.js", ["test", source, "--format", "json"]);
    assert.equal(tested.status, 0, tested.stderr || tested.stdout);
    const testReport = JSON.parse(tested.stdout);
    assert.equal(testReport.summary, "1 passed, 0 failed");
    assert.deepEqual(testReport.tests.map((item) => item.ok), [true]);
    assert.match(testReport.tests[0].name, /#testDivergentForms$/);
    assert.equal(testReport.output, `${DIVERGENT_FORMS_OUTPUT}\n`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("pre-pass diagnostics keep authored positions across a recovery rewrite", () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "vibelang-cli-authored-position-")));
  try {
    // Recovering the value-position `if` on line 6 hoists a compiler temporary
    // ahead of its containing statement, so every later construct sits one
    // line further down in the text the pre-passes actually parse. Both
    // diagnostics below must still name the AUTHORED line.
    const source = join(root, "main.vibe");
    writeFileSync(root + "/data.json", "{}\n");
    writeFileSync(
      source,
      [
        "function combine(value: number): number {",
        "  return value",
        "}",
        "",
        "export function pick(flag: boolean): number {",
        "  return combine(if (flag) { 1 } else { 2 })",
        "}",
        "",
        "export async function load(): Promise<unknown> {",
        '  return await import("./data.json")',
        "}",
        "",
      ].join("\n"),
    );

    const checked = run("bin/vibe.js", ["check", source, "--format", "json"]);
    assert.equal(checked.status, 1, checked.stderr || checked.stdout);
    const report = JSON.parse(checked.stdout);
    assert.deepEqual(report.files[0].diagnostics.map((item) => ({
      code: item.code,
      line: item.line,
      column: item.column,
    })), [{ code: "VIBE5201", line: 10, column: 16 }]);

    // The portability pass reports through the same recovery map.
    const portable = join(root, "portable.vibe");
    writeFileSync(
      portable,
      [
        "function combine(value: number): number {",
        "  return value",
        "}",
        "",
        "export function pick(flag: boolean): number {",
        "  return combine(if (flag) { 1 } else { 2 })",
        "}",
        "",
        "export function cast(value: unknown): number {",
        "  return value as number",
        "}",
        "",
      ].join("\n"),
    );
    const portabilityChecked = run("bin/vibe.js", ["check", portable, "--format", "json"]);
    assert.equal(portabilityChecked.status, 0, portabilityChecked.stderr || portabilityChecked.stdout);
    const portabilityReport = JSON.parse(portabilityChecked.stdout);
    assert.deepEqual(portabilityReport.files[0].diagnostics.map((item) => ({
      code: item.code,
      severity: item.severity,
      line: item.line,
      column: item.column,
    })), [{ code: "VIBE3004", severity: "warning", line: 10, column: 10 }]);
    // Lowering still cuts the module from its AUTHORED text, so a file with no
    // comptime call is byte-identical before and after the frontend runs.
    assert.equal(
      portabilityReport.files[0].comptime.provenance.authoredDigest,
      portabilityReport.files[0].comptime.provenance.loweredDigest,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("VibeLang syntax the frontend cannot recover fails closed, never as raw TS noise", () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "vibelang-cli-unrecoverable-")));
  try {
    // A value loop with no `else` completion value has no value on the path
    // where no `break :label value` runs, so recovery refuses it by name.
    const source = join(root, "loop.vibe");
    writeFileSync(
      source,
      [
        "export function firstPassing(scores: number[]): number {",
        "  const found = search: for (const score of scores) {",
        "    if (score >= 60) break :search score",
        "  }",
        "  return found",
        "}",
        "",
      ].join("\n"),
    );

    const checked = run("bin/vibe.js", ["check", source, "--format", "json"]);
    assert.equal(checked.status, 1, checked.stderr || checked.stdout);
    const diagnostics = JSON.parse(checked.stdout).files[0].diagnostics;
    assert.deepEqual(diagnostics.map((item) => ({ code: item.code, line: item.line, column: item.column })), [
      { code: "VIBE1715", line: 2, column: 17 },
    ]);
    assert.match(diagnostics[0].message, /requires an `else` completion value/);
    assert.equal(diagnostics.some((item) => item.code.startsWith("TS")), false);

    const inspected = run("bin/vibe.js", ["inspect", source, "--format", "json"]);
    assert.equal(inspected.status, 1, inspected.stderr || inspected.stdout);
    const inspection = JSON.parse(inspected.stdout);
    assert.equal(inspection.code, "VIBE_ASSET_IMPORT");
    assert.deepEqual(inspection.assets.diagnostics.map((item) => item.code), ["VIBE1715"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
