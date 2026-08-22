import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import test from "node:test";

// The relative runtime graph is a compiler-internal module with no package
// subpath: `vibelang/*` deliberately publishes no compiler internals. It is
// still root-owned code the CLI composes, so it is exercised from its build
// output the way the CLI loads it.
const { buildRelativeRuntimeGraph, transpileRelativeRuntimeGraph } = await import(
  "../dist/relative-runtime-graph.js"
);

const BUDGET = Object.freeze({
  maximumFileBytes: 2 * 1024 * 1024,
  maximumTotalBytes: 16 * 1024 * 1024,
  maximumFiles: 1_024,
});

const MARKER = "/** @module @throws {never} */";
const key = (index) => String(index).repeat(2).padStart(64, "0abcdef");

function workspace(name) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), `vibelang-graph-${name}-`)));
  return { root, outDir: join(root, "output") };
}

function vibeSeed(root, name, source) {
  const fileName = join(root, name);
  mkdirSync(join(fileName, ".."), { recursive: true });
  writeFileSync(fileName, source);
  return { fileName, source, bytes: Buffer.byteLength(source, "utf8") };
}

function generatedAsset(outDir, logicalKey, source, resolutionAliases = []) {
  return {
    sourceFileName: `.vibelang-generated/assets/${logicalKey}.ts`,
    source,
    outputFileName: join(outDir, "__vibelang_assets__", `${logicalKey}.mjs`),
    resolutionAliases,
  };
}

function fileNamed(graph, name) {
  const found = graph.files.find((file) => basename(file.fileName) === name);
  assert.notEqual(found, undefined, `graph is missing ${name}`);
  return found;
}

