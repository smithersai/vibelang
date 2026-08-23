#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(
  readFileSync(resolve(root, "typescript-fork.json"), "utf8"),
);
const vendorDirectory = resolve(root, "vendor/typescript");
const pinnedGoVersion = "go1.26.0";

function fail(message) {
  console.error(`typescript fork vendor: ${message}`);
  process.exit(1);
}

function run(command, args, options = {}) {
  const completed = spawnSync(command, args, {
    cwd: options.cwd ?? root,
    encoding: "utf8",
    env: options.env ?? process.env,
    maxBuffer: 128 * 1024 * 1024,
    stdio: options.capture === false ? "inherit" : "pipe",
  });
  if (completed.error) fail(completed.error.message);
  if (completed.status !== 0 && !options.allowFailure) {
    const detail =
      completed.stderr?.trim() || completed.stdout?.trim() || "no output";
    fail(`${command} ${args.join(" ")} failed: ${detail}`);
  }
  return completed;
}

function commandVersion(command) {
  const completed = spawnSync(command, ["version"], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, GOTOOLCHAIN: "local" },
    stdio: "pipe",
  });
  return completed.status === 0 ? completed.stdout.trim() : undefined;
}

function resolveGo() {
  const requested = process.env.SMITHERS_GO;
  if (requested) {
    const version = commandVersion(requested);
    if (!version?.includes(` ${pinnedGoVersion} `)) {
      fail(`SMITHERS_GO must name ${pinnedGoVersion}; got ${version ?? "an unusable command"}`);
    }
    return requested;
  }
  const systemVersion = commandVersion("go");
  if (systemVersion?.includes(` ${pinnedGoVersion} `)) return "go";
  const environment = run("go", ["env", "GOMODCACHE", "GOOS", "GOARCH"], {
    env: { ...process.env, GOTOOLCHAIN: "local" },
  }).stdout.trim().split("\n");
  const candidate = resolve(
    environment[0],
    "golang.org",
    `toolchain@v0.0.1-${pinnedGoVersion}.${environment[1]}-${environment[2]}`,
    "bin",
    process.platform === "win32" ? "go.exe" : "go",
  );
  const candidateVersion = existsSync(candidate) ? commandVersion(candidate) : undefined;
  if (!candidateVersion?.includes(` ${pinnedGoVersion} `)) {
    fail(
      `${pinnedGoVersion} is required and must already be installed; automatic toolchain downloads are not used`,
    );
  }
  return candidate;
}

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function walkFiles(directory) {
  const result = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) result.push(...walkFiles(path));
    else if (entry.isFile()) result.push(path);
  }
  return result;
}

function escapeModulePath(path) {
  return path.replace(/[A-Z]/gu, (character) => `!${character.toLowerCase()}`);
}

function validateManifest() {
  if (
    manifest.schemaVersion !== 1 ||
    typeof manifest.repository !== "string" ||
    !/^[0-9a-f]{40}$/u.test(manifest.revision) ||
    manifest.vendorPath !== "vendor/typescript"
  ) {
    fail("typescript-fork.json is invalid or names an unexpected vendor path");
  }
}

function validateSource(source) {
  const revision = run("git", ["-C", source, "rev-parse", "HEAD"]).stdout.trim();
  if (revision !== manifest.revision) {
    fail(`source ${source} is ${revision}; require ${manifest.revision}`);
  }
  const status = run("git", [
    "-C",
    source,
    "status",
    "--porcelain=v1",
    "--untracked-files=all",
  ]).stdout.trim();
  if (status !== "") fail(`source ${source} is dirty:\n${status}`);
  const modulePath = resolve(source, "tsc/go.mod");
  if (
    !existsSync(modulePath) ||
    !readFileSync(modulePath, "utf8").includes(
      "module github.com/microsoft/TypeScript/tsc",
    )
  ) {
    fail(`${source} does not contain the TypeScript tsc Go module`);
  }
  const objects = run(
    "git",
    ["-C", source, "rev-list", "--objects", "--missing=print", "HEAD"],
    { env: { ...process.env, GIT_NO_LAZY_FETCH: "1" } },
  ).stdout;
  const missing = objects
    .split("\n")
    .filter((line) => line.startsWith("?"));
  if (missing.length > 0) {
    fail(
      `source object database is incomplete (${missing.length} promised objects); complete it before creating the offline bundle`,
    );
  }
}

