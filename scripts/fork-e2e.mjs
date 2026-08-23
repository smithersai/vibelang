#!/usr/bin/env node
/**
 * Smithers flagship compiler pipeline, end to end:
 *
 *   authored `.sm`
 *     -> the JS POC frontend's real lowering (`compileProject`) plus its
 *        version-3 authored -> lowered source map
 *     -> a protocol v2 `CompileRequest` with `lowering: "external"`
 *     -> `cmd/smithersc-go --request` against the pinned Go TypeScript fork
 *     -> emitted JavaScript, declarations, and source maps composed back to
 *        the authored `.sm` text
 *
 * Everything is hermetic: the frontend runs in a bun subprocess (the POC
 * frontend is TypeScript), the bridge binary is built into a temporary
 * directory, the fork cache lives outside the checkout, and no file inside the
 * repository or the checkout is written.
 *
 * CLI:
 *   node scripts/fork-e2e.mjs [options] <program.sm> [more.sm ...]
 *
 *   --out <dir>             output directory (default: a fresh mkdtemp)
 *   --fork-checkout <dir>   pinned smithersai/TypeScript checkout
 *                           (default: $SMITHERS_TYPESCRIPT_FORK)
 *   --fork-cache <dir>      bridge binary cache (default: a fresh mkdtemp)
 *   --ts <file.ts>          extra foreign TypeScript module for the project
 *                           (repeatable; also visible to the frontend checker)
 *   --runtime <specifier>   runtime import specifier (default ./smithers-runtime.js,
 *                           satisfied by the bundled scripts/fork-e2e runtime)
 *   --no-runtime            do not stage scripts/fork-e2e/smithers-runtime.ts
 *   --declaration           ask the bridge for declaration output
 *   --run <artifact.js>     run one emitted artifact under Node afterwards
 *   --timeout <duration>    Go-side deadline, e.g. 5m (default 5m)
 *   --quiet                 only print the output directory
 */

import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, posix, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { adjustGeneratedColumn, decodeMappings, encodeMappings } from "./fork-e2e/source-map.mjs";

export const repositoryRoot = fileURLToPath(new URL(".", import.meta.url)).replace(/\/scripts\/$/, "");
const lowerScript = fileURLToPath(new URL("./fork-e2e/lower.mjs", import.meta.url));
const bundledRuntimeSource = fileURLToPath(new URL("./fork-e2e/smithers-runtime.ts", import.meta.url));

/** Virtual roots; the bridge's own project is `/src` -> `/out` as well. */
const VIRTUAL_ROOT = "/src";
const VIRTUAL_OUT = "/out";
export const DEFAULT_RUNTIME_IMPORT = "./smithers-runtime.js";
export const BUNDLED_RUNTIME_PATH = "smithers-runtime.ts";

/**
 * Resolve the pinned checkout without throwing, so callers can skip cleanly.
 * `SMITHERS_TYPESCRIPT_FORK` wins; otherwise the revision-named directory that
 * `scripts/prepare-typescript-fork.mjs --fetch` creates under a cache root.
 */
export async function locateForkCheckout() {
  const configured = process.env.SMITHERS_TYPESCRIPT_FORK;
  if (configured) return existsSync(configured) ? configured : undefined;
  const manifestText = await readFile(join(repositoryRoot, "typescript-fork.json"), "utf8");
  const revision = JSON.parse(manifestText).revision;
  const explicitCache = process.env.SMITHERS_TYPESCRIPT_FORK_CACHE;
  const caches = explicitCache
    ? [explicitCache]
    : ["/private/tmp/smithers-ts-fork-cache", join(tmpdir(), "smithers-ts-fork-cache")];
  for (const cache of caches) {
    const candidate = join(cache, revision);
    if (existsSync(join(candidate, "go.work"))) return candidate;
  }
  return undefined;
}

function toPosix(path) {
  return path.split(sep).join("/");
}

/** POSIX relative specifier from one virtual directory to one virtual file. */
function relativeSpecifier(fromDirectory, toFile) {
  const specifier = posix.relative(fromDirectory, toFile);
  return specifier.startsWith(".") ? specifier : `./${specifier}`;
}

function utf16Length(text) {
  return text.length;
}

