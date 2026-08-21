#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = resolve(root, "typescript-fork.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));

function fail(message) {
  console.error(`typescript fork: ${message}`);
  process.exit(1);
}

if (manifest.schemaVersion !== 1) {
  fail(`unsupported manifest schema ${JSON.stringify(manifest.schemaVersion)}`);
}

if (manifest.strategy !== "git-subtree-squash") {
  fail(`unsupported vendoring strategy ${JSON.stringify(manifest.strategy)}`);
}

if (!/^[0-9a-f]{40}$/.test(manifest.revision)) {
  fail("revision must be a full 40-character Git commit");
}

if (
  typeof manifest.vendorPath !== "string" ||
  manifest.vendorPath.length === 0 ||
  isAbsolute(manifest.vendorPath) ||
  manifest.vendorPath.split(/[\\/]/u).includes("..")
) {
  fail("vendorPath must be a safe repository-relative path");
}

const vendorDirectory = resolve(root, manifest.vendorPath);
const compilerModule = resolve(vendorDirectory, "tsc", "go.mod");

function git(args, { capture = false, allowFailure = false } = {}) {
  const result = spawnSync("git", args, {
    cwd: root,
    encoding: "utf8",
    stdio: capture ? "pipe" : "inherit",
  });

  if (result.error) {
    fail(result.error.message);
  }

  if (result.status !== 0 && !allowFailure) {
    if (capture && result.stderr) process.stderr.write(result.stderr);
    process.exit(result.status ?? 1);
  }

  return result;
}

function subtreeRevision() {
  const result = git(
    [
      "log",
      "-n",
      "1",
      "--format=%B",
      "--fixed-strings",
      `--grep=git-subtree-dir: ${manifest.vendorPath}`,
    ],
    { capture: true, allowFailure: true },
  );

  if (result.status !== 0) return null;
  return result.stdout.match(/^git-subtree-split: ([0-9a-f]{40})$/mu)?.[1] ?? null;
}

function status() {
  const importedRevision = subtreeRevision();
  return {
    repository: manifest.repository,
    vendorPath: manifest.vendorPath,
    configuredRevision: manifest.revision,
    importedRevision,
    sourcePresent: existsSync(vendorDirectory),
    compilerModulePresent: existsSync(compilerModule),
    synchronized:
      existsSync(compilerModule) && importedRevision === manifest.revision,
  };
}

function printStatus() {
  process.stdout.write(`${JSON.stringify(status(), null, 2)}\n`);
}

function requireCleanWorktree() {
  const result = git(["status", "--porcelain"], { capture: true });
  if (result.stdout.trim() !== "") {
    fail(
      "git subtree creates a commit; commit or stash the current worktree first",
    );
  }
}

function sync() {
  requireCleanWorktree();

  const remote = git(["ls-remote", manifest.repository, "HEAD"], {
    capture: true,
    allowFailure: true,
  });
  if (remote.status !== 0) {
    fail(
      `${manifest.repository} is unavailable; create the smithersai fork or check Git credentials`,
    );
  }

  const sourcePresent = existsSync(vendorDirectory);
  if (sourcePresent && !existsSync(compilerModule)) {
    fail(
      `${manifest.vendorPath} exists without tsc/go.mod; refusing to overwrite it`,
    );
  }

  const operation = sourcePresent ? "pull" : "add";
  git([
    "subtree",
    operation,
    `--prefix=${manifest.vendorPath}`,
    manifest.repository,
    manifest.revision,
    "--squash",
  ]);

  const current = status();
  if (!current.synchronized) {
    fail(
      `subtree completed but recorded ${current.importedRevision ?? "no revision"}; expected ${manifest.revision}`,
    );
  }
  printStatus();
}

switch (process.argv[2] ?? "status") {
  case "status":
    printStatus();
    break;
  case "verify": {
    const current = status();
    if (!current.synchronized) {
      printStatus();
      fail("vendored TypeScript source is absent or does not match the manifest");
    }
    printStatus();
    break;
  }
  case "sync":
    sync();
    break;
  default:
    fail("usage: vendor-typescript.mjs [status|verify|sync]");
}
