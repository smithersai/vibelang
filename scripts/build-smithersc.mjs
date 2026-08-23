#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmdirSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(
  readFileSync(resolve(root, "typescript-fork.json"), "utf8"),
);
const vendorDirectory = resolve(root, "vendor/typescript");
const capsulePath = resolve(vendorDirectory, "capsule.json");
const bundlePath = resolve(vendorDirectory, "typescript.bundle");
const proxyPath = resolve(vendorDirectory, "go-proxy");
const pinnedGoVersion = "go1.26.0";
const forkSources = [
  {
    logicalPath: "tsc/cmd/smithersc/main.go",
    sourcePath: resolve(root, "cmd/smithersc/forksrc/cmd/smithersc/main.go.txt"),
  },
  {
    logicalPath: "tsc/internal/smithers/marker.go",
    sourcePath: resolve(
      root,
      "cmd/smithersc/forksrc/internal/smithers/marker.go.txt",
    ),
  },
];

const buildSparsePatterns = [
  "/tsc/go.mod",
  "/tsc/go.sum",
  "/tsc/internal/collections/",
  "/tsc/internal/core/",
  "/tsc/internal/debug/",
  "/tsc/internal/json/",
  "/tsc/internal/stringutil/",
  "/tsc/internal/tspath/",
];

function fail(message) {
  console.error(`smithersc build: ${message}`);
  process.exit(1);
}