/**
 * Restore the authored `./x.sm` specifiers the Go bridge expects.
 *
 * `compileProject` retargets relative project imports at its own output naming
 * (`./x.ts`), while the bridge requires the lowered TypeScript to keep the
 * authored `./x.sm` specifier: it resolves that name to the virtual
 * `x.sm.ts` emit input and performs the `.sm` -> `.js` rewrite itself,
 * shifting composed map columns accordingly. This pass reverses the frontend's
 * rename and applies exactly the same column shift to the supplied map.
 *
 * Column adjustment deliberately mirrors the bridge's own `adjustGeneratedColumn`
 * clamp, so positions inside a specifier this pass rewrote collapse onto the
 * replacement start and end up unmapped rather than claiming character-exact
 * provenance for text the driver produced. Positions before the edit keep exact
 * authored provenance.
 */
export function restoreSmithersSpecifiers(loweredText, sourceMapText, renames) {
  const editsByLine = new Map();
  let text = loweredText;
  const lines = text.split("\n");
  for (let line = 0; line < lines.length; line++) {
    const lineText = lines[line];
    if (!/^\s*(?:import|export)\b/.test(lineText) && !lineText.includes("import(")) continue;
    let rebuilt = "";
    let cursor = 0;
    const edits = [];
    for (;;) {
      let bestIndex = -1;
      let bestRename;
      let bestQuoted;
      for (const rename of renames) {
        for (const quote of ['"', "'"]) {
          const needle = `${quote}${rename.from}${quote}`;
          const index = lineText.indexOf(needle, cursor);
          if (index >= 0 && (bestIndex < 0 || index < bestIndex)) {
            bestIndex = index;
            bestRename = rename;
            bestQuoted = { needle, quote };
          }
        }
      }
      if (bestIndex < 0) break;
      const replacement = `${bestQuoted.quote}${bestRename.to}${bestQuoted.quote}`;
      rebuilt += lineText.slice(cursor, bestIndex) + replacement;
      edits.push({
        start: bestIndex,
        oldEnd: bestIndex + utf16Length(bestQuoted.needle),
        newLength: utf16Length(replacement),
      });
      cursor = bestIndex + bestQuoted.needle.length;
    }
    if (edits.length === 0) continue;
    lines[line] = rebuilt + lineText.slice(cursor);
    editsByLine.set(line, edits);
  }
  if (editsByLine.size === 0) return { text: loweredText, sourceMap: sourceMapText, edits: [] };
  text = lines.join("\n");

  const map = JSON.parse(sourceMapText);
  const decoded = decodeMappings(map.mappings);
  for (const [line, edits] of editsByLine) {
    const segments = decoded[line];
    if (!segments) continue;
    decoded[line] = segments.map((segment) => ({
      ...segment,
      generatedColumn: adjustGeneratedColumn(segment.generatedColumn, edits),
    }));
  }
  map.mappings = encodeMappings(decoded);
  return {
    text,
    sourceMap: JSON.stringify(map),
    edits: [...editsByLine].map(([line, edits]) => ({ line, edits })),
  };
}

/** Run the POC frontend under bun and return its lowered TypeScript per file. */
export async function lowerWithFrontend({ sources, typeScriptSources, runtimeImport, bunCommand = "bun" }) {
  const payload = JSON.stringify({
    rootDir: VIRTUAL_ROOT,
    outDir: VIRTUAL_OUT,
    runtimeImport,
    sources,
    typeScriptSources,
  });
  const child = spawnSync(bunCommand, [lowerScript], {
    input: payload,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    cwd: repositoryRoot,
  });
  if (child.error) {
    throw new Error(`could not run '${bunCommand} scripts/fork-e2e/lower.mjs': ${child.error.message}`);
  }
  let response;
  try {
    response = JSON.parse(child.stdout);
  } catch {
    throw new Error(
      `frontend exporter did not return JSON (exit ${child.status})\nstdout: ${child.stdout}\nstderr: ${child.stderr}`,
    );
  }
  if (!response.ok) throw new Error(`frontend lowering failed: ${response.error}`);
  return response;
}

/** Build `cmd/smithersc-go` into `directory` and return the binary path. */
export function buildBridgeBinary(directory, { goCommand = "go" } = {}) {
  const binary = join(directory, "smithersc-go");
  const build = spawnSync(goCommand, ["build", "-o", binary, "./cmd/smithersc-go"], {
    cwd: repositoryRoot,
    encoding: "utf8",
  });
  if (build.error) throw new Error(`could not run '${goCommand} build': ${build.error.message}`);
  if (build.status !== 0) {
    throw new Error(`go build ./cmd/smithersc-go failed (exit ${build.status})\n${build.stdout}${build.stderr}`);
  }
  return binary;
}

