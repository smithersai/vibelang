import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  cpSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, posix, relative, resolve, sep } from "node:path";
import ts from "typescript-js";

const root = resolve(import.meta.dirname, "..");
const fixtureRoot = resolve(import.meta.dirname, "release-fixtures");
const temporaryPrefix = "vibelang-release-verify-";
// Canonicalize the workspace base: on macOS os.tmpdir() sits behind the
// /var -> /private/var symlink, while the installed CLI realpaths inputs and
// reports /private/var/... paths. Both the workspace and the cleanup guard
// must use the same canonical spelling for exact path comparisons to hold.
const temporaryBase = realpathSync(tmpdir());
const temporary = mkdtempSync(join(temporaryBase, temporaryPrefix));
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const bun = process.platform === "win32" ? "bun.exe" : "bun";
const commandTimeout = Number(process.env.VIBE_VERIFY_TIMEOUT_MS ?? "") || 900_000;
const releaseAssetCacheIdentities = new Set();

function execute(command, args, cwd, options = {}) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    timeout: options.timeout ?? commandTimeout,
    env: { ...process.env, ...options.env },
  });
  if (result.error) throw result.error;
  if (result.signal) throw new Error(`${command} ${args.join(" ")} terminated by ${result.signal}`);
  if (!options.allowFailure && result.status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} failed with ${result.status}\n${result.stdout}${result.stderr}`,
    );
  }
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

function rejectWarnings(label, output) {
  if (/^npm\s+warn(?:ing)?\b/im.test(output) || /(^|\n)\s*warning[: ]/im.test(output)) {
    throw new Error(`${label} emitted a warning:\n${output}`);
  }
}

function sha256(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

function releaseInputDigest(packagedPaths) {
  const paths = new Set(packagedPaths
    .filter((file) => !file.startsWith("dist/") && !file.startsWith("poc/dist/")));
  for (const file of walkFiles(join(root, "src"))) paths.add(`src/${file}`);
  for (const file of walkFiles(join(root, "poc/src"))) paths.add(`poc/src/${file}`);
  for (const file of [
    "package-lock.json",
    "tsconfig.build.json",
    "poc/tsconfig.json",
    "poc/tsconfig.emit.json",
    "scripts/clean-root-dist.mjs",
    "scripts/clean-poc-dist.mjs",
    "scripts/copy-poc-assets.mjs",
    "scripts/verify-pack.mjs",
  ]) paths.add(file);
  for (const file of walkFiles(join(root, "scripts/release-fixtures"))) {
    paths.add(`scripts/release-fixtures/${file}`);
  }
  const hash = createHash("sha256");
  for (const file of [...paths].sort()) {
    const absolute = join(root, file);
    const metadata = lstatSync(absolute);
    if (!metadata.isFile()) throw new Error(`release input is not a regular file: ${file}`);
    hash.update(file).update("\0").update(String(metadata.mode & 0o777)).update("\0");
    hash.update(readFileSync(absolute)).update("\0");
  }
  return hash.digest("hex");
}

function portable(path) {
  return path.split(sep).join("/");
}

function walkFiles(directory, base = directory) {
  const output = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`generated/package tree contains a symlink: ${path}`);
    if (entry.isDirectory()) output.push(...walkFiles(path, base));
    else if (entry.isFile()) output.push(portable(relative(base, path)));
    else throw new Error(`generated/package tree contains a non-file entry: ${path}`);
  }
  return output.sort();
}

function assertSameInventory(label, actualValues, expectedValues) {
  const actual = [...actualValues].sort();
  const expected = [...expectedValues].sort();
  const actualSet = new Set(actual);
  const expectedSet = new Set(expected);
  const missing = expected.filter((file) => !actualSet.has(file));
  const extra = actual.filter((file) => !expectedSet.has(file));
  if (missing.length > 0 || extra.length > 0) {
    throw new Error(
      `${label} inventory mismatch` +
      `${missing.length ? `\nmissing: ${missing.join(", ")}` : ""}` +
      `${extra.length ? `\nextra/stale: ${extra.join(", ")}` : ""}`,
    );
  }
}

function expectedEmit(
  sourceRoot,
  outputRoot,
  include,
  extensions = [".js", ".js.map", ".d.ts", ".d.ts.map"],
) {
  return walkFiles(sourceRoot)
    .filter((file) => file.endsWith(".ts") && include(file))
    .flatMap((file) => {
      const stem = file.slice(0, -3);
      return extensions.map((extension) => `${outputRoot}/${stem}${extension}`);
    });
}

function assertStaticPackageInventory(paths) {
  const expected = [
    "LICENSE",
    "README.md",
    "package.json",
    "typescript-fork.json",
    "docs/COMPATIBILITY_API.md",
    // npm includes nested package-adjacent READMEs alongside selected files.
    "docs/README.md",
    "docs/TYPESCRIPT_FORK.md",
    "poc/README.md",
    ...walkFiles(join(root, "bin")).map((file) => `bin/${file}`),
    ...walkFiles(join(root, "compat")).map((file) => `compat/${file}`),
    ...walkFiles(join(root, "src")).map((file) => `src/${file}`),
  ];
  const actual = paths.filter((file) => !file.startsWith("dist/") && !file.startsWith("poc/dist/"));
  assertSameInventory("packed static/source files", actual, expected);
}

function assertGeneratedInventory() {
  const rootExpected = expectedEmit(join(root, "src"), "dist", () => true);
  const pocExpected = expectedEmit(
    join(root, "poc/src"),
    "poc/dist",
    (file) => !file.endsWith(".test.ts") && file !== "demo.ts",
    [".js", ".js.map", ".d.ts"],
  );
  pocExpected.push("poc/dist/agent/deno-runner.js", "poc/dist/build/loader-runner.js");
  assertSameInventory(
    "root generated output",
    walkFiles(join(root, "dist")).map((file) => `dist/${file}`),
    rootExpected,
  );
  assertSameInventory(
    "POC generated output",
    walkFiles(join(root, "poc/dist")).map((file) => `poc/dist/${file}`),
    pocExpected,
  );
  return [...rootExpected, ...pocExpected].sort();
}

function pack(directory) {
  mkdirSync(directory, { recursive: true });
  const packed = execute(npm, [
    "pack",
    "--ignore-scripts",
    "--json",
    "--pack-destination",
    directory,
  ], root);
  rejectWarnings("npm pack", `${packed.stdout}\n${packed.stderr}`);
  let report;
  try {
    report = JSON.parse(packed.stdout);
  } catch (cause) {
    throw new Error("npm pack did not return valid JSON", { cause });
  }
  if (!Array.isArray(report) || report.length !== 1 || typeof report[0]?.filename !== "string") {
    throw new Error("npm pack returned an unexpected report");
  }
  const tarball = resolve(directory, report[0].filename);
  if (dirname(tarball) !== resolve(directory) || basename(tarball) !== report[0].filename) {
    throw new Error(`npm pack returned an unsafe filename: ${report[0].filename}`);
  }
  if (!statSync(tarball).isFile()) throw new Error("npm pack did not create a regular tarball");
  return { report: report[0], tarball };
}

function manifest(report) {
  if (!Array.isArray(report.files) || report.files.length === 0) throw new Error("npm pack reported no files");
  if (report.entryCount !== report.files.length) throw new Error("npm pack entry count disagrees with its file list");
  return report.files.map((entry) => ({ path: entry.path, size: entry.size, mode: entry.mode }));
}

function exportTargets(value, label, output = []) {
  if (typeof value === "string") {
    if (!value.startsWith("./") || value.includes("\\") || value.split("/").includes("..")) {
      throw new Error(`${label} has unsafe package target ${JSON.stringify(value)}`);
    }
    output.push(value.slice(2));
    return output;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} has an unsupported export target`);
  }
  for (const [condition, target] of Object.entries(value)) exportTargets(target, `${label}.${condition}`, output);
  return output;
}