function parseModules(tscDirectory, goCommand) {
  const environment = {
    ...process.env,
    GOTOOLCHAIN: "local",
    GOWORK: "off",
    GOFLAGS: "-mod=readonly",
  };
  const output = run(
    goCommand,
    [
      "list",
      "-m",
      "-f",
      "{{if not .Main}}{{.Path}} {{.Version}}{{end}}",
      "all",
    ],
    { cwd: tscDirectory, env: environment },
  ).stdout;
  return output
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const separator = line.lastIndexOf(" ");
      if (separator <= 0) fail(`could not parse module line ${JSON.stringify(line)}`);
      return { path: line.slice(0, separator), version: line.slice(separator + 1) };
    });
}

function populateProxy(staging, source, goCommand) {
  const proxy = resolve(staging, "go-proxy");
  const tscDirectory = resolve(source, "tsc");
  const modules = parseModules(tscDirectory, goCommand);
  const environment = {
    ...process.env,
    GOTOOLCHAIN: "local",
    GOWORK: "off",
    GOFLAGS: "",
  };
  const downloadDirectory = resolve(staging, ".module-download");
  mkdirSync(downloadDirectory);
  writeFileSync(
    resolve(downloadDirectory, "go.mod"),
    "module smithers.local/typescript-vendor\n\ngo 1.26\n",
  );
  for (const module of modules) {
    const specifier = `${module.path}@${module.version}`;
    const downloaded = run(goCommand, ["mod", "download", "-json", specifier], {
      cwd: downloadDirectory,
      env: environment,
    });
    const metadata = JSON.parse(downloaded.stdout);
    if (metadata.Error) fail(`could not vendor ${specifier}: ${metadata.Error}`);
    const versionDirectory = resolve(
      proxy,
      escapeModulePath(module.path),
      "@v",
    );
    mkdirSync(versionDirectory, { recursive: true });
    copyFileSync(metadata.Info, resolve(versionDirectory, `${module.version}.info`));
    copyFileSync(metadata.GoMod, resolve(versionDirectory, `${module.version}.mod`));
    copyFileSync(metadata.Zip, resolve(versionDirectory, `${module.version}.zip`));
    writeFileSync(resolve(versionDirectory, "list"), `${module.version}\n`);
  }
  rmSync(downloadDirectory, { recursive: true, force: true });
  return modules;
}

