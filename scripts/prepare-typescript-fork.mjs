#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(
  readFileSync(resolve(root, "typescript-fork.json"), "utf8"),
);
const vendorDirectory = resolve(root, "vendor/typescript");
const capsulePath = resolve(vendorDirectory, "capsule.json");

// Cone mode (`--full-tsc`) materializes `tsc`, `tools`, and `packages` plus every
// top-level file automatically. The default `--no-cone` compiler checkout has to
// name each entry, including the root files, because no-cone mode has no implicit
// top-level file rule.
//
// `tools/` and `packages/` are required, not optional: `tools/scripts/tsc/ast.json`
// is the AST source of truth, `tools/scripts/tsc/generate*.ts` are the generators,
// `packages/typescript/src/` holds the TypeScript half of the numerically-encoded
// AST wire protocol, and `go.work` already lists `./tools`. Together they are
// 3.7 MB against a ~396 MB tree.
const compilerSparsePatterns = [
  "/tsc/go.mod",
  "/tsc/go.sum",
  "/tsc/LICENSE",
  "/tsc/CHANGES.md",
  "/tsc/cmd/",
  "/tsc/internal/",
  "!/tsc/internal/fourslash/",
  "!/tsc/internal/testrunner/",
  "!/tsc/internal/testutil/",
  "!/tsc/**/*_test.go",
  "/tools/",
  "/packages/typescript/src/",
  "/Herebyfile.mjs",
  "/package.json",
  "/package-lock.json",
  "/go.work",
  "/.dprint.jsonc",
];

function fail(message) {
  console.error(`typescript fork checkout: ${message}`);
  process.exit(1);
}

function run(command, args, options = {}) {
  const completed = spawnSync(command, args, {
    cwd: options.cwd ?? root,
    encoding: "utf8",
    env: options.env ?? process.env,
    input: options.input,
    maxBuffer: 128 * 1024 * 1024,
    stdio: "pipe",
  });
  if (completed.error) fail(completed.error.message);
  if (completed.status !== 0) {
    const detail =
      completed.stderr?.trim() || completed.stdout?.trim() || "no output";
    fail(`${command} ${args.join(" ")} failed: ${detail}`);
  }
  return completed;
}

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

/**
 * The cache directory name every consumer searches when
 * `SMITHERS_TYPESCRIPT_FORK` is unset.
 *
 * This script is the *producer*; `src/go-backend.ts`, `scripts/go-test-gate.mjs`,
 * `scripts/fork-e2e.mjs` and `test/cli-go-backend.test.mjs` are the *consumers*,
 * and all of them look in `<root>/smithers-ts-fork-cache/<revision>`. The default
 * here was `smithers-typescript-fork-cache`, so running the documented bare
 * command — `node scripts/prepare-typescript-fork.mjs --fetch` — produced a
 * perfectly good checkout in a directory nothing reads, and every consumer then
 * reported the checkout as absent. `test/cli-go-backend.test.mjs` now refuses
 * any re-divergence between this literal and the consumers'.
 */
const DEFAULT_FORK_CACHE_DIRECTORY_NAME = "smithers-ts-fork-cache";

function parseArguments(argv) {
  const result = {
    cache: resolve(tmpdir(), DEFAULT_FORK_CACHE_DIRECTORY_NAME),
    fetch: false,
    fullTsc: false,
    source: undefined,
  };
  for (let index = 0; index < argv.length; index += 1) {
    switch (argv[index]) {
      case "--cache":
        result.cache = resolve(argv[++index] ?? fail("--cache needs a path"));
        break;
      case "--fetch":
        result.fetch = true;
        break;
      case "--full-tsc":
        result.fullTsc = true;
        break;
      case "--source":
        result.source = resolve(argv[++index] ?? fail("--source needs a path"));
        break;
      case "--help":
        process.stdout.write(
          "usage: prepare-typescript-fork.mjs [--source CHECKOUT] [--cache DIRECTORY] [--full-tsc] [--fetch]\n" +
            "\nThe vendored source capsule is used offline by default. --fetch is an explicit network fallback.\n",
        );
        process.exit(0);
        break;
      default:
        fail(`unknown argument ${JSON.stringify(argv[index])}`);
    }
  }
  return result;
}

function verify(checkout) {
  const revision = run("git", ["-C", checkout, "rev-parse", "HEAD"]).stdout.trim();
  if (revision !== manifest.revision) {
    fail(`checkout ${checkout} is ${revision}; require ${manifest.revision}`);
  }
  const status = run("git", [
    "-C",
    checkout,
    "status",
    "--porcelain=v1",
    "--untracked-files=all",
  ]).stdout.trim();
  if (status !== "") fail(`checkout ${checkout} is dirty:\n${status}`);
  const modulePath = resolve(checkout, "tsc/go.mod");
  if (
    !existsSync(modulePath) ||
    !readFileSync(modulePath, "utf8").includes(
      "module github.com/microsoft/TypeScript/tsc",
    )
  ) {
    fail(`${checkout} does not contain the expected tsc Go module`);
  }
  return checkout;
}

