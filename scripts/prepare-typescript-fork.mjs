#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
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

function fail(message) {
  console.error(`typescript fork cache: ${message}`);
  process.exit(1);
}

function parseArguments(argv) {
  const result = {
    cache: resolve(tmpdir(), "vibelang-typescript-fork-cache"),
    fetch: false,
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
      case "--source":
        result.source = resolve(argv[++index] ?? fail("--source needs a path"));
        break;
      case "--help":
        process.stdout.write(
          "usage: prepare-typescript-fork.mjs [--source CHECKOUT] [--cache DIRECTORY] [--fetch]\n" +
            "\nWithout --fetch this command never uses the network and fails if the exact checkout is absent.\n",
        );
        process.exit(0);
        break;
      default:
        fail(`unknown argument ${JSON.stringify(argv[index])}`);
    }
  }
  return result;
}

function git(checkout, args, { allowFailure = false } = {}) {
  const commandArgs = checkout === undefined ? args : ["-C", checkout, ...args];
  const completed = spawnSync("git", commandArgs, {
    encoding: "utf8",
    stdio: "pipe",
  });
  if (completed.error) fail(completed.error.message);
  if (completed.status !== 0 && !allowFailure) {
    fail(
      `${["git", ...commandArgs].join(" ")} failed: ${completed.stderr.trim() || completed.stdout.trim()}`,
    );
  }
  return completed;
}

function verify(checkout) {
  const revision = git(checkout, ["rev-parse", "HEAD"]).stdout.trim();
  if (revision !== manifest.revision) {
    fail(`checkout ${checkout} is ${revision}; require ${manifest.revision}`);
  }
  const status = git(checkout, [
    "status",
    "--porcelain",
    "--untracked-files=all",
    "--",
    "tsc",
  ]).stdout.trim();
  if (status !== "") {
    fail(`checkout ${checkout} has changes under tsc:\n${status}`);
  }
  const modulePath = resolve(checkout, "tsc", "go.mod");
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

function fetchCheckout(target) {
  mkdirSync(dirname(target), { recursive: true });
  const staging = `${target}.fetching-${process.pid}`;
  if (existsSync(staging)) {
    rmSync(staging, { recursive: true, force: true });
  }
  mkdirSync(staging);
  try {
    git(staging, ["init"]);
    git(staging, ["remote", "add", "origin", manifest.repository]);
    git(staging, ["sparse-checkout", "init", "--cone"]);
    git(staging, ["sparse-checkout", "set", "tsc"]);
    git(staging, [
      "fetch",
      "--depth=1",
      "--filter=blob:none",
      "origin",
      manifest.revision,
    ]);
    git(staging, ["checkout", "--detach", "FETCH_HEAD"]);
    verify(staging);
    renameSync(staging, target);
  } catch (error) {
    rmSync(staging, { recursive: true, force: true });
    throw error;
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
let fetched = false;
if (checkout === undefined) {
  checkout = resolve(args.cache, manifest.revision);
  if (!existsSync(checkout)) {
    if (!args.fetch) {
      fail(
        `exact checkout is not cached at ${checkout}; pass --fetch to perform an explicit sparse fetch`,
      );
    }
    fetchCheckout(checkout);
    fetched = true;
  }
}
verify(checkout);
process.stdout.write(
  `${JSON.stringify(
    {
      checkout,
      fetched,
      revision: manifest.revision,
      tscModule: resolve(checkout, "tsc"),
      integrationTest: `VIBELANG_TYPESCRIPT_FORK=${checkout} go test ./compiler -run TestPinnedForkParsesChecksEmitsAndMapsVibe -count=1`,
    },
    null,
    2,
  )}\n`,
);