function createCapsule(source) {
  validateSource(source);
  const goCommand = resolveGo();
  mkdirSync(dirname(vendorDirectory), { recursive: true });
  const staging = mkdtempSync(resolve(tmpdir(), "smithers-typescript-vendor-"));
  const nextVendor = resolve(staging, "typescript");
  mkdirSync(nextVendor);
  try {
    const bundle = resolve(nextVendor, "typescript.bundle");
    run(
      "git",
      ["-C", source, "bundle", "create", bundle, "HEAD"],
      { env: { ...process.env, GIT_NO_LAZY_FETCH: "1" } },
    );
    const heads = run("git", ["bundle", "list-heads", bundle]).stdout.trim();
    if (heads !== `${manifest.revision} HEAD`) {
      fail(`created bundle has unexpected heads: ${heads}`);
    }
    copyFileSync(resolve(source, "tsc/LICENSE"), resolve(nextVendor, "LICENSE.typescript"));
    const modules = populateProxy(nextVendor, source, goCommand);
    const files = Object.fromEntries(
      walkFiles(nextVendor)
        .sort()
        .map((path) => [
          relative(nextVendor, path).split(sep).join("/"),
          sha256(path),
        ]),
    );
    const capsule = {
      schemaVersion: 1,
      format: "git-bundle+file-go-proxy",
      repository: manifest.repository,
      revision: manifest.revision,
      requestedLedgerStrategy: manifest.strategy,
      sourceBundle: "typescript.bundle",
      dependencyProxy: "go-proxy",
      dependencyModules: modules,
      files,
    };
    writeFileSync(
      resolve(nextVendor, "capsule.json"),
      `${JSON.stringify(capsule, null, 2)}\n`,
    );
    writeFileSync(
      resolve(nextVendor, "README.md"),
      "# TypeScript fork source capsule\n\n" +
        "This directory is generated by `node scripts/vendor-typescript.mjs sync`. " +
        "See `docs/TYPESCRIPT_FORK.md` for the measured vendoring decision and build instructions.\n",
    );

    if (existsSync(vendorDirectory)) {
      const existingCapsule = resolve(vendorDirectory, "capsule.json");
      if (!existsSync(existingCapsule)) {
        fail(`${relative(root, vendorDirectory)} exists without capsule.json; refusing to replace it`);
      }
      const backup = `${vendorDirectory}.previous-${process.pid}`;
      renameSync(vendorDirectory, backup);
      try {
        renameSync(nextVendor, vendorDirectory);
        rmSync(backup, { recursive: true, force: true });
      } catch (error) {
        if (!existsSync(vendorDirectory)) renameSync(backup, vendorDirectory);
        throw error;
      }
    } else {
      renameSync(nextVendor, vendorDirectory);
    }
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}

function inspectCapsule() {
  const errors = [];
  const capsulePath = resolve(vendorDirectory, "capsule.json");
  if (!existsSync(capsulePath)) {
    return {
      present: false,
      synchronized: false,
      errors: ["vendor/typescript/capsule.json is absent"],
    };
  }
  let capsule;
  try {
    capsule = JSON.parse(readFileSync(capsulePath, "utf8"));
  } catch (error) {
    return { present: true, synchronized: false, errors: [error.message] };
  }
  if (capsule.revision !== manifest.revision) {
    errors.push(`capsule revision ${capsule.revision} != ${manifest.revision}`);
  }
  if (capsule.format !== "git-bundle+file-go-proxy") {
    errors.push(`unsupported capsule format ${JSON.stringify(capsule.format)}`);
  }
  const files = capsule.files ?? {};
  for (const [name, digest] of Object.entries(files)) {
    const path = resolve(vendorDirectory, name);
    if (!existsSync(path)) errors.push(`missing ${name}`);
    else if (sha256(path) !== digest) errors.push(`digest mismatch for ${name}`);
  }
  const actualFiles = walkFiles(vendorDirectory)
    .map((path) => relative(vendorDirectory, path).split(sep).join("/"))
    .filter((path) => path !== "capsule.json" && path !== "README.md")
    .sort();
  if (JSON.stringify(actualFiles) !== JSON.stringify(Object.keys(files).sort())) {
    errors.push("payload file set differs from capsule.json");
  }
  const bundle = resolve(vendorDirectory, capsule.sourceBundle ?? "typescript.bundle");
  if (existsSync(bundle)) {
    const heads = run("git", ["bundle", "list-heads", bundle], {
      allowFailure: true,
    });
    if (heads.status !== 0 || heads.stdout.trim() !== `${manifest.revision} HEAD`) {
      errors.push("bundle HEAD does not match the pinned revision");
    }
  }
  return {
    present: true,
    synchronized: errors.length === 0,
    revision: capsule.revision,
    format: capsule.format,
    requestedLedgerStrategy: manifest.strategy,
    dependencyModules: capsule.dependencyModules?.length ?? 0,
    payloadFiles: Object.keys(files).length,
    payloadBytes: Object.keys(files).reduce((sum, name) => {
      const path = resolve(vendorDirectory, name);
      return sum + (existsSync(path) ? statSync(path).size : 0);
    }, 0),
    errors,
  };
}

function parseSyncSource(argv) {
  let source;
  while (argv.length > 0) {
    const argument = argv.shift();
    if (argument === "--source") {
      source = resolve(argv.shift() ?? fail("--source needs a path"));
    } else {
      fail(`unknown sync argument ${JSON.stringify(argument)}`);
    }
  }
  if (!source) fail("sync requires --source /path/to/exact/checkout");
  return source;
}

validateManifest();
const argv = process.argv.slice(2);
switch (argv.shift() ?? "status") {
  case "status":
    process.stdout.write(`${JSON.stringify(inspectCapsule(), null, 2)}\n`);
    break;
  case "verify": {
    const status = inspectCapsule();
    process.stdout.write(`${JSON.stringify(status, null, 2)}\n`);
    if (!status.synchronized) fail("vendored capsule verification failed");
    break;
  }
  case "sync": {
    createCapsule(parseSyncSource(argv));
    const status = inspectCapsule();
    process.stdout.write(`${JSON.stringify(status, null, 2)}\n`);
    if (!status.synchronized) fail("created capsule did not verify");
    break;
  }
  default:
    fail("usage: vendor-typescript.mjs [status|verify|sync --source CHECKOUT]");
}