/** Invoke the pinned bridge with one CompileRequest and decode its CompileResult. */
export function runBridge({ binary, requestPath, forkCheckout, forkCache, timeout = "5m" }) {
  const invocation = [
    "--fork-checkout",
    forkCheckout,
    "--fork-cache",
    forkCache,
    "--timeout",
    timeout,
    "--request",
    requestPath,
  ];
  const child = spawnSync(binary, invocation, {
    encoding: "utf8",
    maxBuffer: 128 * 1024 * 1024,
    cwd: repositoryRoot,
  });
  if (child.error) throw new Error(`could not run the bridge binary: ${child.error.message}`);
  if (child.status === 64 || child.stdout.trim() === "") {
    throw new Error(`smithersc-go rejected the request (exit ${child.status})\n${child.stderr}`);
  }
  let result;
  try {
    result = JSON.parse(child.stdout);
  } catch {
    throw new Error(`smithersc-go did not return one CompileResult JSON value\nstdout: ${child.stdout}\nstderr: ${child.stderr}`);
  }
  return { result, exitCode: child.status, stderr: child.stderr, command: [binary, ...invocation] };
}

/**
 * Drive the whole pipeline.
 *
 * `sources` are authored `.sm` modules `{ path, text }` with repository-free
 * relative POSIX paths. `typeScriptSources` are foreign `.ts` modules that both
 * the frontend checker and the bridge see.
 */