test("a nested generated asset graph rewrites every sibling edge onto the emitted layout", () => {
  const { root, outDir } = workspace("nested");
  try {
    // Depth 0 is the authored import; each further level is a loader-declared
    // generated module edge, which the asset compiler bounds at four.
    const keys = [key(0), key(1), key(2), key(3), key(4)];
    const generated = keys.map((logicalKey, index) => {
      const child = keys[index + 1];
      const source = child
        ? `${MARKER}\nimport child from "./${child}.ts";\nconst value = [${index}, child];\nexport default value;\n`
        : `${MARKER}\nconst value = [${index}];\nexport default value;\n`;
      return generatedAsset(outDir, logicalKey, source, index === 0 ? ["config.json"] : []);
    });

    const seed = vibeSeed(
      root,
      "main.vibe",
      'import config from "./config.json" with { type: "json" }\nexport const answer = config\n',
    );
    const graph = buildRelativeRuntimeGraph({
      rootDir: root,
      outDir,
      vibeSources: [seed],
      vibeOutputs: [{ sourceFileName: seed.fileName, outputFileName: join(outDir, "main.mjs") }],
      generatedRuntimeSources: generated,
      budget: BUDGET,
    });

    assert.deepEqual(graph.diagnostics, []);
    assert.equal(graph.files.length, keys.length);
    assert.equal(graph.fileCount, keys.length + 1);

    for (const [index, logicalKey] of keys.entries()) {
      const file = fileNamed(graph, `${logicalKey}.ts`);
      const child = keys[index + 1];
      if (child) {
        // Both ends live in the same generated output directory, so the sibling
        // edge is restated as a plain extension swap.
        assert.match(file.rewrittenSource, new RegExp(`from "\\./${child}\\.mjs"`));
        assert.doesNotMatch(file.rewrittenSource, new RegExp(`from "\\./${child}\\.ts"`));
      } else {
        assert.equal(file.rewrittenSource, file.source);
      }
      assert.equal(file.outputFileName, join(outDir, "__vibelang_assets__", `${logicalKey}.mjs`));
    }

    for (const output of graph.additionalRuntimeOutputs) {
      assert.equal(output.stripImportAttributes, true);
    }

    const transpiled = transpileRelativeRuntimeGraph(graph, { sourceMap: false });
    assert.deepEqual(transpiled.diagnostics, []);
    const rootModule = transpiled.files.find((file) => basename(file.fileName) === `${keys[0]}.ts`);
    assert.match(rootModule.code, new RegExp(`from ['"]\\./${keys[1]}\\.mjs['"]`));
    assert.match(rootModule.declarationCode, new RegExp(`\\./${keys[1]}\\.mjs`));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a Vibe module may re-export a generated asset", () => {
  const { root, outDir } = workspace("re-export");
  try {
    const seed = vibeSeed(
      root,
      "main.vibe",
      'export { answer } from "./config.json" with { type: "json", mode: "const" }\n',
    );
    const graph = buildRelativeRuntimeGraph({
      rootDir: root,
      outDir,
      vibeSources: [seed],
      vibeOutputs: [{ sourceFileName: seed.fileName, outputFileName: join(outDir, "main.mjs") }],
      generatedRuntimeSources: [generatedAsset(
        outDir,
        key(0),
        `${MARKER}\nconst value = { answer: 42 };\nexport default value;\n`,
        ["config.json"],
      )],
      budget: BUDGET,
    });

    assert.deepEqual(graph.diagnostics, []);
    assert.equal(graph.files.length, 1);
    // A generated asset is never a static-initialization trust root: the
    // compiler wrote its whole body.
    assert.deepEqual(graph.files[0].resolutionAliases, [join(root, "config.json")]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a literal dynamic asset import resolves and its emitted specifier is restated once", () => {
  const { root, outDir } = workspace("dynamic");
  try {
    const seed = vibeSeed(root, "main.vibe", [
      "export async function readLater(): Promise<number> {",
      '  const config = await import("./config.json", { with: { type: "json", mode: "const" } })',
      "  return config.default.answer",
      "}",
      "",
    ].join("\n"));
    const graph = buildRelativeRuntimeGraph({
      rootDir: root,
      outDir,
      vibeSources: [seed],
      vibeOutputs: [{ sourceFileName: seed.fileName, outputFileName: join(outDir, "main.mjs") }],
      generatedRuntimeSources: [generatedAsset(
        outDir,
        key(0),
        `${MARKER}\nconst value = { answer: 42 };\nexport default value;\n`,
        ["config.json"],
      )],
      budget: BUDGET,
    });
    assert.deepEqual(graph.diagnostics, []);

    const authored = seed.fileName;
    const output = join(outDir, "main.mjs");
    const emitted = 'export async function readLater() {\n  const config = await import("./config.json");\n  return config.default.answer;\n}\n';
    const rewritten = graph.rewriteVibeRuntimeCalls(emitted, authored, output);
    assert.match(rewritten, new RegExp(`import\\("\\./__vibelang_assets__/${key(0)}\\.mjs"\\)`));

    // Whichever stage restates the specifier first, running the rewrite again is
    // a no-op rather than an "unresolved dynamic import" failure.
    assert.equal(graph.rewriteVibeRuntimeCalls(rewritten, authored, output), rewritten);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a Vibe dynamic import that is not a generated asset is still deferred", () => {
  const { root, outDir } = workspace("deferred");
  try {
    writeFileSync(join(root, "plain.ts"), "export const value = 1\n");
    const seed = vibeSeed(root, "main.vibe", [
      "export async function load(): Promise<number> {",
      '  const module = await import("./plain.ts")',
      "  return module.value",
      "}",
      "",
    ].join("\n"));
    assert.throws(
      () => buildRelativeRuntimeGraph({
        rootDir: root,
        outDir,
        vibeSources: [seed],
        vibeOutputs: [{ sourceFileName: seed.fileName, outputFileName: join(outDir, "main.mjs") }],
        budget: BUDGET,
      }),
      /Vibe dynamic import is deferred/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a type-only edge to a generated asset is rejected", () => {
  const { root, outDir } = workspace("type-only");
  try {
    const seed = vibeSeed(
      root,
      "main.vibe",
      'import type config from "./config.json" with { type: "json" }\nexport type Config = typeof config\n',
    );
    assert.throws(
      () => buildRelativeRuntimeGraph({
        rootDir: root,
        outDir,
        vibeSources: [seed],
        vibeOutputs: [{ sourceFileName: seed.fileName, outputFileName: join(outDir, "main.mjs") }],
        generatedRuntimeSources: [generatedAsset(
          outDir,
          key(0),
          `${MARKER}\nconst value = { answer: 42 };\nexport default value;\n`,
          ["config.json"],
        )],
        budget: BUDGET,
      }),
      /compiler-generated assets require a static import, a re-export, or a literal dynamic import/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a generated asset module may only import a sibling generated module", () => {
  const { root, outDir } = workspace("edges");
  try {
    const seed = vibeSeed(root, "main.vibe", "export const answer = 1\n");
    const build = (source) => buildRelativeRuntimeGraph({
      rootDir: root,
      outDir,
      vibeSources: [seed],
      vibeOutputs: [{ sourceFileName: seed.fileName, outputFileName: join(outDir, "main.mjs") }],
      generatedRuntimeSources: [generatedAsset(outDir, key(0), source)],
      budget: BUDGET,
    });

    assert.throws(
      () => build(`${MARKER}\nimport { readFileSync } from "node:fs";\nconst value = readFileSync;\nexport default value;\n`),
      /may only import a sibling generated module/,
    );
    assert.throws(
      () => build(`${MARKER}\nexport { value } from "./${key(1)}.ts";\n`),
      /may only import a sibling generated module/,
    );
    assert.throws(
      () => build(`${MARKER}\nimport child from "./${key(9)}.ts";\nconst value = child;\nexport default value;\n`),
      /references an unissued generated module/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("generated asset modules may not form an import cycle", () => {
  const { root, outDir } = workspace("cycle");
  try {
    const seed = vibeSeed(root, "main.vibe", "export const answer = 1\n");
    assert.throws(
      () => buildRelativeRuntimeGraph({
        rootDir: root,
        outDir,
        vibeSources: [seed],
        vibeOutputs: [{ sourceFileName: seed.fileName, outputFileName: join(outDir, "main.mjs") }],
        generatedRuntimeSources: [
          generatedAsset(outDir, key(0), `${MARKER}\nimport child from "./${key(1)}.ts";\nconst value = child;\nexport default value;\n`),
          generatedAsset(outDir, key(1), `${MARKER}\nimport child from "./${key(0)}.ts";\nconst value = child;\nexport default value;\n`),
        ],
        budget: BUDGET,
      }),
      /form an import cycle/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
