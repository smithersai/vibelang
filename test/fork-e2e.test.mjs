/**
 * End-to-end proof of the flagship VibeLang compiler pipeline.
 *
 *   authored `.vibe`
 *     -> native SDK lowering (`compileProject` through its Bun host)
 *        plus its version-3 authored -> lowered source map
 *     -> a protocol v2 `CompileRequest` with `lowering: "external"`
 *     -> `cmd/vibec-go --request` against the pinned Go TypeScript fork
 *     -> emitted JavaScript executed by this Node process
 *
 * Everything runs in temporary directories: nothing is written into the
 * repository or into the pinned checkout. The whole file skips with an
 * actionable message when the checkout, bun, or Go is unavailable, so
 * `npm test` stays green on machines that have not fetched the fork.
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import test, { after } from "node:test";

import {
  FrontendCompilationRefused,
  locateForkCheckout,
  runEmitted,
  runPipeline,
} from "../scripts/fork-e2e.mjs";
import { decodeMappings, originalPositionFor, positionOf } from "../scripts/fork-e2e/source-map.mjs";

const fixtureDirectory = new URL("../scripts/fork-e2e/fixtures/", import.meta.url);
const hostModule = new URL("../scripts/fork-e2e/host.ts", import.meta.url);

function missingTool(command, argument) {
  const probe = spawnSync(command, [argument], { encoding: "utf8" });
  return probe.error || probe.status !== 0
    ? `${command} is required for the fork end-to-end pipeline test`
    : undefined;
}

const forkCheckout = await locateForkCheckout();
const skip =
  (forkCheckout
    ? undefined
    : "pinned smithersai/TypeScript checkout is absent; run `node scripts/prepare-typescript-fork.mjs --fetch --cache /private/tmp/vibelang-ts-fork-cache` or set VIBELANG_TYPESCRIPT_FORK") ??
  missingTool("bun", "--version") ??
  missingTool("go", "version");

/** One shared bridge-binary cache keeps the four pipeline runs cheap. */
let sharedCache;
const temporaryDirectories = [];

