import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync
} from "node:fs";
import os from "node:os";
import path from "node:path";

const stripAnsi = (text) => String(text ?? "").replace(/\x1b\[[0-9;]*m/g, "");

export const DIAGNOSTIC_RE = /\.vibe[(:]\d+[,:]\d+\)?:? -? ?(?:error|warning) (?:TS|EK)\d+|LSP errors detected/g;

export function hashValue(value) {
  return createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(value)).digest("hex");
}

export function fileDigest(file) {
  return existsSync(file) ? createHash("sha256").update(readFileSync(file)).digest("hex") : null;
}

export function evalsDir(repo) {
  return process.env.AGENT_EVALS_FIXTURES_DIR
    ? path.resolve(process.env.AGENT_EVALS_FIXTURES_DIR)
    : path.join(repo, "scripts/agent-evals");
}

export function listTasks(repo) {
  const dir = path.join(evalsDir(repo), "tasks");
  return readdirSync(dir)
    .filter((name) => statSync(path.join(dir, name)).isDirectory())
    .sort();
}

export function readTask(repo, name) {
  const file = path.join(evalsDir(repo), "tasks", name, "task.json");
  return JSON.parse(readFileSync(file, "utf8"));
}

export function resolveToolchain(repo) {
  const binary = process.env.VIBELANG_BINARY
    || process.env.VIBELANG
    || path.join(repo, "packages/compiler/native/vibelang");
  const runtimeDir = process.env.VIBELANG_RUNTIME
    || path.join(repo, "packages/runtime");
  const viteNodeModules = [
    path.join(repo, "packages/vite/node_modules"),
    path.join(repo, "docs/tools/node_modules")
  ].find((dir) => existsSync(path.join(dir, "vitest")) && existsSync(path.join(dir, "@effect/vitest")));
  if (!existsSync(binary)) {
    throw new Error(`agent-evals: missing native vibelang binary at ${binary} (build //packages:compiler-native or set VIBELANG_BINARY)`);
  }
  if (!existsSync(path.join(runtimeDir, "dist"))) {
    throw new Error(`agent-evals: missing built runtime dist at ${path.join(runtimeDir, "dist")} (build //packages:runtime-dist or set VIBELANG_RUNTIME)`);
  }
  if (!viteNodeModules) {
    throw new Error(`agent-evals: missing vitest/@effect/vitest install in packages/vite/node_modules or docs/tools/node_modules`);
  }
  return {
    binary,
    runtimeDir,
    compilerDir: path.join(repo, "packages/compiler"),
    viteDir: path.join(repo, "packages/vite"),
    viteNodeModules
  };
}

function linkNodeModules(workdir, toolchain) {
  const nm = path.join(workdir, "node_modules");
  mkdirSync(nm, { recursive: true });
  for (const entry of readdirSync(toolchain.viteNodeModules)) {
    if (entry === ".bin" || entry === "vibelang" || entry === "vibelang-runtime" || entry === "vibelang-vite") continue;
    symlinkSync(path.join(toolchain.viteNodeModules, entry), path.join(nm, entry));
  }
  symlinkSync(toolchain.runtimeDir, path.join(nm, "vibelang-runtime"));
  symlinkSync(toolchain.viteDir, path.join(nm, "vibelang-vite"));
  // Build a lightweight vibelang package link that resolves native/vibelang to toolchain.binary
  const compilerPkg = path.join(nm, "vibelang");
  mkdirSync(path.join(compilerPkg, "native"), { recursive: true });
  for (const entry of readdirSync(toolchain.compilerDir)) {
    if (entry === "native" || entry === "node_modules") continue;
    symlinkSync(path.join(toolchain.compilerDir, entry), path.join(compilerPkg, entry));
  }
  symlinkSync(toolchain.binary, path.join(compilerPkg, "native/vibelang"));

  const binDir = path.join(nm, ".bin");
  mkdirSync(binDir, { recursive: true });
  if (existsSync(path.join(toolchain.viteNodeModules, ".bin/vitest"))) {
    symlinkSync(path.join(toolchain.viteNodeModules, ".bin/vitest"), path.join(binDir, "vitest"));
  }
  if (existsSync(path.join(toolchain.viteNodeModules, ".bin/vite"))) {
    symlinkSync(path.join(toolchain.viteNodeModules, ".bin/vite"), path.join(binDir, "vite"));
  }
  symlinkSync(path.join(compilerPkg, "bin/vibelang.mjs"), path.join(binDir, "vibelang"));
}

