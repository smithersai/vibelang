import { test } from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";
import ts from "typescript";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { missingRootAlternatives, checkSidecarRoots, checkSidecarRootText } from "./spec-sidecar-roots.mjs";

function declarationPaths(project, shared) {
  const files = new Map([[`/repo/${project}/src/local.ts`, "export const local = 1;"],
    [`/repo/${shared}/remote.ts`, "export const remote = 2;"]]);
  const options = { declaration: true, emitDeclarationOnly: true, noLib: true,
    declarationDir: `/repo/${project}/.vibe/declarations`, target: ts.ScriptTarget.ES2022 };
  const host = ts.createCompilerHost(options);
  host.getCurrentDirectory = () => "/repo/" + project;
  host.fileExists = path => files.has(path);
  host.readFile = path => files.get(path);
  host.getSourceFile = (path, version) => files.has(path) ? ts.createSourceFile(path, files.get(path), version) : undefined;
  const output = [];
  host.writeFile = path => output.push(path);
  const program = ts.createProgram([...files.keys()], options, host);
  program.emit();
  return { root: program.getCommonSourceDirectory(), output };
}
test("r18 config-relative-only contract omits TypeScript root selection", () => {
  assert.equal(missingRootAlternatives("sidecarDir holds every sidecar at its source's path under the config's directory").length, 3);
  assert.deepEqual(missingRootAlternatives("explicit rootDir; composite config directory; otherwise common source directory"), []);
});
test("VIP and option table state the same root alternatives and qualify the example", () => {
  assert.deepEqual(checkSidecarRoots(fileURLToPath(new URL("../design/", import.meta.url))), []);
});
test("TypeScript 5.9.3 outside-source witness uses the common root", () => {
  assert.equal(ts.version, "5.9.3");
  assert.deepEqual(declarationPaths("app", "shared"), { root: "/repo/", output: [
    "/repo/app/.vibe/declarations/app/src/local.d.ts",
    "/repo/app/.vibe/declarations/shared/remote.d.ts"
  ] });
});
test("fast-check source-directory mutations keep native declaration placement", () => {
  fc.assert(fc.property(fc.constantFrom("app", "project", "package"),
    fc.constantFrom("shared", "common", "lib"), (project, shared) => {
      const result = declarationPaths(project, shared);
      assert.equal(result.root, "/repo/");
      assert.deepEqual(result.output, [
        `/repo/${project}/.vibe/declarations/${project}/src/local.d.ts`,
        `/repo/${project}/.vibe/declarations/${shared}/remote.d.ts`
      ]);
    }), { seed: 183, numRuns: 50 });
});

test("fast-check: moving layout out of the table retains every source-root requirement", () => {
  const vip = readFileSync(new URL("../design/vips/0027-declaration-output.md", import.meta.url), "utf8");
  const tooling = readFileSync(new URL("../design/src/007-tooling.md", import.meta.url), "utf8");
  const paragraph = tooling.split("\n\n").find(p => p.startsWith("Sidecar placement follows TypeScript"));
  fc.assert(fc.property(
    fc.constantFrom("rootDir", "composite", "common source directory"),
    fc.stringMatching(/^[A-Za-z ]{0,60}$/),
    (term, prose) => {
      assert.deepEqual(checkSidecarRootText(vip, prose + "\n\n" + tooling), []);
      const changed = tooling.replace(paragraph, paragraph.replaceAll(term, "removed root alternative"));
      assert.ok(checkSidecarRootText(vip, changed).some(f => f.includes("chapter 7 layout") && f.includes(term)));
    }
  ), { seed: 27183, numRuns: 150 });
});
