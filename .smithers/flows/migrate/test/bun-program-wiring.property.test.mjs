import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
  existsSync,
} from "node:fs";
import { dirname, join, posix } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { test } from "node:test";
import { SpecPath } from "../../../../scripts/testing/spec-path.mjs";
import { wireBunTests } from "../lib/wire.mjs";

const specQuote = "linters, Knip, bundlers and test runners each read `.vibe`.";
const require = createRequire(
  new URL("../../../../packages/runtime/package.json", import.meta.url),
);
const fc = require("fast-check");
const quote =
  "at the top level of the `bunfig.toml` of each such package where a script runs a program under Bun";
const corpus = new URL(
  "./corpus/t3code-bun-script-loader.json",
  import.meta.url,
);

function verify(input) {
  const root = mkdtempSync(join(tmpdir(), "vibelang-bun-program-"));
  const put = (name, text) => {
    mkdirSync(dirname(join(root, name)), { recursive: true });
    writeFileSync(join(root, name), text);
  };
  const manifest = (name, value) =>
    put(name, JSON.stringify(value, null, 2) + "\n");
  try {
    manifest("package.json", {
      name: "program-workspace",
      private: true,
      type: "module",
      workspaces: ["apps/*", "packages/*"],
    });
    let previous, previousDir;
    const dependency = (directory) =>
      !previous
        ? {}
        : {
            [input.dependencyKind]: {
              [previous]: /^(file|link):/.test(input.range)
                ? input.range.split(":")[0] +
                  ":" +
                  posix.relative(directory, previousDir)
                : input.range,
            },
          };
    for (let i = 0; i < input.depth; i++) {
      const name = "@example/lib" + i;
      manifest("packages/lib" + i + "/package.json", {
        name,
        version: "1.0.0",
        ...dependency("packages/lib" + i),
      });
      previous = name;
      previousDir = "packages/lib" + i;
    }
    const command =
      input.script ??
      {
        direct: "bun entry.ts",
        run: "bun run entry.ts",
        flag: "bun --bun entry.ts",
        bin: "bun recorder --check",
        outer: "bun entry.ts",
      }[input.form];
    const scripts = { "record:claude-replay": command };
    const serverManifest = {
      name: "@example/server",
      private: true,
      type: "module",
      scripts: input.form === "outer" ? {} : scripts,
      ...dependency("apps/server"),
    };
    if (input.hasCompiler)
      serverManifest.devDependencies = {
        ...serverManifest.devDependencies,
        vibelang: "0.0.11",
      };
    manifest("apps/server/package.json", serverManifest);
    if (input.form === "outer")
      manifest("package.json", {
        name: "program-workspace",
        private: true,
        type: "module",
        workspaces: ["apps/*", "packages/*"],
        scripts: { record: "cd apps/server && " + command },
      });
    manifest("apps/unrelated/package.json", {
      name: "@example/unrelated",
      private: true,
      scripts: { record: "bun entry.ts" },
    });
    const initial =
      "telemetry = false\n" +
      (input.initialTest ? '[test]\npreload = ["./test-only.ts"]\n' : "");
    put("apps/server/bunfig.toml", initial);
    for (const [name, text] of Object.entries(input.files ?? {}))
      put(name, text);
    const options = {
      root,
      packages: [{ dir: input.depth ? "packages/lib0" : "apps/server" }],
      specsFor: () => ({ vibelang: "file:compiler.tgz" }),
    };
    const result = wireBunTests(options);
    assert.deepEqual(result.warnings, []);
    const after = readFileSync(join(root, "apps/server/bunfig.toml"), "utf8");
    const parsed = spawnSync(
      "bun",
      [
        "-e",
        "console.log(JSON.stringify(Bun.TOML.parse(process.argv[1])))",
        after,
      ],
      { encoding: "utf8", timeout: 10000 },
    );
    assert.ifError(parsed.error);
    assert.equal(parsed.status, 0, parsed.stderr);
    const config = JSON.parse(parsed.stdout);
    assert.deepEqual(config.preload, ["vibelang/bun"]);
    assert.equal(config.telemetry, false);
    if (input.initialTest)
      assert.deepEqual(config.test.preload, ["./test-only.ts"]);
    assert.equal(existsSync(join(root, "apps/unrelated/bunfig.toml")), false);
    const server = JSON.parse(
      readFileSync(join(root, "apps/server/package.json"), "utf8"),
    );
    assert.equal(
      server.devDependencies.vibelang,
      input.hasCompiler ? "0.0.11" : "file:compiler.tgz",
    );
    assert.deepEqual(wireBunTests(options), { changed: [], warnings: [] });
    for (const [name, text] of Object.entries(input.files ?? {}))
      assert.equal(readFileSync(join(root, name), "utf8"), text);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
test("T3code: setup preloads Bun program entry points across workspace dependencies", () => {
  assert.ok(
    readFileSync(SpecPath("007-tooling.md"), "utf8").includes(specQuote),
    "update the tooling oracle",
  );
  assert.ok(
    readFileSync(new URL("../README.md", import.meta.url), "utf8").includes(
      quote,
    ),
    "update the program preload contract",
  );
  verify(JSON.parse(readFileSync(corpus, "utf8")).input);
  fc.assert(
    fc.property(
      fc.record({
        depth: fc.integer({ min: 0, max: 4 }),
        form: fc.constantFrom("direct", "run", "flag", "bin", "outer"),
        dependencyKind: fc.constantFrom(
          "dependencies",
          "devDependencies",
          "peerDependencies",
        ),
        range: fc.constantFrom(
          "workspace:*",
          "file:../lib0",
          "link:../lib0",
          "*",
        ),
        initialTest: fc.boolean(),
        hasCompiler: fc.boolean(),
      }),
      verify,
    ),
    { seed: 331031, numRuns: 80 },
  );
});