function packageDependencyName(specifier) {
  if (specifier.startsWith("@")) return specifier.split("/").slice(0, 2).join("/");
  return specifier.split("/")[0];
}

function runtimeEdges(source, file) {
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const edges = [];
  const visit = (node) => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier !== undefined && ts.isStringLiteralLike(node.moduleSpecifier)
    ) {
      edges.push(node.moduleSpecifier.text);
    }
    const literalImport = ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword && node.arguments.length >= 1;
    const literalRequire = ts.isCallExpression(node) && node.arguments.length === 1 &&
      ts.isIdentifier(node.expression) && node.expression.text === "require";
    const literalRequireResolve = ts.isCallExpression(node) && node.arguments.length === 1 &&
      ts.isPropertyAccessExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression) && node.expression.expression.text === "require" &&
      node.expression.name.text === "resolve";
    if ((literalImport || literalRequire || literalRequireResolve) && ts.isStringLiteralLike(node.arguments[0])) {
      edges.push(node.arguments[0].text);
    }
    if (
      ts.isNewExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "URL" &&
      node.arguments !== undefined && node.arguments.length === 2 &&
      ts.isStringLiteralLike(node.arguments[0]) && node.arguments[0].text.startsWith(".")
    ) {
      edges.push(node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return edges;
}

function assertPackagedRuntimeClosure(packageJson, paths) {
  const pathSet = new Set(paths);
  const declared = new Set(Object.keys(packageJson.dependencies ?? {}));
  const packageExports = new Set(Object.keys(packageJson.exports ?? {}).map((name) =>
    name === "." ? packageJson.name : `${packageJson.name}${name.slice(1)}`));
  for (const file of paths.filter((path) => /\.(?:c|m)?js$/.test(path))) {
    const source = readFileSync(join(root, file), "utf8");
    for (const specifier of runtimeEdges(source, file)) {
      if (specifier.startsWith(".")) {
        const target = posix.normalize(posix.join(posix.dirname(file), specifier));
        if (target.startsWith("../") || !pathSet.has(target)) {
          throw new Error(`packaged runtime edge is missing or escapes the package: ${file} -> ${specifier}`);
        }
        continue;
      }
      if (specifier.startsWith("node:") || specifier.startsWith("bun:")) continue;
      if (packageExports.has(specifier)) continue;
      if (!declared.has(packageDependencyName(specifier))) {
        throw new Error(`packaged runtime edge uses undeclared dependency: ${file} -> ${specifier}`);
      }
    }
  }
}

function assertPackagedSourceMaps(paths) {
  const pathSet = new Set(paths);
  for (const file of paths.filter((path) => path.endsWith(".map"))) {
    let map;
    try {
      map = JSON.parse(readFileSync(join(root, file), "utf8"));
    } catch (cause) {
      throw new Error(`packaged source map is not valid JSON: ${file}`, { cause });
    }
    if (
      map === null || typeof map !== "object" || map.version !== 3 ||
      !Array.isArray(map.sources) ||
      (map.sourcesContent !== undefined && !Array.isArray(map.sourcesContent))
    ) {
      throw new Error(`packaged source map has an invalid version or sources table: ${file}`);
    }
    if (map.sourcesContent !== undefined && map.sourcesContent.length !== map.sources.length) {
      throw new Error(`packaged source map sourcesContent length disagrees with sources: ${file}`);
    }
    const sourceRoot = map.sourceRoot ?? "";
    if (typeof sourceRoot !== "string" || sourceRoot.includes("\\") || isAbsolute(sourceRoot)) {
      throw new Error(`packaged source map has an unsafe sourceRoot: ${file}`);
    }
    for (const [index, source] of map.sources.entries()) {
      if (typeof source !== "string" || source.includes("\\") || isAbsolute(source)) {
        throw new Error(`packaged source map has an unsafe source at index ${index}: ${file}`);
      }
      const embedded = map.sourcesContent?.[index];
      if (embedded !== undefined && embedded !== null && typeof embedded !== "string") {
        throw new Error(`packaged source map has non-text sourcesContent at index ${index}: ${file}`);
      }
      const target = posix.normalize(posix.join(posix.dirname(file), sourceRoot, source));
      if ((embedded === undefined || embedded === null) && (target.startsWith("../") || !pathSet.has(target))) {
        throw new Error(`packaged source map references an unshipped source without embedded content: ${file} -> ${source}`);
      }
    }
  }
}

function assertPackagedMarkdownLinks(paths) {
  const pathSet = new Set(paths);
  for (const file of paths.filter((path) => path.endsWith(".md"))) {
    const source = readFileSync(join(root, file), "utf8");
    for (const match of source.matchAll(/\[[^\]]*\]\(([^)\s]+)(?:\s+[^)]*)?\)/g)) {
      const link = match[1];
      if (/^(?:[a-z][a-z0-9+.-]*:|#)/i.test(link)) continue;
      const local = link.split(/[?#]/, 1)[0];
      let decoded;
      try {
        decoded = decodeURIComponent(local);
      } catch {
        throw new Error(`packaged Markdown has an invalid percent-encoded link: ${file} -> ${link}`);
      }
      if (!decoded || decoded.includes("\\") || isAbsolute(decoded)) {
        throw new Error(`packaged Markdown has an unsafe local link: ${file} -> ${link}`);
      }
      const target = posix.normalize(posix.join(posix.dirname(file), decoded));
      if (target.startsWith("../") || !pathSet.has(target)) {
        throw new Error(`packaged Markdown links to an unshipped file: ${file} -> ${link}`);
      }
    }
  }
}

function assertPackageManifest(report, generatedFiles) {
  const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  const entries = manifest(report);
  const paths = entries.map((entry) => entry.path);
  const pathSet = new Set(paths);
  if (pathSet.size !== paths.length) throw new Error("package contains duplicate paths");
  const portableOwners = new Map();
  for (const entry of entries) {
    if (
      !entry.path || entry.path.includes("\\") || isAbsolute(entry.path) ||
      posix.normalize(entry.path) !== entry.path || entry.path.split("/").includes("..")
    ) throw new Error(`package contains an unsafe path: ${entry.path}`);
    if (entry.path.normalize("NFC") !== entry.path) {
      throw new Error(`package path is not Unicode NFC: ${entry.path}`);
    }
    for (const component of entry.path.split("/")) {
      if (
        /[\u0000-\u001f<>:"|?*]/.test(component) || /[ .]$/.test(component) ||
        /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(component)
      ) {
        throw new Error(`package path is not portable to Windows: ${entry.path}`);
      }
    }
    const portableIdentity = entry.path.normalize("NFC").toLowerCase();
    const prior = portableOwners.get(portableIdentity);
    if (prior) throw new Error(`package paths collide on case-insensitive filesystems: ${prior}, ${entry.path}`);
    portableOwners.set(portableIdentity, entry.path);
    if (!Number.isSafeInteger(entry.size) || entry.size < 0 || !Number.isSafeInteger(entry.mode)) {
      throw new Error(`package has invalid metadata for ${entry.path}`);
    }
  }

  const binTargets = new Set(Object.values(packageJson.bin).map((target) => target.replace(/^\.\//, "")));
  const targets = [
    packageJson.main,
    packageJson.types,
    ...Object.entries(packageJson.exports).flatMap(([name, target]) => exportTargets(target, `exports[${JSON.stringify(name)}]`)),
    ...binTargets,
    "poc/dist/agent/deno-runner.js",
    "poc/dist/build/loader-runner.js",
  ];
  for (const target of new Set(targets)) {
    if (typeof target !== "string" || !pathSet.has(target.replace(/^\.\//, ""))) {
      throw new Error(`package is missing declared target ${String(target)}`);
    }
  }
  for (const entry of entries) {
    const executable = (entry.mode & 0o111) !== 0;
    if (binTargets.has(entry.path)) {
      if (!executable) throw new Error(`package bin lost executable permission: ${entry.path}`);
    } else if (executable) {
      throw new Error(`unexpected executable file in package: ${entry.path}`);
    }
  }

  const packagedGenerated = paths.filter((file) => file.startsWith("dist/") || file.startsWith("poc/dist/"));
  assertSameInventory("packed generated output", packagedGenerated, generatedFiles);
  assertStaticPackageInventory(paths);
  const retired = paths.filter((file) => /(^|\/)syntax\.(?:js|d\.ts)(?:\.map)?$/.test(file));
  if (retired.length > 0) throw new Error(`package contains retired generated files: ${retired.join(", ")}`);
  const debris = paths.filter((file) =>
    /(^|\/)(?:node_modules|coverage|\.git)(?:\/|$)/.test(file) ||
    /(?:\.tgz|\.tmp|\.tsbuildinfo|\.DS_Store)$/.test(file));
  if (debris.length > 0) throw new Error(`package contains release debris: ${debris.join(", ")}`);
  const testArtifacts = paths.filter((file) =>
    /(^|\/)(?:test|tests)\/fixtures(?:\/|$)/.test(file) ||
    /(^|\/)poc\/test(?:\/|$)/.test(file) ||
    /(^|\/)[^/]+\.(?:test|spec)\.[^/]+$/.test(file) ||
    /(^|\/)scripts\/release-fixtures(?:\/|$)/.test(file));
  if (testArtifacts.length > 0) {
    throw new Error(`package contains test fixtures or helpers: ${testArtifacts.join(", ")}`);
  }
  assertPackagedRuntimeClosure(packageJson, paths);
  assertPackagedSourceMaps(paths);
  assertPackagedMarkdownLinks(paths);
  return { packageJson, paths };
}

function installWithNpm(tarball, consumer) {
  mkdirSync(consumer, { recursive: true });
  writeFileSync(join(consumer, "package.json"), '{"name":"vibelang-node-release-consumer","private":true,"type":"module"}\n');
  const installed = execute(npm, [
    "install",
    "--ignore-scripts",
    "--no-audit",
    "--no-fund",
    "--save-exact",
    tarball,
  ], consumer);
  rejectWarnings("npm install", `${installed.stdout}\n${installed.stderr}`);
  execute(npm, ["ls", "--all"], consumer);
  // npm audit exits nonzero when it finds vulnerabilities, so capture the
  // output instead of throwing generically; every nonzero exit still fails.
  const audited = execute(npm, ["audit", "--omit=dev", "--audit-level=low", "--json"], consumer, {
    allowFailure: true,
  });
  let audit;
  try {
    audit = JSON.parse(audited.stdout);
  } catch (cause) {
    throw new Error(`npm audit did not return valid JSON:\n${audited.stdout}${audited.stderr}`, { cause });
  }
  if (
    audited.status !== 0 ||
    audit.metadata?.vulnerabilities?.total !== 0 ||
    Object.keys(audit.vulnerabilities ?? {}).length !== 0
  ) {
    throw new Error(`installed production graph has audit findings: ${audited.stdout}`);
  }
}

function copyReleaseFixtures(consumer) {
  // force: false is required for errorOnExist to be enforced; the default
  // force: true would silently overwrite instead of erroring.
  cpSync(fixtureRoot, join(consumer, "release-fixtures"), { recursive: true, errorOnExist: true, force: false });
}

function installedPackageRoot(consumer) {
  return join(consumer, "node_modules/vibelang");
}

function assertInstalledPackage(consumer, packedPaths) {
  const installedRoot = installedPackageRoot(consumer);
  assertSameInventory("installed tarball", walkFiles(installedRoot), packedPaths);
  const assetPairs = [
    ["poc/src/agent/deno-runner.js", "poc/dist/agent/deno-runner.js"],
    ["poc/src/build/loader-runner.js", "poc/dist/build/loader-runner.js"],
  ];
  for (const [source, installed] of assetPairs) {
    if (sha256(join(root, source)) !== sha256(join(installedRoot, installed))) {
      throw new Error(`installed asset differs from build source: ${installed}`);
    }
  }
  if (process.platform !== "win32") {
    const metadata = JSON.parse(readFileSync(join(installedRoot, "package.json"), "utf8"));
    for (const [name, target] of Object.entries(metadata.bin)) {
      if ((statSync(join(installedRoot, target)).mode & 0o111) === 0) {
        throw new Error(`installed bin target is not executable: ${target}`);
      }
      const linked = join(consumer, "node_modules/.bin", name);
      if ((statSync(linked).mode & 0o111) === 0) throw new Error(`installed bin link is not executable: ${name}`);
    }
    execute(join(consumer, "node_modules/.bin/vibec"), ["--version"], consumer);
    execute(join(consumer, "node_modules/.bin/vibe"), ["--help"], consumer);
  }
}

function writeTypeConsumer(consumer, exportsMap) {
  const namespaces = [];
  const imports = [];
  let index = 0;
  for (const exportName of Object.keys(exportsMap).sort()) {
    const specifier = exportName === "." ? "vibelang" : `vibelang${exportName.slice(1)}`;
    if (exportName === "./package.json") {
      imports.push(`import packageMetadata from ${JSON.stringify(specifier)} with { type: "json" };`);
      namespaces.push("packageMetadata");
      continue;
    }
    const name = `packageExport${index++}`;
    imports.push(`import * as ${name} from ${JSON.stringify(specifier)};`);
    namespaces.push(name);
  }
  const representative = readFileSync(join(fixtureRoot, "api-types.mts"), "utf8");
  writeFileSync(
    join(consumer, "release-types.mts"),
    `${imports.join("\n")}\n${representative}\nvoid [${namespaces.join(", ")}];\n`,
  );
  copyFileSync(join(fixtureRoot, "bun-sqlite.d.ts"), join(consumer, "bun-sqlite.d.ts"));
  copyFileSync(join(fixtureRoot, "node-globals.d.ts"), join(consumer, "node-globals.d.ts"));
  writeFileSync(join(consumer, "tsconfig.json"), `${JSON.stringify({
    compilerOptions: {
      target: "ES2022",
      module: "NodeNext",
      moduleResolution: "NodeNext",
      strict: true,
      noEmit: true,
      resolveJsonModule: true,
      types: [],
      // typescript@7's published unstable api.d.ts uses Symbol.dispose, so
      // consuming vibelang/unstable/* genuinely requires the disposable lib;
      // everything else stays at ES2022 so the no-skipLibCheck gate remains
      // as strict as before.
      lib: ["ES2022", "DOM", "ESNext.Disposable"],
    },
    files: ["release-types.mts", "bun-sqlite.d.ts", "node-globals.d.ts"],
  }, null, 2)}\n`);
  const tsc = join(consumer, "node_modules/typescript-js/lib/tsc.js");
  execute(process.execPath, [tsc, "-p", "tsconfig.json"], consumer);
}

function verifyCli(consumer) {
  const cli = join(installedPackageRoot(consumer), "bin/vibe.js");
  const compilerCli = join(installedPackageRoot(consumer), "bin/vibec.js");
  const project = join(consumer, "release-fixtures/project");
  const main = join(project, "main.vibe");
  const checked = execute(process.execPath, [cli, "check", main, "--format", "json"], consumer);
  const checkReport = JSON.parse(checked.stdout);
  if (!checkReport.ok || checkReport.files.length !== 2) throw new Error(`installed CLI project check failed: ${checked.stdout}`);

  const output = join(consumer, "compiled-project");
  const compiled = execute(process.execPath, [
    cli,
    "compile",
    main,
    "--outDir",
    output,
    "--declaration",
    "--sourceMap",
    "--format",
    "json",
  ], consumer);
  const compileReport = JSON.parse(compiled.stdout);
  if (!compileReport.ok || compileReport.files.length !== 2) throw new Error(`installed CLI project compile failed: ${compiled.stdout}`);
  for (const file of ["main.mjs", "service.mjs", "main.d.mts", "service.d.mts", "main.mjs.map", "service.mjs.map"]) {
    if (!statSync(join(output, file)).isFile()) throw new Error(`installed CLI omitted ${file}`);
  }
  if (!/from ["']\.\/service\.mjs["']/.test(readFileSync(join(output, "main.mjs"), "utf8"))) {
    throw new Error("installed CLI did not rewrite a cross-module import");
  }
  const mainReport = compileReport.files.find((file) => file.input === main);
  const assetModules = mainReport?.assets?.modules;
  if (!Array.isArray(assetModules) || assetModules.length !== 1) {
    throw new Error(`installed CLI did not report exactly one source asset: ${compiled.stdout}`);
  }
  const logicalKey = assetModules[0]?.logicalKey;
  if (typeof logicalKey !== "string" || !/^[0-9a-f]{64}$/.test(logicalKey)) {
    throw new Error("installed CLI reported an invalid source-asset logical key");
  }
  const assetCacheIdentity = mainReport?.assets?.cacheIdentity;
  if (typeof assetCacheIdentity !== "string" || !/^[0-9a-f]{64}$/.test(assetCacheIdentity)) {
    throw new Error("installed CLI reported an invalid source-asset cache identity");
  }
  releaseAssetCacheIdentities.add(assetCacheIdentity);
  const assetBase = join(output, "__vibelang_assets__", logicalKey);
  for (const file of [`${assetBase}.mjs`, `${assetBase}.mjs.map`, `${assetBase}.d.mts`]) {
    if (!statSync(file).isFile()) throw new Error(`installed CLI omitted generated source asset ${file}`);
  }
  const emittedMain = readFileSync(join(output, "main.mjs"), "utf8");
  if (!emittedMain.includes(`__vibelang_assets__/${logicalKey}.mjs`)) {
    throw new Error("installed CLI did not rewrite the source-asset import");
  }
  if (/\b(?:with|assert)\s*\{/.test(emittedMain)) {
    throw new Error("installed CLI left import attributes on generated JavaScript");
  }
  if (!/releaseAssetAnswer\s*=\s*config\.answer/.test(emittedMain)) {
    throw new Error("installed CLI dropped the runtime source-asset binding");
  }
  if (!/Result<string, Missing>/.test(readFileSync(join(output, "main.d.mts"), "utf8"))) {
    throw new Error("installed CLI declaration lost its checked Result channel");
  }
  if (!/releaseAssetAnswer:\s*42/.test(readFileSync(join(output, "main.d.mts"), "utf8"))) {
    throw new Error("installed CLI declaration lost const source-asset typing");
  }
  const sourceMap = JSON.parse(readFileSync(join(output, "main.mjs.map"), "utf8"));
  if (sourceMap.version !== 3 || !sourceMap.sourcesContent?.some((source) => /function run/.test(source))) {
    throw new Error("installed CLI emitted an incomplete source map");
  }
  execute(process.execPath, [join(output, "main.mjs")], consumer);
  execute(process.execPath, [cli, "run", main], consumer);
  execute(process.execPath, [compilerCli, "--version"], consumer);

  const failedOutput = join(consumer, "failed-project");
  const failed = execute(process.execPath, [
    cli,
    "compile",
    join(project, "missing.vibe"),
    "--outDir",
    failedOutput,
    "--format",
    "json",
  ], consumer, { allowFailure: true });
  if (failed.status === 0) throw new Error("installed CLI accepted a missing project module");
  const failedReport = JSON.parse(failed.stdout);
  if (failedReport.ok !== false) throw new Error("installed CLI missing-module report was not fail-closed");
  if (lstatExists(join(failedOutput, "missing.mjs"))) throw new Error("failed installed CLI compile wrote output");
}

function lstatExists(path) {
  try {
    lstatSync(path);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

function installWithBun(tarball, consumer) {
  mkdirSync(consumer, { recursive: true });
  writeFileSync(join(consumer, "package.json"), '{"name":"vibelang-bun-release-consumer","private":true,"type":"module"}\n');
  const installed = execute(bun, ["add", "--ignore-scripts", "--no-save", tarball], consumer);
  rejectWarnings("bun add", `${installed.stdout}\n${installed.stderr}`);
}

function safeCleanup(path) {
  const resolved = resolve(path);
  if (dirname(resolved) !== temporaryBase || !basename(resolved).startsWith(temporaryPrefix)) {
    throw new Error(`Refusing to remove unexpected release verification path: ${resolved}`);
  }
  rmSync(resolved, { recursive: true, force: true });
}

function safeCleanupAssetCache(identity) {
  if (typeof identity !== "string" || !/^[0-9a-f]{64}$/.test(identity)) {
    throw new Error(`Refusing to remove invalid source-asset cache identity: ${String(identity)}`);
  }
  const cacheRoot = resolve(tmpdir(), "vibelang-source-asset-cache-v1");
  const target = resolve(cacheRoot, identity);
  if (dirname(target) !== cacheRoot || basename(target) !== identity) {
    throw new Error(`Refusing to remove unexpected source-asset cache path: ${target}`);
  }
  rmSync(target, { recursive: true, force: true });
}

try {
  const lifecyclePackageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  if (lifecyclePackageJson.scripts?.prepack !== "npm run test") {
    throw new Error("plain npm pack must retain the non-recursive `npm run test` prepack contract");
  }
  execute(npm, ["run", "clean:dist"], root);
  execute(npm, ["run", "clean:poc"], root);
  if (lstatExists(join(root, "dist")) || lstatExists(join(root, "poc/dist"))) {
    throw new Error("release clean lifecycle left a generated output tree behind");
  }
  const lifecycle = execute(npm, ["run", "prepack"], root);
  rejectWarnings("npm prepack", `${lifecycle.stdout}\n${lifecycle.stderr}`);
  const initialGenerated = assertGeneratedInventory();
  const first = pack(join(temporary, "pack-a"));
  const firstManifest = assertPackageManifest(first.report, initialGenerated);
  const firstInputDigest = releaseInputDigest(firstManifest.paths);

  // Rebuild from clean output directories before the second pack. This proves
  // generated bytes and the archive container are deterministic together.
  execute(npm, ["run", "build"], root);
  const rebuiltGenerated = assertGeneratedInventory();
  const second = pack(join(temporary, "pack-b"));
  const secondManifest = assertPackageManifest(second.report, rebuiltGenerated);
  const secondInputDigest = releaseInputDigest(secondManifest.paths);

  if (firstInputDigest !== secondInputDigest) {
    throw new Error("release inputs changed during verification; retry without concurrent source or package edits");
  }

  const firstDigest = sha256(first.tarball);
  const secondDigest = sha256(second.tarball);
  if (firstDigest !== secondDigest) {
    throw new Error(`package tarball is nondeterministic across clean builds: ${firstDigest} != ${secondDigest}`);
  }
  if (JSON.stringify(manifest(first.report)) !== JSON.stringify(manifest(second.report))) {
    throw new Error("package file content/mode manifest is nondeterministic across clean builds");
  }
  if (JSON.stringify(firstManifest.paths) !== JSON.stringify(secondManifest.paths)) {
    throw new Error("package path manifest is nondeterministic across clean builds");
  }

  const nodeConsumer = join(temporary, "node-consumer");
  installWithNpm(second.tarball, nodeConsumer);
  copyReleaseFixtures(nodeConsumer);
  assertInstalledPackage(nodeConsumer, secondManifest.paths);
  execute(process.execPath, ["release-fixtures/runtime-smoke.mjs"], nodeConsumer);
  writeTypeConsumer(nodeConsumer, secondManifest.packageJson.exports);
  verifyCli(nodeConsumer);

  const bunConsumer = join(temporary, "bun-consumer");
  installWithBun(second.tarball, bunConsumer);
  copyReleaseFixtures(bunConsumer);
  assertInstalledPackage(bunConsumer, secondManifest.paths);
  execute(bun, ["release-fixtures/runtime-smoke.mjs"], bunConsumer);
  const bunChecked = execute(bun, [
    join(installedPackageRoot(bunConsumer), "bin/vibe.js"),
    "check",
    join(bunConsumer, "release-fixtures/project/main.vibe"),
    "--format",
    "json",
  ], bunConsumer);
  const bunCheckReport = JSON.parse(bunChecked.stdout);
  const bunCacheIdentity = bunCheckReport.files?.find((file) =>
    file.input === join(bunConsumer, "release-fixtures/project/main.vibe"))?.assets?.cacheIdentity;
  if (typeof bunCacheIdentity !== "string" || !/^[0-9a-f]{64}$/.test(bunCacheIdentity)) {
    throw new Error(`installed Bun CLI did not report a valid source-asset cache identity: ${bunChecked.stdout}`);
  }
  releaseAssetCacheIdentities.add(bunCacheIdentity);

  const finalInputDigest = releaseInputDigest(secondManifest.paths);
  if (finalInputDigest !== secondInputDigest) {
    throw new Error("release inputs changed during consumer verification; retry from a settled tree");
  }

  console.log(JSON.stringify({
    ok: true,
    tarball: basename(second.tarball),
    sha256: secondDigest,
    inventorySha256: createHash("sha256")
      .update(JSON.stringify(manifest(second.report)))
      .digest("hex"),
    files: secondManifest.paths.length,
    generatedFiles: rebuiltGenerated.length,
    exports: Object.keys(secondManifest.packageJson.exports).length,
    consumers: ["node", "bun"],
  }));
} finally {
  for (const identity of releaseAssetCacheIdentities) safeCleanupAssetCache(identity);
  safeCleanup(temporary);
}
