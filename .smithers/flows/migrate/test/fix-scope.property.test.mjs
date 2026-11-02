import assert from "node:assert/strict";
import { fakeProjectFiles } from "./helpers/fake-project-files.mjs"
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { test } from "node:test";
import { SpecPath } from "../../../../scripts/testing/spec-path.mjs";
import { fixToFixedPoint } from "../lib/codemod.mjs";

const specQuote =
  "A quick fix is offered only when it preserves evaluation order, coldness, types, comments, and declaration output; otherwise the diagnostic explains why it has no automatic fix.";
const require = createRequire(
  new URL("../../../../packages/runtime/package.json", import.meta.url),
);
const fc = require("fast-check");
const quote =
  "keeping the rewrites of the batch's files only (an earlier batch's committed files stay as committed)";
const regressions = new URL("./corpus/alchemy-fix-scope.json", import.meta.url);

async function verify(input) {
  const root = mkdtempSync(join(tmpdir(), "vibelang-fix-scope-"));
  try {
    const cwd = join(root, input.directory);
    const files = input.files.map((file, i) => ({
      file: "src/" + (i % 2 ? "nested/" : "") + "module" + i + ".vibe",
      text:
        file.source ??
        "// accepted source " +
          i +
          "\nexport const item" +
          i +
          " = " +
          file.value +
          ";\n",
      stages: file.stages,
      kept: file.kept,
    }));
    for (const file of files) {
      mkdirSync(dirname(join(cwd, file.file)), { recursive: true });
      writeFileSync(join(cwd, file.file), file.text);
    }
    const compiler = join(root, "fake-vibelang");
    // Model only the external compiler protocol. The oracle is that each
    // round restores every earlier file exactly and reports only this batch.
    writeFileSync(
      compiler,
      [
        "#!/usr/bin/env node",
        fakeProjectFiles(root),
        'const fs = require("node:fs")',
        "const files = " + JSON.stringify(files),
        "let total = 0",
        "for (const file of files) {",
        ' const text = fs.readFileSync(file.file, "utf8")',
        " const count = (text.match(/\\/\\/ rewrite [0-9]+\\n/g) ?? []).length",
        " if (count >= file.stages) continue",
        ' fs.writeFileSync(file.file, text + "// rewrite " + (count + 1) + "\\n")',
        ' console.log("vibelang --fix: " + file.file + ": 1 fix (prelude import ×1)")',
        " total++",
        "}",
        'console.log("vibelang --fix: " + total + " fixes in " + total + " files.")',
        "",
      ].join("\n"),
    );
    chmodSync(compiler, 0o755);
    const only = files
      .filter((file) => file.kept)
      .map((file) => input.directory + "/" + file.file);
    const maxStage = Math.max(
      0,
      ...files.filter((file) => file.kept).map((file) => file.stages),
    );
    const rounds = Math.min(input.maxRounds, maxStage + 1);
    const result = await fixToFixedPoint({
      compiler,
      tsconfig: "tsconfig.json",
      cwd,
      root,
      only,
      maxRounds: input.maxRounds,
    });
    assert.equal(result.rounds.length, rounds);
    assert.equal(result.settled, input.maxRounds > maxStage);
    const expectedFiles = {};
    for (const file of files) {
      const count = file.kept ? Math.min(file.stages, rounds) : 0;
      const expected =
        file.text +
        Array.from(
          { length: count },
          (_, i) => "// rewrite " + (i + 1) + "\n",
        ).join("");
      assert.equal(
        readFileSync(join(cwd, file.file), "utf8"),
        expected,
        file.file,
      );
      if (count)
        expectedFiles[input.directory + "/" + file.file] = {
          "prelude import": count,
        };
    }
    assert.deepEqual(result.byFile, expectedFiles);
    for (const round of result.rounds) {
      assert.ok(Object.keys(round.files).every((file) => only.includes(file)));
      assert.equal(
        round.fixes,
        Object.values(round.files).reduce(
          (sum, codes) => sum + Object.values(codes).reduce((a, b) => a + b, 0),
          0,
        ),
      );
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("Alchemy5: the fix loop retains earlier batches across rounds, nesting and empty selections", async () => {
  assert.ok(
    readFileSync(SpecPath("007-tooling.md"), "utf8").includes(specQuote),
    "update the tooling oracle",
  );
  assert.ok(
    readFileSync(new URL("../README.md", import.meta.url), "utf8").includes(
      quote,
    ),
    "update the batch-preservation contract",
  );
  const fixture = JSON.parse(readFileSync(regressions, "utf8"));
  await verify(fixture.input);
  await fc.assert(
    fc.asyncProperty(
      fc.record({
        directory: fc.constantFrom(
          "pkg",
          "packages/domain",
          "packages/with spaces",
        ),
        maxRounds: fc.integer({ min: 1, max: 4 }),
        files: fc.array(
          fc.record({
            kept: fc.boolean(),
            stages: fc.integer({ min: 0, max: 2 }),
            value: fc.integer({ min: -999, max: 999 }),
          }),
          { minLength: 1, maxLength: 6 },
        ),
      }),
      verify,
    ),
    { seed: 503011, numRuns: 60 },
  );
});
