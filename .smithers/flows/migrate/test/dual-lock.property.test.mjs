import assert from "node:assert/strict";
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
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { test } from "node:test";
import { SpecPath } from "../../../../scripts/testing/spec-path.mjs";
import { installCommand, packageManager } from "../lib/wire.mjs";

const specQuote =
  "A repository that already uses VibeLang upgrades Effect together with the VibeLang release pinned to the new Effect, because the published `vibelang-runtime` enforces its exact pin.";
const require = createRequire(
  new URL("../../../../packages/runtime/package.json", import.meta.url),
);
const fc = require("fast-check");
const owners = {
  "bun.lock": "bun",
  "bun.lockb": "bun",
  "package-lock.json": "npm",
  "pnpm-lock.yaml": "pnpm",
};
const primaryLock = {
  bun: "bun.lock",
  npm: "package-lock.json",
  pnpm: "pnpm-lock.yaml",
};
const quote =
  "Every install the flow runs also rewrites each other lockfile at the repository's root";
function verify(input) {
  const root = mkdtempSync(join(tmpdir(), "vibelang-dual-lock-"));
  try {
    const files = [
      ...new Set([primaryLock[input.seedManager], ...input.files]),
    ];
    const manager = packageManager(files);
    for (const file of files) {
      mkdirSync(dirname(join(root, file)), { recursive: true });
      writeFileSync(join(root, file), "old\n");
    }
    writeFileSync(
      join(root, "package.json"),
      JSON.stringify({ name: "install-oracle", version: input.version }),
    );
    const bin = join(root, "bin");
    mkdirSync(bin);
    // These recorder processes model one external contract: a package
    // manager owns its own locks. The flow must invoke all other owners
    // needed by the root files. No package-manager install is simulated.
    for (const manager of ["bun", "npm", "pnpm"]) {
      const shim = [
        "#!/usr/bin/env node",
        'const fs = require("node:fs"); const path = require("node:path")',
        "const own = " +
          JSON.stringify(
            Object.keys(owners).filter((file) => owners[file] === manager),
          ),
        'const manifest = JSON.parse(fs.readFileSync("package.json","utf8"))',
        'fs.appendFileSync("install-trace.jsonl", JSON.stringify({manager:' +
          JSON.stringify(manager) +
          ',cwd:process.cwd(),args:process.argv.slice(2)})+"\\n")',
        'for (const file of own) if(fs.existsSync(file)) fs.writeFileSync(file, manifest.version+"\\n")',
        "",
      ].join("\n");
      writeFileSync(join(bin, manager), shim);
      chmodSync(join(bin, manager), 0o755);
    }
    const command = installCommand(manager, files);
    const result = spawnSync("/bin/sh", ["-c", command], {
      cwd: root,
      encoding: "utf8",
      timeout: 15000,
      env: { ...process.env, PATH: bin + ":" + process.env.PATH },
    });
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr);
    for (const file of files) {
      assert.equal(
        readFileSync(join(root, file), "utf8"),
        owners[file] ? input.version + "\n" : "old\n",
        file,
      );
    }
    const trace = readFileSync(join(root, "install-trace.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map(JSON.parse);
    const expected = new Set([
      manager,
      ...files.map((file) => owners[file]).filter(Boolean),
    ]);
    assert.equal(trace[0].manager, manager);
    assert.deepEqual(new Set(trace.map((row) => row.manager)), expected);
    assert.equal(
      trace.length,
      expected.size,
      "refresh each owner once, including both Bun lock spellings",
    );
    assert.ok(
      trace.every((row) => row.cwd === root && row.args[0] === "install"),
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
test("Smithers: installs refresh every root lock owner and leave nested and lookalike files alone", () => {
  assert.ok(
    readFileSync(SpecPath("007-tooling.md"), "utf8").includes(specQuote),
    "update the tooling oracle",
  );
  assert.ok(
    readFileSync(new URL("../README.md", import.meta.url), "utf8").includes(
      quote,
    ),
    "update the lock refresh contract",
  );
  verify(
    JSON.parse(
      readFileSync(
        new URL("./corpus/smithers-dual-lock.json", import.meta.url),
        "utf8",
      ),
    ).input,
  );
  fc.assert(
    fc.property(
      fc.record({
        seedManager: fc.constantFrom("bun", "npm", "pnpm"),
        files: fc.array(
          fc.constantFrom(
            ...Object.keys(owners),
            "nested/bun.lock",
            "nested/package-lock.json",
            "bun.lock.backup",
            "pnpm-lock.yaml.old",
          ),
          { maxLength: 12 },
        ),
        version: fc.integer({ min: 1, max: 999 }).map((n) => "1.0." + n),
      }),
      verify,
    ),
    { seed: 311031, numRuns: 70 },
  );
});