function run(command, args, options = {}) {
  const completed = spawnSync(command, args, {
    cwd: options.cwd ?? root,
    encoding: "utf8",
    env: options.env ?? process.env,
    input: options.input,
    maxBuffer: 128 * 1024 * 1024,
    stdio: options.capture === false ? "inherit" : "pipe",
  });
  if (completed.error) fail(completed.error.message);
  if (completed.status !== 0) {
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
      `${pinnedGoVersion} is required and must already be installed; automatic toolchain downloads are disabled`,
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

function makeWritable(path) {
  if (!existsSync(path)) return;
  const metadata = statSync(path);
  if (metadata.isDirectory()) {
    chmodSync(path, 0o700);
    for (const entry of readdirSync(path)) makeWritable(resolve(path, entry));
  } else {
    chmodSync(path, 0o600);
  }
}

function removeWorkDirectory(directory) {
  if (!existsSync(directory)) return;
  makeWritable(directory);
  rmSync(directory, { recursive: true, force: true });
}

function verifyCapsule() {
  if (!existsSync(capsulePath)) fail("vendor/typescript/capsule.json is absent");
  const capsule = JSON.parse(readFileSync(capsulePath, "utf8"));
  if (
    capsule.schemaVersion !== 1 ||
    capsule.format !== "git-bundle+file-go-proxy" ||
    capsule.revision !== manifest.revision
  ) {
    fail("the vendored capsule metadata does not match typescript-fork.json");
  }
  const expectedFiles = capsule.files;
  if (
    expectedFiles === null ||
    typeof expectedFiles !== "object" ||
    Array.isArray(expectedFiles)
  ) {
    fail("capsule.json has no file digest map");
  }
  for (const [name, digest] of Object.entries(expectedFiles)) {
    if (
      typeof digest !== "string" ||
      !/^[0-9a-f]{64}$/u.test(digest) ||
      name === "capsule.json" ||
      name.split(/[\\/]/u).includes("..")
    ) {
      fail(`capsule.json contains an invalid file entry: ${name}`);
    }
    const path = resolve(vendorDirectory, name);
    if (!existsSync(path) || sha256(path) !== digest) {
      fail(`vendored capsule file is absent or changed: ${name}`);
    }
  }
  const actualFiles = walkFiles(vendorDirectory)
    .map((path) => relative(vendorDirectory, path).split(sep).join("/"))
    .filter((path) => path !== "capsule.json" && path !== "README.md")
    .sort();
  const recordedFiles = Object.keys(expectedFiles).sort();
  if (JSON.stringify(actualFiles) !== JSON.stringify(recordedFiles)) {
    fail("vendored capsule has unrecorded or missing payload files");
  }
  const heads = run("git", ["bundle", "list-heads", bundlePath]).stdout.trim();
  if (heads !== `${manifest.revision} HEAD`) {
    fail(`bundle HEAD is ${JSON.stringify(heads)}; expected ${manifest.revision}`);
  }
  for (const source of forkSources) {
    if (!existsSync(source.sourcePath)) {
      fail(`fork-owned overlay source is absent: ${relative(root, source.sourcePath)}`);
    }
  }
  return capsule;
}

function parseArguments(argv) {
  const result = {
    command: "build",
    checkout: undefined,
    output: resolve(
      root,
      `node_modules/.cache/smithers/${process.platform === "win32" ? "smithersc.exe" : "smithersc"}`,
    ),
  };
  if (argv[0] === "build" || argv[0] === "verify") result.command = argv.shift();
  while (argv.length > 0) {
    const argument = argv.shift();
    switch (argument) {
      case "--checkout":
        result.checkout = resolve(argv.shift() ?? fail("--checkout needs a path"));
        break;
      case "--output":
        result.output = resolve(argv.shift() ?? fail("--output needs a path"));
        break;
      case "--help":
        process.stdout.write(
          "usage: build-smithersc.mjs [build|verify] [--checkout PATH] [--output PATH]\n" +
            "\nverify performs two isolated offline builds and requires identical SHA-256 digests.\n",
        );
        process.exit(0);
        break;
      default:
        fail(`unknown argument ${JSON.stringify(argument)}`);
    }
  }
  return result;
}

function verifyCheckout(checkout) {
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
    fail(`${checkout} does not contain the pinned tsc Go module`);
  }
}

function materializeCheckout(workDirectory) {
  const checkout = resolve(workDirectory, "typescript");
  run("git", [
    "-c",
    "protocol.file.allow=always",
    "clone",
    "--quiet",
    "--no-checkout",
    bundlePath,
    checkout,
  ]);
  run("git", ["-C", checkout, "sparse-checkout", "init", "--no-cone"]);
  run(
    "git",
    ["-C", checkout, "sparse-checkout", "set", "--no-cone", "--stdin"],
    { input: `${buildSparsePatterns.join("\n")}\n` },
  );
  run("git", ["-C", checkout, "checkout", "--quiet", "--detach", manifest.revision]);
  verifyCheckout(checkout);
  return checkout;
}

function buildOnce(requestedCheckout, goCommand) {
  const workDirectory = mkdtempSync(join(tmpdir(), "smithers-smithersc-build-"));
  const createdDirectories = [];
  const injectedSources = [];
  function removeInjectedSources() {
    for (const source of injectedSources) {
      if (existsSync(source)) rmSync(source);
    }
  }
  function removeCreatedDirectories() {
    for (const directory of createdDirectories.sort(
      (left, right) => right.length - left.length,
    )) {
      if (existsSync(directory)) rmdirSync(directory);
    }
  }
  try {
    const checkout = requestedCheckout ?? materializeCheckout(workDirectory);
    verifyCheckout(checkout);
    for (const source of forkSources) {
      const logicalSource = resolve(checkout, source.logicalPath);
      if (existsSync(logicalSource)) {
        fail(`refusing to replace existing fork source ${logicalSource}`);
      }
      let directory = dirname(logicalSource);
      const missingDirectories = [];
      while (!existsSync(directory)) {
        missingDirectories.push(directory);
        directory = dirname(directory);
      }
      mkdirSync(dirname(logicalSource), { recursive: true });
      createdDirectories.push(...missingDirectories);
      copyFileSync(source.sourcePath, logicalSource);
      injectedSources.push(logicalSource);
    }
    const output = resolve(workDirectory, "smithersc");
    const moduleCache = resolve(workDirectory, "gomodcache");
    mkdirSync(moduleCache);
    const environment = {
      ...process.env,
      CGO_ENABLED: "0",
      GOENV: "off",
      GOFLAGS: "",
      GOMODCACHE: moduleCache,
      GONOPROXY: "none",
      GONOSUMDB: "*",
      GOPRIVATE: "",
      GOPROXY: pathToFileURL(proxyPath).href,
      GOSUMDB: "off",
      GOTOOLCHAIN: "local",
      GOWORK: "off",
    };
    run(goCommand, ["version"], { env: environment });
    run(
      goCommand,
      [
        "build",
        "-mod=mod",
        "-trimpath",
        "-buildvcs=false",
        "-ldflags",
        `-buildid= -X github.com/microsoft/TypeScript/tsc/internal/smithers.ForkRevision=${manifest.revision}`,
        "-o",
        output,
        "./cmd/smithersc",
      ],
      { cwd: resolve(checkout, "tsc"), env: environment },
    );
    const identity = run(output, ["--version"], { env: environment }).stdout.trim();
    removeInjectedSources();
    removeCreatedDirectories();
    verifyCheckout(checkout);
    return {
      checkout,
      digest: sha256(output),
      identity,
      output,
      workDirectory,
    };
  } catch (error) {
    removeInjectedSources();
    removeCreatedDirectories();
    removeWorkDirectory(workDirectory);
    throw error;
  }
}

function installBuild(build, output) {
  mkdirSync(dirname(output), { recursive: true });
  copyFileSync(build.output, output);
  chmodSync(output, statSync(build.output).mode);
}

verifyCapsule();
const args = parseArguments(process.argv.slice(2));
const goCommand = resolveGo();
const builds = [];
try {
  builds.push(buildOnce(args.checkout, goCommand));
  if (args.command === "verify") {
    builds.push(buildOnce(args.checkout, goCommand));
    if (builds[0].digest !== builds[1].digest) {
      fail(
        `reproducibility failure: ${builds[0].digest} != ${builds[1].digest}`,
      );
    }
  }
  installBuild(builds[0], args.output);
  process.stdout.write(
    `${JSON.stringify(
      {
        command: args.command,
        output: args.output,
        revision: manifest.revision,
        sha256: builds[0].digest,
        secondSha256: builds[1]?.digest,
        reproducible:
          args.command === "verify" ? builds[0].digest === builds[1].digest : undefined,
        identity: builds[0].identity.split("\n"),
        offlineProxy: proxyPath,
        goVersion: commandVersion(goCommand),
      },
      null,
      2,
    )}\n`,
  );
} finally {
  for (const build of builds) {
    removeWorkDirectory(build.workDirectory);
  }
}
