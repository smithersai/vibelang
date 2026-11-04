import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { checkProperty } from "../../../../scripts/testing/property.mjs";
import { SpecPath } from "../../../../scripts/testing/spec-path.mjs";

const repo = fileURLToPath(new URL("../../../../", import.meta.url));
const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url));
const fc = require("fast-check");
const implementation = process.env.SCHEMA_GATE_UNDER_TEST || new URL("../lib/diagnostics.mjs", import.meta.url).href;
const { parseDiagnostics, styleProblems } = await import(implementation);
const literal = JSON.parse(readFileSync(new URL("./corpus/t3code-schema-constructor-gate.json", import.meta.url), "utf8"));
const rule = "A `Schema.TaggedError` class stays a class when EK4837 says it has no quick fix";
const native = process.env.VIBELANG_BINARY || [join(repo, "packages/compiler/native/vibelang"), join(repo, "typescript/built/local/tsc")].find(existsSync);

test("schema constructor gate quotes the retained-class contract", () => {
  assert.ok(readFileSync(new URL("../rules.md", import.meta.url), "utf8").includes(rule));
  assert.ok(readFileSync(SpecPath("003-failures.md"), "utf8").includes("a constructor in an `error` or `schema error` body"));
  assert.ok(readFileSync(SpecPath("007-tooling.md"), "utf8").includes("`vibelang --fix` retains its safety checks and refusal rules."));
});

test("T3code: the actual native constructor fixture compiles and keeps its refused-class warning", () => {
  assert.ok(native, "build the checkout compiler or set VIBELANG_BINARY");
  const root = realpathSync(mkdtempSync(join(tmpdir(), "schema-constructor-gate-")));
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
    const diagnostics = parseDiagnostics(run.stdout + run.stderr);
    assert.ok(diagnostics.some(d => d.code === "EK4837" && d.notes.some(n => n.startsWith("No quick fix"))));
    assert.ok(diagnostics.some(d => d.code === "EK4814" && d.category === "warning"));
    assert.deepEqual(styleProblems(diagnostics, ["main.vibe"]), []);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

function check(input) {
  const cls = "E" + input.name;
  const ctorClass = input.sameClass ? cls : cls + "Other";
  const classFile = "src/group" + input.directory + "/schema.vibe";
  const ctorFile = input.sameFile ? classFile : "src/elsewhere/schema.vibe";
  const classDiagnostic = [
    classFile + "(2,14): warning EK4837: " + cls + " extends Schema.TaggedError; a schema error declaration writes the same failure with its Schema.",
    input.refused ? "  No quick fix: a schema error’s body keeps accessors and annotated methods." : "  Its quick fix writes a schema error declaration."
  ].join(input.newline);
  const ctorDiagnostic = ctorFile + "(3,3): " + input.category + " EK4814: " + ctorClass + " overrides the constructor of a Schema class, which decoding does not call.";
  const unrelated = ctorFile + "(8,1): warning EK4815: unrelated style finding.";
  const blocks = input.reverse ? [unrelated, ctorDiagnostic, classDiagnostic] : [classDiagnostic, ctorDiagnostic, unrelated];
  const diagnostics = parseDiagnostics(blocks.join(input.newline) + input.newline);
  const files = input.selected ? [...new Set([classFile, ctorFile])] : ["src/not-selected.vibe"];
  const actual = styleProblems(diagnostics, files);
  // The retained source class, not another class/file or an error, owns the exemption.
  const preservedConstructor = input.refused && input.sameClass && input.sameFile && input.category !== "error";
  assert.equal(actual.some(d => d.code === "EK4814"), input.selected && !preservedConstructor);
  assert.equal(actual.some(d => d.code === "EK4815"), input.selected, "unrelated style findings must remain");
  assert.equal(actual.some(d => d.code === "EK4837"), input.selected && !input.refused);
}

test("property: retained schema constructors keep class, file, category and batch scope", async () => {
  await checkProperty(fc, {
    name: "MigrationSchemaConstructorGate", rule,
    command: "node --test packages/compiler/test/migrate-schema-constructor.property.test.mjs",
    regressions: new URL("./corpus/", import.meta.url), numRuns: 120,
    arbitrary: fc.record({
      name: fc.integer({ min: 0, max: 50 }), directory: fc.integer({ min: 0, max: 5 }),
      sameClass: fc.boolean(), sameFile: fc.boolean(), refused: fc.boolean(),
      selected: fc.boolean(), reverse: fc.boolean(),
      category: fc.constantFrom("warning", "error", "suggestion"), newline: fc.constantFrom("\n", "\r\n")
    }), check
  });
});
