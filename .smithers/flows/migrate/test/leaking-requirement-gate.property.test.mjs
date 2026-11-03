import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { checkProperty } from "../../../../scripts/testing/property.mjs";
import { SpecPath } from "../../../../scripts/testing/spec-path.mjs";

// alchemy-42: alchemy's demos `Links` service declares RuntimeContext on every
// member. `vibelang --fix` converts the class to a service declaration, and
// what is left is EK4809, advice to drop the requirement from the members,
// which would change the published declaration. The style gate keeps it.
const repo = fileURLToPath(new URL("../../../../", import.meta.url));
const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url));
const fc = require("fast-check");
const implementation = process.env.LEAKING_REQUIREMENT_GATE_UNDER_TEST || new URL("../lib/diagnostics.mjs", import.meta.url).href;
const { parseDiagnostics, styleProblems } = await import(implementation);
const literal = JSON.parse(readFileSync(new URL("./corpus/alchemy-links-leaking-requirement.json", import.meta.url), "utf8"));
const rule = "A service whose members all need one requirement keeps it: EK4809 is design advice, and its member contracts are the published declaration verify holds to the TypeScript's, so verify accepts the warning.";
const native = process.env.VIBELANG_BINARY || [join(repo, "packages/compiler/native/vibelang"), join(repo, "typescript/built/local/tsc")].find(existsSync);

test("leaking-requirement gate quotes its rule and the declaration contract", () => {
  assert.ok(readFileSync(new URL("../rules.md", import.meta.url), "utf8").includes(rule));
  assert.ok(readFileSync(SpecPath("001-functions.md"), "utf8").includes("Declarations are exactly what idiomatic Effect TypeScript would declare."));
});

test("Alchemy: the converted Links service keeps its EK4809 and passes the style gate", () => {
  assert.ok(native, "build the checkout compiler or set VIBELANG_BINARY");
  const root = realpathSync(mkdtempSync(join(tmpdir(), "leaking-requirement-gate-")));
  try {
    mkdirSync(join(root, "node_modules"));
    const modules = process.env.EFFECT_NODE_MODULES || join(repo, "experiments/node_modules");
    symlinkSync(realpathSync(join(modules, "effect")), join(root, "node_modules/effect"));
    symlinkSync(join(repo, "packages/runtime"), join(root, "node_modules/vibelang-runtime"));
    writeFileSync(join(root, "package.json"), '{"type":"module"}');
    writeFileSync(join(root, "main.vibe"), literal.vibe);
    writeFileSync(join(root, "tsconfig.json"), JSON.stringify({ compilerOptions: {
      module: "NodeNext", moduleResolution: "NodeNext", target: "ES2022",
      strict: true, skipLibCheck: true, noEmit: true, types: []
    }, files: ["main.vibe"] }));
    const run = spawnSync(native, ["-p", "tsconfig.json", "--noEmit", "--pretty", "false"], { cwd: root, encoding: "utf8", timeout: 120000 });
    assert.equal(run.status, 0, run.stdout + run.stderr);
    const diagnostics = parseDiagnostics(run.stdout + run.stderr).filter(d => d.code !== "EK4803");
    assert.deepEqual(diagnostics.map(d => d.code), ["EK4809"], run.stdout);
    assert.deepEqual(styleProblems(diagnostics, ["main.vibe"]), literal.styleProblems);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

function check(input) {
  const file = "src/group" + input.directory + "/service.vibe";
  const leak = file + "(" + input.line + ",16): " + input.category + " EK4809: Every member of S" + input.name + " needs " + input.requirement + ", so each caller must provide it.";
  const notes = input.withNotes ? input.newline + "  Read " + input.requirement + " where the layer is built, and drop it from the members' contracts." : "";
  // Other EK48xx lint rules and TypeScript-style forms stay problems.
  const neighbour = file + "(9,3): warning " + input.neighbour + ": unrelated finding.";
  const blocks = input.reverse ? [neighbour, leak + notes] : [leak + notes, neighbour];
  const diagnostics = parseDiagnostics(blocks.join(input.newline) + input.newline);
  const actual = styleProblems(diagnostics, input.selected ? [file] : ["src/not-selected.vibe"]);
  assert.equal(actual.some(d => d.code === "EK4809"), input.selected && input.category === "error");
  assert.equal(actual.some(d => d.code === input.neighbour), input.selected, "neighbouring style findings must remain");
}

test("property: EK4809 warnings pass, an EK4809 error and every other style finding stay", async () => {
  await checkProperty(fc, {
    name: "MigrationLeakingRequirementGate", rule,
    command: "node --test packages/compiler/test/migrate-leaking-requirement.property.test.mjs",
    regressions: new URL("./corpus/", import.meta.url), numRuns: 120,
    arbitrary: fc.record({
      name: fc.integer({ min: 0, max: 50 }), directory: fc.integer({ min: 0, max: 5 }), line: fc.integer({ min: 1, max: 400 }),
      requirement: fc.constantFrom("RuntimeContext", "Alchemy.RuntimeContext", "SqlClient | Scope"),
      category: fc.constantFrom("warning", "error"), withNotes: fc.boolean(),
      neighbour: fc.constantFrom("EK4807", "EK4810", "EK4815", "EK4831", "EK4833", "EK4402"),
      selected: fc.boolean(), reverse: fc.boolean(), newline: fc.constantFrom("\n", "\r\n")
    }), check
  });
});