export async function runPipeline(options) {
  const {
    sources,
    typeScriptSources = [],
    forkCheckout,
    forkCache,
    outDir,
    runtimeImport = DEFAULT_RUNTIME_IMPORT,
    stageBundledRuntime = runtimeImport === DEFAULT_RUNTIME_IMPORT,
    declaration = false,
    compilerOptions = {},
    timeout = "5m",
    bunCommand = "bun",
    goCommand = "go",
    corruptLowered,
  } = options;

  if (!forkCheckout) throw new Error("runPipeline requires forkCheckout");
  for (const source of sources) {
    if (!source.path.endsWith(".sm")) throw new Error(`authored source ${source.path} must end in .sm`);
    if (source.path.includes("/")) {
      throw new Error(`authored source ${source.path} must sit at the project root in this POC`);
    }
  }

  const stagedTypeScript = [...typeScriptSources];
  if (stageBundledRuntime) {
    stagedTypeScript.unshift({
      path: BUNDLED_RUNTIME_PATH,
      text: await readFile(bundledRuntimeSource, "utf8"),
    });
  }

  const lowered = await lowerWithFrontend({
    sources: sources.map((source) => ({ fileName: source.path, source: source.text })),
    typeScriptSources: stagedTypeScript.map((file) => ({ fileName: file.path, source: file.text })),
    runtimeImport,
    bunCommand,
  });

  // The specifier the frontend produced for every other project `.sm` file,
  // paired with the authored specifier the bridge expects.
  const files = [];
  for (const source of sources) {
    const compiled = lowered.files[source.path];
    if (!compiled) throw new Error(`frontend did not lower ${source.path}`);
    if (typeof compiled.sourceMap !== "string" || compiled.sourceMap.length === 0) {
      throw new Error(`frontend produced no authored source map for ${source.path}`);
    }
    const renames = sources
      .filter((other) => other.path !== source.path)
      .map((other) => ({
        from: relativeSpecifier(posix.dirname(`${VIRTUAL_OUT}/${other.path}`), `${VIRTUAL_OUT}/${other.path.replace(/\.sm$/, ".ts")}`),
        to: relativeSpecifier(posix.dirname(`${VIRTUAL_ROOT}/${source.path}`), `${VIRTUAL_ROOT}/${other.path}`),
      }));
    const restored = restoreSmithersSpecifiers(compiled.code, compiled.sourceMap, renames);
    files.push({
      path: source.path,
      kind: "smithers",
      text: source.text,
      lowered: corruptLowered
        ? corruptLowered({ path: source.path, text: restored.text, sourceMap: restored.sourceMap })
        : { text: restored.text, sourceMap: restored.sourceMap },
      restoredSpecifiers: restored.edits,
    });
  }
  for (const file of stagedTypeScript) {
    files.push({ path: file.path, kind: "typescript", text: file.text });
  }

  const request = {
    rootNames: files.map((file) => file.path),
    files: files.map(({ path, kind, text, lowered: loweredSource }) =>
      loweredSource ? { path, kind, text, lowered: loweredSource } : { path, kind, text },
    ),
    options: { ...(declaration ? { declaration: true } : {}), ...compilerOptions },
    lowering: "external",
  };

  const output = outDir ?? (await mkdtemp(join(tmpdir(), "smithers-fork-e2e-")));
  const emitDirectory = join(output, "out");
  await mkdir(emitDirectory, { recursive: true });
  await mkdir(join(output, "lowered"), { recursive: true });
  await mkdir(join(output, "authored"), { recursive: true });
  for (const source of sources) {
    await writeFile(join(output, "authored", source.path), source.text);
  }
  for (const file of files) {
    if (!file.lowered) continue;
    await writeFile(join(output, "lowered", `${file.path}.ts`), file.lowered.text);
    await writeFile(join(output, "lowered", `${file.path}.ts.map`), file.lowered.sourceMap);
  }
  const requestPath = join(output, "request.json");
  await writeFile(requestPath, `${JSON.stringify(request, null, 2)}\n`);
  await writeFile(
    join(output, "frontend-diagnostics.json"),
    `${JSON.stringify(lowered.diagnostics, null, 2)}\n`,
  );

  const buildDirectory = join(output, "bin");
  await mkdir(buildDirectory, { recursive: true });
  const binary = buildBridgeBinary(buildDirectory, { goCommand });
  const cache = forkCache ?? (await mkdtemp(join(tmpdir(), "smithers-fork-cache-")));

  const bridge = runBridge({ binary, requestPath, forkCheckout, forkCache: cache, timeout });
  await writeFile(join(output, "result.json"), `${JSON.stringify(bridge.result, null, 2)}\n`);

  const artifacts = new Map();
  for (const artifact of bridge.result.artifacts ?? []) {
    const content = Buffer.from(artifact.content ?? "", "base64");
    artifacts.set(artifact.path, content.toString("utf8"));
    const destination = join(emitDirectory, artifact.path);
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, content);
  }
  if (artifacts.size > 0) {
    // Emitted artifacts are ES modules with `.js` names; mark the directory so
    // plain Node runs them without a loader.
    await writeFile(join(emitDirectory, "package.json"), `${JSON.stringify({ type: "module" }, null, 2)}\n`);
  }

  return {
    outDir: output,
    emitDirectory,
    requestPath,
    request,
    frontendDiagnostics: lowered.diagnostics,
    lowered: Object.fromEntries(
      files.filter((file) => file.lowered).map((file) => [file.path, file.lowered]),
    ),
    restoredSpecifiers: Object.fromEntries(
      files.filter((file) => file.lowered).map((file) => [file.path, file.restoredSpecifiers]),
    ),
    result: bridge.result,
    exitCode: bridge.exitCode,
    stderr: bridge.stderr,
    command: bridge.command,
    artifacts,
    forkCache: cache,
  };
}

/** Run one emitted artifact under Node and capture its observable output. */
export function runEmitted(emitDirectory, entry, { nodeCommand = process.execPath } = {}) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(nodeCommand, [join(emitDirectory, entry)], { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("error", rejectPromise);
    child.on("close", (code) => resolvePromise({ code, stdout, stderr }));
  });
}

function parseArguments(argv) {
  const options = { inputs: [], typeScript: [], declaration: false, quiet: false };
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    switch (argument) {
      case "--out":
        options.outDir = resolve(argv[++index]);
        break;
      case "--fork-checkout":
        options.forkCheckout = resolve(argv[++index]);
        break;
      case "--fork-cache":
        options.forkCache = resolve(argv[++index]);
        break;
      case "--ts":
        options.typeScript.push(resolve(argv[++index]));
        break;
      case "--runtime":
        options.runtimeImport = argv[++index];
        break;
      case "--no-runtime":
        options.stageBundledRuntime = false;
        break;
      case "--declaration":
        options.declaration = true;
        break;
      case "--run":
        options.run = argv[++index];
        break;
      case "--timeout":
        options.timeout = argv[++index];
        break;
      case "--quiet":
        options.quiet = true;
        break;
      case "--help":
      case "-h":
        options.help = true;
        break;
      default:
        if (argument.startsWith("-")) throw new Error(`unknown option ${argument}`);
        options.inputs.push(resolve(argument));
    }
  }
  return options;
}