async function temporaryDirectory(prefix) {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

after(async () => {
  await Promise.all(temporaryDirectories.map((directory) => rm(directory, { recursive: true, force: true })));
});

async function fixture(name) {
  const text = await readFile(new URL(name, fixtureDirectory), "utf8");
  // These script-owned fixtures intentionally remain outside this migration's
  // write scope. The test exercises their VibeLang program after applying the
  // source migration it owns.
  return { path: name, text: text.replaceAll(".unwrap()", "!") };
}

async function compile({ sources, typeScriptSources = [], ...rest }) {
  sharedCache ??= await temporaryDirectory("vibelang-fork-e2e-cache-");
  return runPipeline({
    sources,
    typeScriptSources,
    forkCheckout,
    forkCache: sharedCache,
    outDir: await temporaryDirectory("vibelang-fork-e2e-"),
    ...rest,
  });
}

/** The happy-path program is shared by the emit/execute and map round-trip tests. */
let happyPath;
async function happyPathPipeline() {
  happyPath ??= await compile({
    sources: [await fixture("order.vibe"), await fixture("stock.vibe")],
    typeScriptSources: [{ path: "host.ts", text: await readFile(hostModule, "utf8") }],
  });
  return happyPath;
}

test("authored .vibe compiles through the pinned fork and the emitted JavaScript runs", { skip }, async () => {
  const pipeline = await happyPathPipeline();

  assert.deepEqual(pipeline.frontendDiagnostics, [], "the frontend must accept the fixture");
  assert.deepEqual(pipeline.result.diagnostics, [], "the pinned fork must accept the lowered TypeScript");
  assert.equal(pipeline.result.emitSkipped, false);
  assert.equal(pipeline.exitCode, 0);

  assert.deepEqual(
    [...pipeline.artifacts.keys()].sort(),
    [
      "host.js",
      "host.js.map",
      "order.js",
      "order.js.map",
      "vibelang-runtime.js",
      "vibelang-runtime.js.map",
      "stock.js",
      "stock.js.map",
    ].sort(),
    "one emitted module and map per project input",
  );

  // The lowering is genuinely non-identity: `throw` became an explicit Result
  // failure and postfix `!` became an expression-position abort request.
  const stock = pipeline.artifacts.get("stock.js");
  assert.match(stock, /__vsResultFailure\(new OutOfStock\(sku\)\)/);
  assert.match(stock, /__vsResultSuccess\(available - wanted\)/);
  const order = pipeline.artifacts.get("order.js");
  assert.match(order, /yield\* __vsPropagate\(reserve\(sku, wanted, available\),/);
  assert.match(order, /__vsRunResult\(function\*/);
  assert.ok(!order.includes("unwrap()"), "retired unwrap must not survive into the runtime");

  // The bridge owns the `.vibe` -> `.js` runtime specifier rewrite.
  assert.ok(pipeline.lowered["order.vibe"].text.includes('from "./stock.vibe"'));
  assert.match(order, /from "\.\/stock\.js"/);
  assert.ok(!order.includes(".vibe\""), "no `.vibe` specifier may survive into runtime JavaScript");

  const executed = await runEmitted(pipeline.emitDirectory, "order.js");
  assert.equal(executed.code, 0, executed.stderr);
  assert.equal(
    executed.stdout,
    "widget: reserved 3, 7 left\ngizmo: rejected\n",
    "the emitted program's observable output",
  );
});

test("a type error in a propagation operand is refused at its authored .vibe position before emit", { skip }, async () => {
  const broken = await fixture("broken.vibe");
  const stock = await fixture("stock.vibe");
  const authored = positionOf(broken.text, '"plenty"');
  await assert.rejects(compile({ sources: [broken, stock] }), error => {
    assert.ok(error instanceof FrontendCompilationRefused, String(error));
    assert.deepEqual(error.diagnostics.map(issue => issue.code), ["TS2345"]);
    const diagnostic = error.diagnostics[0];
    assert.equal(diagnostic.severity, "error");
    assert.equal(diagnostic.fileName, "broken.vibe");
    assert.equal(diagnostic.start, authored.offset);
    assert.deepEqual([diagnostic.line, diagnostic.column], [authored.line + 1, authored.column + 1]);
    return true;
  });
  // Authored line 4, column 42 in 1-based editor coordinates.
  assert.equal(authored.line + 1, 4);
  assert.equal(authored.column + 1, 42);
});

test("an authored token round-trips authored -> lowered -> emitted through both maps", { skip }, async () => {
  const pipeline = await happyPathPipeline();
  const authoredText = (await fixture("order.vibe")).text;
  const loweredText = pipeline.lowered["order.vibe"].text;
  const loweredMap = pipeline.lowered["order.vibe"].sourceMap;
  const emittedText = pipeline.artifacts.get("order.js");
  const emittedMap = pipeline.artifacts.get("order.js.map");

  // The composed runtime map names the authored `.vibe` file and embeds its text.
  const parsedEmittedMap = JSON.parse(emittedMap);
  assert.equal(parsedEmittedMap.version, 3);
  assert.equal(parsedEmittedMap.sources.length, 1);
  assert.equal(basename(parsedEmittedMap.sources[0]), "order.vibe");
  assert.equal(parsedEmittedMap.sourcesContent[0], authoredText);

  for (const token of ["reserved ", "error.sku"]) {
    const authored = positionOf(authoredText, token);
    const lowered = positionOf(loweredText, token);
    const emitted = positionOf(emittedText, token);

    // Stage 1: the frontend's authored -> lowered map.
    const viaFrontend = originalPositionFor(loweredMap, lowered.line, lowered.column);
    assert.ok(viaFrontend, `frontend map left ${token} unmapped`);
    assert.equal(basename(viaFrontend.source), "order.vibe");
    assert.deepEqual(
      [viaFrontend.line, viaFrontend.column],
      [authored.line, authored.column],
      `frontend map for ${token}`,
    );

    // Stage 2: the fork's composed emitted -> authored map, which folded the
    // supplied map in and accounted for the `.vibe` specifier rewrite.
    const viaComposed = originalPositionFor(emittedMap, emitted.line, emitted.column);
    assert.ok(viaComposed, `composed map left ${token} unmapped`);
    assert.equal(basename(viaComposed.source), "order.vibe");
    assert.deepEqual(
      [viaComposed.line, viaComposed.column],
      [authored.line, authored.column],
      `composed map for ${token}`,
    );
  }

  // Every composed mapping must stay inside both the emitted and authored texts.
  const emittedLines = emittedText.split("\n");
  const authoredLines = authoredText.split("\n");
  const decoded = decodeMappings(parsedEmittedMap.mappings);
  assert.ok(decoded.length <= emittedLines.length);
  for (const [line, segments] of decoded.entries()) {
    for (const segment of segments) {
      assert.ok(
        segment.generatedColumn <= emittedLines[line].length,
        `composed mapping ${line}:${segment.generatedColumn} is outside the emitted line`,
      );
      if (segment.source === undefined) continue;
      assert.equal(segment.source, 0);
      assert.ok(
        segment.originalLine < authoredLines.length &&
          segment.originalColumn <= authoredLines[segment.originalLine].length,
        `composed mapping points outside the authored text: ${JSON.stringify(segment)}`,
      );
    }
  }
});

test("a lowered map that lies about sourcesContent is rejected fail-closed", { skip }, async () => {
  const pipeline = await compile({
    sources: [await fixture("order.vibe"), await fixture("stock.vibe")],
    typeScriptSources: [{ path: "host.ts", text: await readFile(hostModule, "utf8") }],
    corruptLowered: ({ path, text, sourceMap }) => {
      if (path !== "order.vibe") return { text, sourceMap };
      const map = JSON.parse(sourceMap);
      map.sourcesContent = ["// not the authored order.vibe text\n"];
      return { text, sourceMap: JSON.stringify(map) };
    },
  });

  assert.equal(pipeline.result.emitSkipped, true);
  assert.equal(pipeline.artifacts.size, 0);
  assert.equal(pipeline.exitCode, 1);
  const rejection = pipeline.result.diagnostics.find((item) => item.code === "VIBE0004");
  assert.ok(rejection, `missing VIBE0004 in ${JSON.stringify(pipeline.result.diagnostics)}`);
  assert.equal(rejection.category, "error");
  assert.equal(rejection.phase, "lower");
  assert.match(rejection.message, /order\.vibe/);
  assert.match(rejection.message, /sourcesContent does not match the supplied authored text/);
});
