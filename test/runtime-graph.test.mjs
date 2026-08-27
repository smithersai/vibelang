import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import test from "node:test";

// The relative runtime graph is a compiler-internal module with no package
// subpath: `smthrs/*` deliberately publishes no compiler internals. It is
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
  const root = realpathSync(mkdtempSync(join(tmpdir(), `smithers-graph-${name}-`)));
  return { root, outDir: join(root, "output") };
}

function smithersSeed(root, name, source) {
  const fileName = join(root, name);
  mkdirSync(join(fileName, ".."), { recursive: true });
  writeFileSync(fileName, source);
  return { fileName, source, bytes: Buffer.byteLength(source, "utf8") };
}

function generatedAsset(outDir, logicalKey, source, resolutionAliases = []) {
  return {
    sourceFileName: `.smithers-generated/assets/${logicalKey}.ts`,
    source,
    outputFileName: join(outDir, "__smithers_assets__", `${logicalKey}.mjs`),
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

    const seed = smithersSeed(
      root,
      "main.sm",
      'import config from "./config.json" with { type: "json" }\nexport const answer = config\n',
    );
    const graph = buildRelativeRuntimeGraph({
      rootDir: root,
      outDir,
      smithersSources: [seed],
      smithersOutputs: [{ sourceFileName: seed.fileName, outputFileName: join(outDir, "main.mjs") }],
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
      assert.equal(file.outputFileName, join(outDir, "__smithers_assets__", `${logicalKey}.mjs`));
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

test("a Smithers module may re-export a generated asset", () => {
  const { root, outDir } = workspace("re-export");
  try {
    const seed = smithersSeed(
      root,
      "main.sm",
      'export { answer } from "./config.json" with { type: "json", mode: "const" }\n',
    );
    const graph = buildRelativeRuntimeGraph({
      rootDir: root,
      outDir,
      smithersSources: [seed],
      smithersOutputs: [{ sourceFileName: seed.fileName, outputFileName: join(outDir, "main.mjs") }],
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
    const seed = smithersSeed(root, "main.sm", [
      "export async function readLater(): Promise<number> {",
      '  const config = await import("./config.json", { with: { type: "json", mode: "const" } })',
      "  return config.default.answer",
      "}",
      "",
    ].join("\n"));
    const graph = buildRelativeRuntimeGraph({
      rootDir: root,
      outDir,
      smithersSources: [seed],
      smithersOutputs: [{ sourceFileName: seed.fileName, outputFileName: join(outDir, "main.mjs") }],
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
    const rewritten = graph.rewriteSmithersRuntimeCalls(emitted, authored, output);
    assert.match(rewritten, new RegExp(`import\\("\\./__smithers_assets__/${key(0)}\\.mjs"\\)`));

    // Whichever stage restates the specifier first, running the rewrite again is
    // a no-op rather than an "unresolved dynamic import" failure.
    assert.equal(graph.rewriteSmithersRuntimeCalls(rewritten, authored, output), rewritten);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a Smithers dynamic import that is not a generated asset is still deferred", () => {
  const { root, outDir } = workspace("deferred");
  try {
    writeFileSync(join(root, "plain.ts"), "export const value = 1\n");
    const seed = smithersSeed(root, "main.sm", [
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
        smithersSources: [seed],
        smithersOutputs: [{ sourceFileName: seed.fileName, outputFileName: join(outDir, "main.mjs") }],
        budget: BUDGET,
      }),
      /Smithers dynamic import is deferred/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a type-only edge to a generated asset is rejected", () => {
  const { root, outDir } = workspace("type-only");
  try {
    const seed = smithersSeed(
      root,
      "main.sm",
      'import type config from "./config.json" with { type: "json" }\nexport type Config = typeof config\n',
    );
    assert.throws(
      () => buildRelativeRuntimeGraph({
        rootDir: root,
        outDir,
        smithersSources: [seed],
        smithersOutputs: [{ sourceFileName: seed.fileName, outputFileName: join(outDir, "main.mjs") }],
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
    const seed = smithersSeed(root, "main.sm", "export const answer = 1\n");
    const build = (source) => buildRelativeRuntimeGraph({
      rootDir: root,
      outDir,
      smithersSources: [seed],
      smithersOutputs: [{ sourceFileName: seed.fileName, outputFileName: join(outDir, "main.mjs") }],
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
    const seed = smithersSeed(root, "main.sm", "export const answer = 1\n");
    assert.throws(
      () => buildRelativeRuntimeGraph({
        rootDir: root,
        outDir,
        smithersSources: [seed],
        smithersOutputs: [{ sourceFileName: seed.fileName, outputFileName: join(outDir, "main.mjs") }],
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

// ---------------------------------------------------------------------------
// Module-initialization trust: the marker, and which edges demand it.
//
// This walk is the ONLY implementation of the module-initialization trust rule
// that follows the graph transitively — `checkForeignModuleInitializers` in the
// reference and `checkForeignModuleTrust` in the fork both iterate the authored
// `.sm`'s own statements — so every module reached at depth two or more is
// judged here and nowhere else. Both defects these tests pin were measured
// running an untrusted foreign initializer on a project that reported ok: true.
// ---------------------------------------------------------------------------

/**
 * `main.sm` reaches `sneaky<ext>` through `depth - 1` marker-carrying hops, so
 * the authored Smithers source only ever imports trusted code and the graph is
 * the only thing that can refuse the unmarked module.
 */
function trustChain(name, { header, extension = ".ts", depth = 2, carrier }) {
  const { root, outDir } = workspace(name);
  const reach = (target) => extension === ".cts"
    ? `const ${target} = require("./${target}.cjs");\nexport const value = ${target};\n`
    : `import * as ${target} from "./${target}${extension}";\nexport const value = ${target};\n`;
  const sneakySpecifier = extension === ".cts" ? "./sneaky.cjs" : `./sneaky${extension}`;
  writeFileSync(
    join(root, `sneaky${extension}`),
    `${header === undefined ? "" : `${header}\n`}export const secret = 7;\n`,
  );
  const hops = [];
  if (depth >= 2) {
    hops.push(["carrier", carrier === undefined ? reach("sneaky") : carrier.replaceAll("%SPEC%", sneakySpecifier)]);
  }
  for (let level = 3; level <= depth; level += 1) hops.push([`hop${level}`, reach(level === 3 ? "carrier" : `hop${level - 1}`)]);
  for (const [module, body] of hops) writeFileSync(join(root, `${module}${extension}`), `${MARKER}\n${body}`);
  const entry = hops.length === 0 ? `sneaky${extension}` : `${hops.at(-1)[0]}${extension}`;
  const seed = smithersSeed(root, "main.sm", `import "./${entry}"\nexport const answer = 1\n`);
  try {
    const graph = buildRelativeRuntimeGraph({
      rootDir: root,
      outDir,
      smithersSources: [seed],
      smithersOutputs: [{ sourceFileName: seed.fileName, outputFileName: join(outDir, "main.mjs") }],
      budget: BUDGET,
    });
    return graph.diagnostics.map((diagnostic) => `${diagnostic.code}@${basename(diagnostic.fileName)}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const NBSP = " ";
const BOM = "﻿";

test("the module trust marker is read with the exact case the specification prints, at every depth", () => {
  // Every one of these was accepted at depth two while being refused at depth
  // one, because this site — alone among the four implementations of the rule —
  // carried `/i`. `@throws {Never}` is the second production of the `@throws`
  // syntax, not the opt-out, and a JSDoc tag name is not case-folded either.
  const miscased = [
    "/** @MODULE @throws {never} */",
    "/** @Module @throws {never} */",
    "/** @mOdUlE @throws {never} */",
    "/** @modulE @throws {never} */",
    "/** @module @THROWS {never} */",
    "/** @module @Throws {never} */",
    "/** @module @throwS {never} */",
    "/** @module @throws {Never} */",
    "/** @module @throws {NEVER} */",
    "/** @module @throws {nEvEr} */",
  ];
  for (const header of miscased) {
    for (const depth of [1, 2, 3]) {
      assert.deepEqual(
        trustChain("miscased", { header, depth }),
        ["SMITHERS1510@sneaky.ts"],
        `${header} at depth ${depth}`,
      );
    }
  }
  for (const depth of [1, 2, 3]) {
    assert.deepEqual(trustChain("exact", { header: MARKER, depth }), [], `the exact marker at depth ${depth}`);
  }
});

test("the module trust marker must be a JSDoc comment, not a substring of the leading text", () => {
  const refused = [
    ["a line comment containing the marker text", "// /** @module @throws {never} */"],
    ["a plain block comment containing the marker text", "/* /** @module @throws {never} */"],
    ["a block comment that is not JSDoc", "/* @module @throws {never} */"],
    ["a marker written after the first statement", "export const first = 0;\n/** @module @throws {never} */"],
    ["@moduleResolution, which claims nothing", "/** @moduleResolution bundler @throws {never} */"],
    ["a marker split across a JSDoc decoration", "/**\n * @throws\n * {never}\n * @module\n */"],
  ];
  for (const [description, header] of refused) {
    for (const depth of [1, 2]) {
      assert.deepEqual(trustChain("comment-kind", { header, depth }), ["SMITHERS1510@sneaky.ts"], `${description} at depth ${depth}`);
    }
  }

  const accepted = [
    ["the compact one-line form", MARKER],
    ["a decorated multi-line header", "/**\n * @module\n * @throws {never}\n */"],
    ["a decorated header above a second JSDoc block", "/**\n * @module\n * @throws {never}\n */\n\n/** @throws {never} */"],
    ["an empty JSDoc above the real marker", "/**/\n/** @module @throws {never} */"],
    ["an ordinary line comment above the real marker", "// an ordinary note\n/** @module @throws {never} */"],
    ["a shebang above the real marker", "#!/usr/bin/env node\n/** @module @throws {never} */"],
  ];
  for (const [description, header] of accepted) {
    for (const depth of [1, 2]) {
      assert.deepEqual(trustChain("comment-kind-ok", { header, depth }), [], `${description} at depth ${depth}`);
    }
  }
});

test("JSDoc whitespace inside the trust marker is exactly space, tab, carriage return and newline", () => {
  // `\s` also matches NBSP, form feed, vertical tab and the BOM, and the fork's
  // `isJSDocWhitespace` accepts four bytes and no more. `{<NBSP>never<NBSP>}`
  // names a type whose spelling is not `never`, so it is a declared channel and
  // not the opt-out — the same argument that makes `{Never}` a near miss.
  for (const [description, header] of [
    ["a non-breaking space inside the braces", `/** @module @throws {${NBSP}never${NBSP}} */`],
    ["a non-breaking space after @module", `/** @module${NBSP}@throws {never} */`],
    ["a form feed inside the braces", "/** @module @throws {\fnever\f} */"],
    ["a vertical tab inside the braces", "/** @module @throws {\vnever\v} */"],
    ["a byte-order mark inside the braces", `/** @module @throws {${BOM}never${BOM}} */`],
  ]) {
    assert.deepEqual(trustChain("marker-space", { header, depth: 2 }), ["SMITHERS1510@sneaky.ts"], description);
  }
  for (const [description, header] of [
    ["tabs between the tags", "/** @module\t@throws\t{never} */"],
    // Newlines and spaces, but no `*` decoration: `split-trust-marker.ts` in
    // the corpus pins that a `*` between the tag and the brace is a near miss,
    // and it stays one — it is covered by the JSDoc-comment test above.
    ["newlines and spaces inside the braces", "/** @module @throws {\n   never\n   } */"],
    ["a CRLF decorated header", "/**\r\n * @module\r\n * @throws {never}\r\n */"],
  ]) {
    assert.deepEqual(trustChain("marker-space-ok", { header, depth: 2 }), [], description);
  }
});

test("an edge is a module-initialization edge unless it is proven deferred", () => {
  // The unmarked module carries no marker in every row; what varies is how the
  // marker-carrying module reaches it. `init` means module evaluation reaches
  // the edge, so the unmarked module must be refused. Each of the six spellings
  // marked "was fail-open" below was measured checking clean and executing the
  // untrusted initializer before 2026-08-27.
  const esm = [
    ["init", `import { secret } from "%SPEC%";\nexport const value = secret;`],
    ["init", `import "%SPEC%";\nexport const value = 1;`],
    ["init", `export * from "%SPEC%";`],
    ["init", `export { secret } from "%SPEC%";`],
    ["init", `const m = await import("%SPEC%");\nexport const value = m.secret;`],            // was fail-open
    ["init", `const p = import("%SPEC%");\nvoid p;\nexport const value = 1;`],                // was fail-open
    ["init", `export const value = await (async () => (await import("%SPEC%")).secret)();`],  // was fail-open
    ["init", `try { await import("%SPEC%"); } catch { /* ignore */ }\nexport const value = 1;`],
    ["init", `if (String(1) === "1") { await import("%SPEC%"); }\nexport const value = 1;`],
    ["init", `class Holder { static v = import("%SPEC%"); }\nexport const value = Holder.v;`],
    ["init", `const loaders = [() => import("%SPEC%")];\nexport const value = loaders.length;`],
    ["init", `async function load() { return (await import("%SPEC%")).secret; }\nexport const value = load();`],
    ["init", `export async function load() { return (await import("%SPEC%")).secret; }\nexport const eager = load();`],
    ["init", `export class Adapter { async load() { return (await import("%SPEC%")).secret; } }\nexport const eager = new Adapter();`],
    ["deferred", `export async function load() { return (await import("%SPEC%")).secret; }`],
    ["deferred", `export const load = async () => (await import("%SPEC%")).secret;`],
    ["deferred", `async function load() { return (await import("%SPEC%")).secret; }\nexport { load };`],
    ["deferred", `export class Adapter { async load() { return (await import("%SPEC%")).secret; } }`],
    ["deferred", `export default async function () { return (await import("%SPEC%")).secret; }`],
    ["deferred", `export function makeLoader() { return () => import("%SPEC%"); }`],
    ["deferred", `export async function outer() { return await (async () => (await import("%SPEC%")).secret)(); }`],
  ];
  const cjs = [
    ["init", `const loaded = require("%SPEC%");\nexport const value = loaded.secret;`],
    ["init", `let loaded;\ntry { loaded = require("%SPEC%"); } catch { loaded = { secret: 0 }; }\nexport const value = loaded.secret;`],
    ["init", `class Holder { static v = require("%SPEC%"); }\nexport const value = Holder.v.secret;`],
    ["init", `import loaded = require("%SPEC%");\nexport const value = loaded.secret;`],
    ["init", `const loaded = (() => require("%SPEC%"))();\nexport const value = loaded.secret;`],                       // was fail-open
    ["init", `function load() { return require("%SPEC%"); }\nconst loaded = load();\nexport const value = loaded.secret;`], // was fail-open
    ["init", `const holder = { get v() { return require("%SPEC%"); } };\nconst loaded = holder.v;\nexport const value = loaded.secret;`], // was fail-open
    ["init", `export function load() { return require("%SPEC%"); }\nexport const eager = load();`],
    ["init", `export const holder = { load: () => require("%SPEC%") };`],
    ["deferred", `export function load() { return require("%SPEC%"); }`],
    ["deferred", `export const load = () => require("%SPEC%");`],
    ["deferred", `function load() { return require("%SPEC%"); }\nexport { load };`],
    ["deferred", `export class Adapter { load() { return require("%SPEC%"); } }`],
    ["deferred", `export default function () { return require("%SPEC%"); }`],
    ["deferred", `export function load(pending: unknown = require("%SPEC%")) { return pending; }`],
    ["deferred", `export function outer() { return (() => require("%SPEC%"))(); }`],
  ];
  for (const [extension, rows] of [[".ts", esm], [".mts", esm], [".cts", cjs]]) {
    for (const [expected, carrier] of rows) {
      const observed = trustChain("edge-kind", { extension, depth: 2, carrier });
      assert.deepEqual(
        observed,
        expected === "init" ? [`SMITHERS1510@sneaky${extension}`] : [],
        `${extension}: ${carrier.split("\n")[0]}`,
      );
    }
  }
});