const HELP = `usage: node scripts/fork-e2e.mjs [options] <program.sm> [more.sm ...]

  --out <dir>            output directory (default: a fresh temporary directory)
  --fork-checkout <dir>  pinned smithersai/TypeScript checkout
  --fork-cache <dir>     bridge binary cache (must be outside the checkout)
  --ts <file.ts>         extra foreign TypeScript module (repeatable)
  --runtime <specifier>  runtime import specifier (default ${DEFAULT_RUNTIME_IMPORT})
  --no-runtime           do not stage scripts/fork-e2e/smithers-runtime.ts
  --declaration          request declaration output
  --run <artifact.js>    run one emitted artifact under Node afterwards
  --timeout <duration>   Go-side deadline (default 5m)
  --quiet                print only the output directory
`;

async function main(argv) {
  const options = parseArguments(argv);
  if (options.help || options.inputs.length === 0) {
    process.stdout.write(HELP);
    return options.help ? 0 : 64;
  }
  const forkCheckout = options.forkCheckout ?? (await locateForkCheckout());
  if (!forkCheckout) {
    process.stderr.write(
      "fork-e2e: no pinned checkout; pass --fork-checkout or set SMITHERS_TYPESCRIPT_FORK\n",
    );
    return 64;
  }

  const sources = [];
  for (const input of options.inputs) {
    sources.push({ path: basename(input), text: await readFile(input, "utf8") });
  }
  const typeScriptSources = [];
  for (const input of options.typeScript) {
    typeScriptSources.push({ path: basename(input), text: await readFile(input, "utf8") });
  }

  const pipeline = await runPipeline({
    sources,
    typeScriptSources,
    forkCheckout,
    forkCache: options.forkCache,
    outDir: options.outDir,
    runtimeImport: options.runtimeImport,
    stageBundledRuntime: options.stageBundledRuntime,
    declaration: options.declaration,
    timeout: options.timeout,
  });

  if (options.quiet) {
    process.stdout.write(`${pipeline.outDir}\n`);
  } else {
    const errors = (pipeline.result.diagnostics ?? []).filter((item) => item.category === "error");
    process.stdout.write(`output directory: ${pipeline.outDir}\n`);
    process.stdout.write(`bridge command:   ${pipeline.command.join(" ")}\n`);
    process.stdout.write(`frontend diagnostics: ${pipeline.frontendDiagnostics.length}\n`);
    for (const item of pipeline.frontendDiagnostics) {
      process.stdout.write(`  ${item.severity} ${item.code} ${item.fileName}:${item.line}:${item.column} ${item.message}\n`);
    }
    process.stdout.write(`bridge diagnostics:   ${(pipeline.result.diagnostics ?? []).length}\n`);
    for (const item of pipeline.result.diagnostics ?? []) {
      const span = item.span ? ` @${item.span.start}+${item.span.length}` : "";
      process.stdout.write(`  ${item.category} ${item.code} ${item.file ?? "<none>"}${span} ${item.message}\n`);
    }
    process.stdout.write(`emitSkipped: ${pipeline.result.emitSkipped}\n`);
    process.stdout.write(`artifacts (${pipeline.artifacts.size}):\n`);
    for (const path of [...pipeline.artifacts.keys()].sort()) {
      process.stdout.write(`  ${toPosix(relative(pipeline.outDir, join(pipeline.emitDirectory, path)))}\n`);
    }
    if (errors.length > 0) return 1;
  }

  if (options.run) {
    const executed = await runEmitted(pipeline.emitDirectory, options.run);
    process.stdout.write(`--- node ${options.run} (exit ${executed.code}) ---\n`);
    process.stdout.write(executed.stdout);
    if (executed.stderr) process.stderr.write(executed.stderr);
    if (executed.code !== 0) return 1;
  }
  return pipeline.result.emitSkipped ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (error) => {
      process.stderr.write(`fork-e2e: ${error instanceof Error ? error.stack : String(error)}\n`);
      process.exitCode = 1;
    },
  );
}
