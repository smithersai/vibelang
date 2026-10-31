import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { test } from "node:test";
import { SpecPath } from "../../../../scripts/testing/spec-path.mjs";
import {
  packagesReaching,
  viteAppConfigs,
  wireBunTests,
} from "../lib/wire.mjs";

const require = createRequire(
  new URL("../../../../packages/runtime/package.json", import.meta.url),
);
const fc = require("fast-check");
const quote =
  "every package that runs `bun test` and reaches a migrated package through workspace dependencies";
const toolingQuote =
  "linters, Knip, bundlers and test runners each read `.vibe`.";
const corpus = new URL(
  "./corpus/workspace-cycle-preload.json",
  import.meta.url,
);

// The oracle follows each outgoing path with its own visited set. In
// particular, a temporarily open cycle is not a cached negative answer.
function reachesMigration(nodes, at, path = new Set()) {
  if (nodes[at].migrated) return true;
  if (path.has(at)) return false;
  const next = new Set([...path, at]);
  return nodes[at].deps.some((index) =>
    reachesMigration(nodes, index % nodes.length, next),
  );
}

function verify(input) {
  const root = mkdtempSync(join(tmpdir(), "vibelang-workspace-cycle-"));
  const put = (name, text) => {
    mkdirSync(dirname(join(root, name)), { recursive: true });
    writeFileSync(join(root, name), text);
  };
  try {
    put(
      "package.json",
      JSON.stringify({
        name: "cycle-root",
        private: true,
        workspaces: ["packages/*"],
      }),
    );
    const dirs = input.nodes.map(
      (_, i) =>
        "packages/p" + ((i + (input.rotation ?? 0)) % input.nodes.length),
    );
    const names = dirs.map(
      (dir) => "@example/" + dir.slice("packages/".length),
    );
    const before = new Map();
    for (let i = 0; i < input.nodes.length; i++) {
      const dependencies = Object.fromEntries(
        input.nodes[i].deps.map((index) => [
          names[index % names.length],
          "workspace:*",
        ]),
      );
      const text =
        JSON.stringify(
          {
            name: names[i],
            version: "1.0.0",
            dependencies,
            scripts: { record: "bun entry.ts", test: "bun test" },
          },
          null,
          2,
        ) + "\n";
      put(dirs[i] + "/package.json", text);
      before.set(dirs[i], text);
      put(dirs[i] + "/vite.config.ts", "export default {}\n");
    }
    const migrated = dirs.filter((_, i) => input.nodes[i].migrated);
    const expected = dirs
      .filter((_, i) => reachesMigration(input.nodes, i))
      .sort();
    assert.deepEqual(
      packagesReaching(root, migrated)
        .map((pkg) => pkg.dir)
        .sort(),
      expected,
    );
    assert.deepEqual(
      packagesReaching(root, [...migrated].reverse())
        .map((pkg) => pkg.dir)
        .sort(),
      expected,
    );
    assert.deepEqual(
      viteAppConfigs(root, migrated).sort(),
      expected.map((dir) => dir + "/vite.config.ts"),
    );
    const options = {
      root,
      packages: migrated.map((dir) => ({ dir })),
      specsFor: () => ({ vibelang: "file:compiler.tgz" }),
    };
    const wired = wireBunTests(options);
    assert.deepEqual(wired.warnings, []);
    assert.deepEqual(
      wired.changed.filter((file) => file.endsWith("/bunfig.toml")).sort(),
      expected.map((dir) => dir + "/bunfig.toml"),
    );
    const configs = expected.map((dir) =>
      readFileSync(join(root, dir, "bunfig.toml"), "utf8"),
    );
    const parsed = spawnSync(
      "bun",
      [
        "-e",
        "console.log(JSON.stringify(JSON.parse(process.argv[1]).map(text=>Bun.TOML.parse(text))))",
        JSON.stringify(configs),
      ],
      { encoding: "utf8", timeout: 10000 },
    );
    assert.ifError(parsed.error);
    assert.equal(parsed.status, 0, parsed.stderr);
    for (const config of JSON.parse(parsed.stdout)) {
      assert.deepEqual(config.preload, ["vibelang/bun"]);
      assert.deepEqual(config.test.preload, ["vibelang/bun"]);
    }
    for (const dir of dirs) {
      if (expected.includes(dir)) {
        const manifest = JSON.parse(
          readFileSync(join(root, dir, "package.json"), "utf8"),
        );
        assert.equal(manifest.devDependencies.vibelang, "file:compiler.tgz");
        assert.deepEqual(
          manifest.dependencies,
          JSON.parse(before.get(dir)).dependencies,
        );
      } else {
        assert.equal(existsSync(join(root, dir, "bunfig.toml")), false);
        assert.equal(
          readFileSync(join(root, dir, "package.json"), "utf8"),
          before.get(dir),
        );
      }
    }
    assert.deepEqual(wireBunTests(options), { changed: [], warnings: [] });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("setup reaches every member of a workspace cycle that can import migrated code", () => {
  assert.ok(
    readFileSync(SpecPath("007-tooling.md"), "utf8").includes(toolingQuote),
    "update the existing-tools contract",
  );
  assert.ok(
    readFileSync(new URL("../README.md", import.meta.url), "utf8").includes(
      quote,
    ),
    "update the workspace preload contract",
  );
  verify(JSON.parse(readFileSync(corpus, "utf8")).input);
  fc.assert(
    fc.property(
      fc.record({
        nodes: fc.array(
          fc.record({
            migrated: fc.boolean(),
            deps: fc.array(fc.integer({ min: 0, max: 5 }), { maxLength: 6 }),
          }),
          { minLength: 1, maxLength: 6 },
        ),
        rotation: fc.integer({ min: 0, max: 5 }),
      }),
      verify,
    ),
    { seed: 310033, numRuns: 500 },
  );
});