function readCapsule() {
  if (!existsSync(capsulePath)) return undefined;
  const capsule = JSON.parse(readFileSync(capsulePath, "utf8"));
  if (
    capsule.schemaVersion !== 1 ||
    capsule.revision !== manifest.revision ||
    capsule.format !== "git-bundle+file-go-proxy"
  ) {
    fail("vendored capsule metadata does not match typescript-fork.json");
  }
  const bundle = resolve(vendorDirectory, capsule.sourceBundle);
  const expectedDigest = capsule.files?.[capsule.sourceBundle];
  if (
    !existsSync(bundle) ||
    typeof expectedDigest !== "string" ||
    sha256(bundle) !== expectedDigest
  ) {
    fail("vendored TypeScript bundle is absent or has a digest mismatch");
  }
  return { bundle, capsule };
}

function materializeFromCapsule(target, fullTsc) {
  const vendored = readCapsule();
  if (!vendored) return false;
  mkdirSync(dirname(target), { recursive: true });
  const stagingRoot = mkdtempSync(resolve(tmpdir(), "smithers-typescript-checkout-"));
  const staging = resolve(stagingRoot, "typescript");
  try {
    run("git", [
      "-c",
      "protocol.file.allow=always",
      "clone",
      "--quiet",
      "--no-checkout",
      vendored.bundle,
      staging,
    ]);
    if (fullTsc) {
      run("git", ["-C", staging, "sparse-checkout", "init", "--cone"]);
      run("git", ["-C", staging, "sparse-checkout", "set", "tsc", "tools", "packages"]);
    } else {
      run("git", ["-C", staging, "sparse-checkout", "init", "--no-cone"]);
      run(
        "git",
        ["-C", staging, "sparse-checkout", "set", "--no-cone", "--stdin"],
        { input: `${compilerSparsePatterns.join("\n")}\n` },
      );
    }
    run("git", [
      "-C",
      staging,
      "checkout",
      "--quiet",
      "--detach",
      manifest.revision,
    ]);
    verify(staging);
    renameSync(staging, target);
    return true;
  } finally {
    rmSync(stagingRoot, { recursive: true, force: true });
  }
}

function fetchCheckout(target, fullTsc) {
  mkdirSync(dirname(target), { recursive: true });
  const stagingRoot = mkdtempSync(resolve(tmpdir(), "smithers-typescript-fetch-"));
  const staging = resolve(stagingRoot, "typescript");
  try {
    run("git", ["init", "--quiet", staging]);
    run("git", ["-C", staging, "remote", "add", "origin", manifest.repository]);
    run("git", ["-C", staging, "sparse-checkout", "init", "--cone"]);
    run("git", ["-C", staging, "sparse-checkout", "set", "tsc", "tools", "packages"]);
    run("git", [
      "-C",
      staging,
      "fetch",
      "--depth=1",
      "--filter=blob:none",
      "origin",
      manifest.revision,
    ]);
    run("git", ["-C", staging, "checkout", "--quiet", "--detach", "FETCH_HEAD"]);
    if (!fullTsc) {
      run("git", ["-C", staging, "sparse-checkout", "set", "--no-cone", "--stdin"], {
        input: `${compilerSparsePatterns.join("\n")}\n`,
      });
    }
    verify(staging);
    renameSync(staging, target);
  } finally {
    rmSync(stagingRoot, { recursive: true, force: true });
  }
}

if (
  manifest.schemaVersion !== 1 ||
  !/^[0-9a-f]{40}$/u.test(manifest.revision) ||
  typeof manifest.repository !== "string"
) {
  fail("typescript-fork.json is invalid");
}

const args = parseArguments(process.argv.slice(2));
let checkout = args.source;
let origin = "existing";
if (checkout === undefined) {
  checkout = resolve(args.cache, manifest.revision);
  if (!existsSync(checkout)) {
    if (materializeFromCapsule(checkout, args.fullTsc)) {
      origin = "vendored-capsule";
    } else if (args.fetch) {
      fetchCheckout(checkout, args.fullTsc);
      origin = "network-fetch";
    } else {
      fail("vendored capsule is absent; pass --fetch for an explicit network fetch");
    }
  }
}
verify(checkout);
process.stdout.write(
  `${JSON.stringify(
    {
      checkout,
      origin,
      revision: manifest.revision,
      tscModule: resolve(checkout, "tsc"),
      fullTsc: args.fullTsc,
      build: "npm run smithersc:build",
    },
    null,
    2,
  )}\n`,
);