export function prepareWorkdir(repo, taskName, mode = "base", parentDir) {
  const toolchain = resolveToolchain(repo);
  const fixtures = evalsDir(repo);
  const spec = readTask(repo, taskName);
  const baseDir = parentDir
    ? (mkdirSync(parentDir, { recursive: true }), parentDir)
    : mkdtempSync(path.join(os.tmpdir(), `vibelang-agent-eval-${taskName}-${mode}-`));

  cpSync(path.join(fixtures, "sample"), baseDir, { recursive: true });
  for (const [from, to] of Object.entries(spec.files ?? {})) {
    const dest = path.join(baseDir, to);
    mkdirSync(path.dirname(dest), { recursive: true });
    copyFileSync(path.join(fixtures, "tasks", taskName, from), dest);
  }
  const testDigestBefore = fileDigest(path.join(baseDir, spec.test));

  if (mode === "reference") {
    for (const rel of spec.referenceDelete ?? []) {
      rmSync(path.join(baseDir, rel), { force: true });
    }
    for (const [from, to] of Object.entries(spec.reference ?? {})) {
      const dest = path.join(baseDir, to);
      mkdirSync(path.dirname(dest), { recursive: true });
      copyFileSync(path.join(fixtures, "tasks", taskName, from), dest);
    }
  }

  linkNodeModules(baseDir, toolchain);
  return { dir: baseDir, spec, testDigestBefore, toolchain };
}

export function gradeWorkdir(workdir, spec, testDigestBefore, toolchain, transcript = "") {
  const env = {
    ...process.env,
    VIBELANG_BINARY: toolchain.binary,
    VIBELANG: toolchain.binary,
    VIBELANG_RUNTIME: toolchain.runtimeDir,
    PATH: `${path.join(workdir, "node_modules/.bin")}:${process.env.PATH ?? ""}`
  };

  const compiled = spawnSync(toolchain.binary, ["-p", "tsconfig.test.json", "--noEmit", "--pretty", "false"], {
    cwd: workdir,
    env,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
    timeout: 120_000
  });

  const vitestBin = path.join(workdir, "node_modules/.bin/vitest");
  const tested = spawnSync(process.execPath, [vitestBin, "run", spec.test], {
    cwd: workdir,
    env,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
    timeout: 120_000
  });

  const testsUnchanged = fileDigest(path.join(workdir, spec.test)) === testDigestBefore;
  const compiles = compiled.status === 0;
  const testsPass = tested.status === 0;
  const seen = [...String(transcript).matchAll(DIAGNOSTIC_RE)].map((m) => m[0]);
  const diagnosticCodes = [...new Set(seen.flatMap((t) => t.match(/(?:TS|EK)\d{4}/g) ?? []))].sort();

  return {
    testsUnchanged,
    compiles,
    testsPass,
    pass: testsUnchanged && compiles && testsPass,
    sawDiagnostic: seen.length > 0,
    diagnosticCodes,
    compileOutput: stripAnsi(`${compiled.stdout ?? ""}${compiled.stderr ?? ""}`).slice(-1500),
    testOutput: stripAnsi(`${tested.stdout ?? ""}${tested.stderr ?? ""}`).slice(-1500)
  };
}

function hashTree(dir) {
  const entries = [];
  const walk = (cur) => {
    for (const name of readdirSync(cur).sort()) {
      if (name === "node_modules" || name === "dist" || name.endsWith(".d.vibe.ts")) continue;
      const full = path.join(cur, name);
      const st = statSync(full);
      if (st.isDirectory()) walk(full);
      else entries.push([path.relative(dir, full), fileDigest(full)]);
    }
  };
  walk(dir);
  return hashValue(entries);
}

export function stepKeyFor(repo, taskName, mode) {
  const fixtures = evalsDir(repo);
  return hashValue({
    version: "agent-evals/v1",
    taskName,
    mode,
    sample: hashTree(path.join(fixtures, "sample")),
    task: hashTree(path.join(fixtures, "tasks", taskName))
  });
}
